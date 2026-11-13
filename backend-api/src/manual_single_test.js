/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.3: PROCEDIMENTO CONTROLADO DE ENVIO MANUAL ÚNICO DE TESTE
 * Arquivo: backend-api/src/manual_single_test.js
 * ==============================================================================
 * REGRAS INEGOCIÁVEIS:
 * 1. Envio exclusivo de 1 (UMA) única mensagem ao número autorizado (WHATSAPP_TEST_NUMBER).
 * 2. Bloqueio total de disparos em lote ou destinatários secundários.
 * 3. Proibido retentativa automática em caso de timeout ou falha indeterminada.
 * 4. Não altera nenhuma configuração da instância 'Meu Bolso Digital'.
 * 5. Requer confirmação explícita prévia antes de qualquer emissão HTTP.
 */

import { EvolutionApiClient, normalizeBrazilianPhone, FIRST_TEST_MESSAGE } from './evolution_client.js';

/* global process */

export class ManualSingleTestDispatcher {
  /**
   * @param {Object} options
   * @param {string} [options.testNumber] - Número do proprietário (lido de WHATSAPP_TEST_NUMBER)
   * @param {string} [options.instanceName] - Instância Evolution ('Meu Bolso Digital')
   * @param {EvolutionApiClient} [options.client] - Instância do cliente Evolution API
   */
  constructor(options = {}) {
    this.rawTestNumber = options.testNumber || (typeof process !== 'undefined' ? process.env?.WHATSAPP_TEST_NUMBER : '') || '';
    this.instanceName = options.instanceName || 'Meu Bolso Digital';
    this.client = options.client || new EvolutionApiClient({
      instanceName: this.instanceName,
      testNumber: this.rawTestNumber
    });
  }

  /**
   * Valida as pré-condições obrigatórias antes de qualquer envio.
   */
  validatePreconditions(targetPhone) {
    // 1. Validar que existe um WHATSAPP_TEST_NUMBER configurado
    if (!this.rawTestNumber) {
      return {
        valid: false,
        error: 'CONFIGURACAO_AUSENTE: WHATSAPP_TEST_NUMBER não configurado nas variáveis de ambiente server-side.'
      };
    }

    // 2. Normalizar número configurado
    const normTest = normalizeBrazilianPhone(this.rawTestNumber);
    if (!normTest.valid) {
      return {
        valid: false,
        error: `NUMERO_TESTE_INVALIDO: O formato de WHATSAPP_TEST_NUMBER é inválido (${normTest.error}). Esperado: 55 + DDD + 8 ou 9 dígitos.`
      };
    }

    // 3. Normalizar número informado para o disparo
    const normTarget = normalizeBrazilianPhone(targetPhone);
    if (!normTarget.valid) {
      return {
        valid: false,
        error: `DESTINATARIO_INVALIDO: ${normTarget.error}`
      };
    }

    // 4. Bloqueio absoluto: o destinatário DEVE ser rigorosamente idêntico ao número autorizado
    if (normTarget.phone !== normTest.phone) {
      return {
        valid: false,
        error: 'BLOQUEIO_SEGURANCA: O número informado não coincide com o WHATSAPP_TEST_NUMBER autorizado.'
      };
    }

    return {
      valid: true,
      normalizedPhone: normTarget.phone,
      instanceName: this.instanceName,
      messageText: FIRST_TEST_MESSAGE
    };
  }

  /**
   * Executa a rotina de envio manual único mediante autorização formal.
   * @param {Object} params
   * @param {string} params.targetPhone - Número do destinatário
   * @param {boolean} params.confirmedByOperator - Confirmação do operador humano
   * @returns {Promise<Object>} Resultado detalhado para auditoria
   */
  async executeSingleTest({ targetPhone, confirmedByOperator }) {
    if (!confirmedByOperator) {
      return {
        success: false,
        status: 'aborted',
        error: 'OPERACAO_ABORTADA: Requer confirmação explícita do operador humano.'
      };
    }

    const check = this.validatePreconditions(targetPhone);
    if (!check.valid) {
      return {
        success: false,
        status: 'blocked',
        error: check.error
      };
    }

    const operationId = `single_test_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    // Disparo único via cliente seguro
    const sendResult = await this.client.sendTextMessage({
      phone: check.normalizedPhone,
      text: check.messageText,
      metadata: {
        operation_id: operationId,
        test_type: 'single_owner_homologation',
        instance: this.instanceName
      }
    });

    return {
      operationId,
      instance: this.instanceName,
      targetMasked: `${check.normalizedPhone.slice(0, 4)}****${check.normalizedPhone.slice(-2)}`,
      simulated: Boolean(sendResult.simulated),
      success: sendResult.success,
      status: sendResult.status,
      externalId: sendResult.externalId || null,
      error: sendResult.error || null,
      notes: sendResult.success && !sendResult.simulated
        ? 'Mensagem transmitida com sucesso à Evolution API. Aguardar confirmação física do proprietário.'
        : sendResult.simulated
        ? 'Executado em modo DRY-RUN. Nenhuma chamada de rede foi realizada.'
        : 'Falha na comunicação ou envio bloqueado.'
    };
  }
}

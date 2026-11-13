/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6: CLIENTE DE INTEGRAÇÃO COM A EVOLUTION API (WHATSAPP)
 * ==============================================================================
 * Regras Estritas:
 * - Modo DRY-RUN ativado por padrão (WHATSAPP_DRY_RUN=true).
 * - NUNCA faz chamadas HTTP externas reais em modo DRY-RUN.
 * - Instância configurável via variável de ambiente (EVOLUTION_INSTANCE_NAME).
 * - Normalização rigorosa de telefones brasileiros (55 + DDD + 9 ou 8 dígitos).
 * - Nenhuma credencial ou token exposta em logs.
 */

/* global process */

export function normalizeBrazilianPhone(rawPhone) {
  if (!rawPhone || typeof rawPhone !== 'string') {
    return { valid: false, error: 'Telefone não informado ou inválido' };
  }

  // Remove todos os caracteres não numéricos
  let digits = rawPhone.replace(/\D/g, '');

  if (digits === 'SEM_TELEFONE' || digits.length === 0) {
    return { valid: false, error: 'Número de telefone vazio ou não cadastrado' };
  }

  // Se já começar com DDI 55
  if (digits.startsWith('55')) {
    // 55 + DDD (2 dígitos) + 9 dígitos (celular) = 13 dígitos
    // 55 + DDD (2 dígitos) + 8 dígitos (fixo/antigo) = 12 dígitos
    if (digits.length === 13) {
      const ddd = parseInt(digits.slice(2, 4), 10);
      if (ddd < 11 || ddd > 99) {
        return { valid: false, error: `DDD inválido (${ddd})` };
      }
      return { valid: true, phone: digits, ddd, type: 'mobile' };
    } else if (digits.length === 12) {
      const ddd = parseInt(digits.slice(2, 4), 10);
      if (ddd < 11 || ddd > 99) {
        return { valid: false, error: `DDD inválido (${ddd})` };
      }
      return { valid: true, phone: digits, ddd, type: 'landline_or_legacy' };
    } else {
      return { valid: false, error: `Tamanho inválido para número com DDI 55 (${digits.length} dígitos)` };
    }
  }

  // Sem DDI 55: esperar 11 dígitos (DDD + 9 dígitos) ou 10 dígitos (DDD + 8 dígitos)
  if (digits.length === 11) {
    const ddd = parseInt(digits.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99) {
      return { valid: false, error: `DDD inválido (${ddd})` };
    }
    return { valid: true, phone: `55${digits}`, ddd, type: 'mobile' };
  } else if (digits.length === 10) {
    const ddd = parseInt(digits.slice(0, 2), 10);
    if (ddd < 11 || ddd > 99) {
      return { valid: false, error: `DDD inválido (${ddd})` };
    }
    return { valid: true, phone: `55${digits}`, ddd, type: 'landline_or_legacy' };
  }

  return { valid: false, error: `Quantidade de dígitos inválida para telefone brasileiro: ${digits.length}` };
}

export const FIRST_TEST_MESSAGE = `Olá! 👋

Esta é uma mensagem de teste do sistema
CLUB 01 Barber Studio.

Estamos validando nossa integração
de notificações pelo WhatsApp.

Se você recebeu esta mensagem,
a comunicação foi realizada com sucesso.

CLUB 01 Barber Studio 💈`;

export const PHASE_6_3G_TEST_MESSAGE = `CLUB 01 BARBER STUDIO

Teste técnico de integração WhatsApp.

Esta é uma mensagem de homologação do sistema
de notificações.

Nenhuma ação é necessária.`;

export class EvolutionApiClient {
  constructor(config = {}) {
    this.apiUrl = (config.apiUrl || (typeof process !== 'undefined' ? process.env?.EVOLUTION_API_URL : '') || 'http://localhost:8080').replace(/\/+$/, '');
    this.apiKey = config.apiKey || (typeof process !== 'undefined' ? process.env?.EVOLUTION_API_KEY : '') || '';
    this.instanceName = config.instanceName || (typeof process !== 'undefined' ? process.env?.EVOLUTION_INSTANCE_NAME : '') || 'Meu Bolso Digital';
    this.testNumber = config.testNumber || (typeof process !== 'undefined' ? process.env?.WHATSAPP_TEST_NUMBER : '') || '';
    
    // Trava Estrita de Segurança Absoluta:
    // Somente poderá ocorrer envio externo se WHATSAPP_DRY_RUN for exatamente "false"
    // E WHATSAPP_ENABLED for exatamente "true". Qualquer outra combinação bloqueia o envio.
    const dryRunEnv = (typeof process !== 'undefined' ? process.env?.WHATSAPP_DRY_RUN : undefined);
    const enabledEnv = (typeof process !== 'undefined' ? process.env?.WHATSAPP_ENABLED : undefined);

    const isLiveAllowed = Boolean(
      (config.dryRun === false || dryRunEnv === 'false') &&
      (config.enabled === true || enabledEnv === 'true')
    );

    this.isLiveAllowed = isLiveAllowed;
    this.dryRun = !isLiveAllowed;
    this.enabled = isLiveAllowed;

    // Fetch implementation plugável (para suportar Deno / Node / Mocks em testes)
    this.fetchFn = config.fetchFn || globalThis.fetch;
  }

  getConfigSummary() {
    return {
      apiUrl: this.apiUrl,
      instanceName: this.instanceName,
      dryRun: this.dryRun,
      enabled: this.enabled,
      hasApiKey: Boolean(this.apiKey),
      hasTestNumberConfigured: Boolean(this.testNumber)
    };
  }

  /**
   * Envia uma mensagem de texto via Evolution API ou simula em DRY-RUN.
   */
  async sendTextMessage({ phone, text, metadata = {} }) {
    // 1. Normalização do telefone
    const norm = normalizeBrazilianPhone(phone);
    if (!norm.valid) {
      return {
        success: false,
        status: 'failed',
        error: `Telefone inválido: ${norm.error}`,
        errorCode: 'INVALID_PHONE_NUMBER',
        simulated: this.dryRun
      };
    }

    const payload = {
      number: norm.phone,
      text: text.trim()
    };

    // 2. MODO DRY-RUN OU DESABILITADO: Não dispara nenhuma requisição externa
    if (!this.isLiveAllowed) {
      return {
        success: true,
        status: 'simulated',
        simulated: true,
        externalId: `sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
        to: norm.phone,
        payload,
        metadata: {
          ...metadata,
          simulated_at: new Date().toISOString(),
          dry_run: true,
          instance: this.instanceName
        }
      };
    }

    // 3. ENVIO REAL: Trava de Destinatário de Teste Autorizado
    // A ausência da variável testNumber ou divergência de destinatário IMPEDE envio real
    if (!this.testNumber) {
      return {
        success: false,
        status: 'failed',
        error: 'CONFIGURACAO_BLOQUEADA: O envio real exige a definição prévia de WHATSAPP_TEST_NUMBER.',
        errorCode: 'MISSING_TEST_NUMBER_IN_TEST_MODE'
      };
    }

    const normTest = normalizeBrazilianPhone(this.testNumber);
    if (!normTest.valid || norm.phone !== normTest.phone) {
      return {
        success: false,
        status: 'failed',
        error: 'DESTINATARIO_NAO_AUTORIZADO: O envio real está restrito exclusivamente ao número de teste autorizado.',
        errorCode: 'UNAUTHORIZED_RECIPIENT_IN_TEST_MODE'
      };
    }

    // 4. ENVIO REAL: Apenas se autorizado explicitamente
    if (!this.apiKey) {
      return {
        success: false,
        status: 'failed',
        error: 'EVOLUTION_API_KEY não configurada no servidor',
        errorCode: 'MISSING_API_KEY'
      };
    }

    const endpoint = `${this.apiUrl}/message/sendText/${encodeURIComponent(this.instanceName)}`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': this.apiKey
        },
        body: JSON.stringify(payload)
      });

      const responseData = await response.json().catch(() => ({}));

      if (!response.ok) {
        return {
          success: false,
          status: 'failed',
          httpStatus: response.status,
          error: responseData?.response?.message || responseData?.message || `Erro HTTP ${response.status} na Evolution API`,
          errorCode: 'API_ERROR_RESPONSE',
          rawResponse: responseData
        };
      }

      return {
        success: true,
        status: 'sent',
        simulated: false,
        externalId: responseData?.key?.id || responseData?.id || null,
        to: norm.phone,
        rawResponse: responseData
      };
    } catch (err) {
      const isTimeout = err.name === 'AbortError' || err.message?.toLowerCase().includes('timeout') || err.message?.toLowerCase().includes('indeterminado');
      return {
        success: false,
        status: 'failed',
        error: err.message || 'Falha de conexão com a Evolution API',
        errorCode: isTimeout ? 'INDETERMINATE_DELIVERY' : 'NETWORK_OR_TIMEOUT_ERROR',
        indeterminate: isTimeout
      };
    }
  }

  /**
   * Consulta status de conexão da instância configurada.
   */
  async checkConnectionState() {
    if (this.dryRun) {
      return {
        instance: this.instanceName,
        state: 'open',
        simulated: true,
        message: 'Modo DRY-RUN ativo. Simulação de conexão OK.'
      };
    }

    const endpoint = `${this.apiUrl}/instance/connectionState/${encodeURIComponent(this.instanceName)}`;

    try {
      const response = await this.fetchFn(endpoint, {
        method: 'GET',
        headers: {
          'apikey': this.apiKey
        }
      });

      const data = await response.json().catch(() => ({}));
      return {
        instance: this.instanceName,
        state: data?.instance?.state || (response.ok ? 'open' : 'disconnected'),
        data
      };
    } catch (err) {
      return {
        instance: this.instanceName,
        state: 'error',
        error: err.message
      };
    }
  }
}

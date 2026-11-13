/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.3: TESTES UNITÁRIOS DA TRAVA DE DESTINATÁRIO AUTORIZADO (TEST_NUMBER)
 * ==============================================================================
 * Garante que:
 * 1. O primeiro teste manual só é transmitido se coincidir com WHATSAPP_TEST_NUMBER.
 * 2. Destinatários diferentes são sumariamente rejeitados.
 * 3. A mensagem padronizada do primeiro teste é estritamente respeitada.
 * 4. Nenhuma chamada HTTP externa ocorre em modo DRY-RUN.
 */

import { describe, it, expect, vi } from 'vitest';
import { ManualSingleTestDispatcher } from '../backend-api/src/manual_single_test.js';
import { EvolutionApiClient, FIRST_TEST_MESSAGE } from '../backend-api/src/evolution_client.js';

describe('Fase 6.3 — Trava de Destinatário de Teste Único e Homologação', () => {
  it('1. Bloqueia envio se WHATSAPP_TEST_NUMBER não estiver configurado', () => {
    const dispatcher = new ManualSingleTestDispatcher({ testNumber: '' });
    const check = dispatcher.validatePreconditions('34999990001');

    expect(check.valid).toBe(false);
    expect(check.error).toContain('CONFIGURACAO_AUSENTE');
  });

  it('2. Bloqueia envio se o destinatário for diferente do número autorizado', () => {
    const dispatcher = new ManualSingleTestDispatcher({ testNumber: '34999998888' });
    const check = dispatcher.validatePreconditions('34999991111');

    expect(check.valid).toBe(false);
    expect(check.error).toContain('BLOQUEIO_SEGURANCA');
  });

  it('3. Aceita envio quando o destinatário corresponde exatamente ao número autorizado (com ou sem DDI 55)', () => {
    const dispatcher = new ManualSingleTestDispatcher({ testNumber: '5534999998888' });
    const check = dispatcher.validatePreconditions('34999998888');

    expect(check.valid).toBe(true);
    expect(check.normalizedPhone).toBe('5534999998888');
    expect(check.messageText).toBe(FIRST_TEST_MESSAGE);
  });

  it('4. Aborta operação se operador não confirmar explicitamente', async () => {
    const dispatcher = new ManualSingleTestDispatcher({ testNumber: '34999998888' });
    const res = await dispatcher.executeSingleTest({
      targetPhone: '34999998888',
      confirmedByOperator: false
    });

    expect(res.success).toBe(false);
    expect(res.status).toBe('aborted');
  });

  it('5. Em modo DRY-RUN, simula o envio do teste único sem chamada HTTP externa', async () => {
    const mockFetch = vi.fn();
    const client = new EvolutionApiClient({
      instanceName: 'Meu Bolso Digital',
      dryRun: true,
      enabled: false,
      testNumber: '34999998888',
      fetchFn: mockFetch
    });

    const dispatcher = new ManualSingleTestDispatcher({
      testNumber: '34999998888',
      instanceName: 'Meu Bolso Digital',
      client
    });

    const res = await dispatcher.executeSingleTest({
      targetPhone: '34999998888',
      confirmedByOperator: true
    });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(res.success).toBe(true);
    expect(res.simulated).toBe(true);
    expect(res.status).toBe('simulated');
    expect(res.operationId).toMatch(/^single_test_/);
  });

  it('6. Em tentativa de envio real, cliente EvolutionApiClient rejeita destinatário diferente do testNumber', async () => {
    const mockFetch = vi.fn();
    const client = new EvolutionApiClient({
      apiUrl: 'https://api.exemplo.com',
      apiKey: 'test_key',
      instanceName: 'Meu Bolso Digital',
      dryRun: false,
      enabled: true,
      testNumber: '34999998888',
      fetchFn: mockFetch
    });

    // Destinatário diferente do testNumber
    const res = await client.sendTextMessage({
      phone: '34988881234',
      text: 'Tentativa indevida'
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('UNAUTHORIZED_RECIPIENT_IN_TEST_MODE');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('7. Em tentativa de envio real, cliente EvolutionApiClient bloqueia se testNumber estiver ausente', async () => {
    const mockFetch = vi.fn();
    const client = new EvolutionApiClient({
      apiUrl: 'https://api.exemplo.com',
      apiKey: 'test_key',
      instanceName: 'Meu Bolso Digital',
      dryRun: false,
      enabled: true,
      testNumber: '', // Ausente
      fetchFn: mockFetch
    });

    const res = await client.sendTextMessage({
      phone: '34988881234',
      text: 'Tentativa sem testNumber'
    });

    expect(res.success).toBe(false);
    expect(res.errorCode).toBe('MISSING_TEST_NUMBER_IN_TEST_MODE');
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.2 — ETAPA 3: TESTES UNITÁRIOS DAS TRAVAS ESTRITAS DE DRY-RUN
 * ==============================================================================
 * Valida todas as combinações de variáveis de ambiente para garantir que
 * NUNCA ocorra envio externo a menos que WHATSAPP_DRY_RUN seja exatamente "false"
 * E WHATSAPP_ENABLED seja exatamente "true".
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EvolutionApiClient } from '../backend-api/src/evolution_client.js';

/* global process */

describe('Fase 6.2 — Etapa 3: Auditoria das Travas Estritas de Envio WhatsApp', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('1. Padrão Seguro: WHATSAPP_DRY_RUN=true e WHATSAPP_ENABLED=false -> DRY-RUN ativo', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const client = new EvolutionApiClient();
    expect(client.isLiveAllowed).toBe(false);
    expect(client.dryRun).toBe(true);

    const mockFetch = vi.fn();
    client.fetchFn = mockFetch;

    const res = await client.sendTextMessage({
      phone: '34999990001',
      text: 'Mensagem de Teste'
    });

    expect(res.status).toBe('simulated');
    expect(res.simulated).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('2. Ambos False: WHATSAPP_DRY_RUN=false e WHATSAPP_ENABLED=false -> Bloqueado (DRY-RUN)', async () => {
    process.env.WHATSAPP_DRY_RUN = 'false';
    process.env.WHATSAPP_ENABLED = 'false';

    const client = new EvolutionApiClient();
    expect(client.isLiveAllowed).toBe(false);

    const mockFetch = vi.fn();
    client.fetchFn = mockFetch;

    const res = await client.sendTextMessage({
      phone: '34999990001',
      text: 'Mensagem de Teste'
    });

    expect(res.status).toBe('simulated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('3. Ambos True: WHATSAPP_DRY_RUN=true e WHATSAPP_ENABLED=true -> Bloqueado (DRY-RUN prevalece)', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'true';

    const client = new EvolutionApiClient();
    expect(client.isLiveAllowed).toBe(false);

    const mockFetch = vi.fn();
    client.fetchFn = mockFetch;

    const res = await client.sendTextMessage({
      phone: '34999990001',
      text: 'Mensagem de Teste'
    });

    expect(res.status).toBe('simulated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('4. Ausentes / Undefined: Deve assumir DRY-RUN bloqueado por padrão', async () => {
    delete process.env.WHATSAPP_DRY_RUN;
    delete process.env.WHATSAPP_ENABLED;

    const client = new EvolutionApiClient();
    expect(client.isLiveAllowed).toBe(false);

    const mockFetch = vi.fn();
    client.fetchFn = mockFetch;

    const res = await client.sendTextMessage({
      phone: '34999990001',
      text: 'Mensagem de Teste'
    });

    expect(res.status).toBe('simulated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('5. Valores inválidos ou ambíguos: "1", "yes", "on", "null" -> Bloqueado (DRY-RUN)', async () => {
    const invalidCombinations = [
      { dry: '0', en: '1' },
      { dry: 'no', en: 'yes' },
      { dry: '', en: '' },
      { dry: 'FALSE', en: 'TRUE' }, // Sensível a maiúsculas / estrito
      { dry: 'null', en: 'undefined' }
    ];

    for (const combo of invalidCombinations) {
      process.env.WHATSAPP_DRY_RUN = combo.dry;
      process.env.WHATSAPP_ENABLED = combo.en;

      const client = new EvolutionApiClient();
      expect(client.isLiveAllowed).toBe(false);

      const mockFetch = vi.fn();
      client.fetchFn = mockFetch;

      const res = await client.sendTextMessage({
        phone: '34999990001',
        text: 'Mensagem de Teste'
      });

      expect(res.status).toBe('simulated');
      expect(mockFetch).not.toHaveBeenCalled();
    }
  });

  it('6. Única combinação autorizada para envio real: WHATSAPP_DRY_RUN="false" E WHATSAPP_ENABLED="true"', async () => {
    process.env.WHATSAPP_DRY_RUN = 'false';
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.EVOLUTION_API_KEY = 'test_key';

    const client = new EvolutionApiClient();
    expect(client.isLiveAllowed).toBe(true);
    expect(client.dryRun).toBe(false);
  });
});

/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.3-E: SUÍTE DE HOMOLOGAÇÃO DO AGENDADOR AUTOMÁTICO EM DRY-RUN
 * ==============================================================================
 * Cobre rigorosamente:
 * - ETAPA D: Os 10 Cenários Funcionais Obrigatórios
 * - ETAPA E: Testes de Idempotência, Falhas Distribuídas e Concorrência
 * 
 * Execução 100% isolada em PostgreSQL (PGlite) e mocks de rede.
 * ZERO chamadas externas.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { EvolutionApiClient } from '../backend-api/src/evolution_client.js';
import { NotificationProcessor } from '../backend-api/src/workers/notification_processor.js';

/* global process */
const BASE_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

describe('Fase 6.3-E: Homologação do Agendador Automático e Idempotência', () => {
  let db;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    db = new PGlite();

    // 1. Setup Auth Mock
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;
      
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated NOLOGIN;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
          CREATE ROLE service_role NOLOGIN;
        END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT,
        phone TEXT,
        raw_user_meta_data JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
      $$ LANGUAGE sql STABLE;
    `);

    // 2. Carregar migrations de base (0000 até 0023)
    let initSql = fs.readFileSync(path.join(MIGRATIONS_DIR, 'supabase_club01_init.sql'), 'utf-8');
    initSql = initSql.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
    await db.exec(initSql);

    let sql0019 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0019_supabase_security_and_rpc.sql'), 'utf-8');
    sql0019 = sql0019.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
    await db.exec(sql0019);

    let sql0020 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0020_book_appointment_online.sql'), 'utf-8');
    sql0020 = sql0020.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
    await db.exec(sql0020);

    let sql0021 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0021_fase5_security_and_concurrency_corrections.sql'), 'utf-8');
    sql0021 = sql0021.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
    await db.exec(sql0021);

    let sql0022 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0022_notification_queue_and_triggers.sql'), 'utf-8');
    await db.exec(sql0022);

    let sql0023 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0023_fix_whatsapp_logs_status_and_hardening.sql'), 'utf-8');
    await db.exec(sql0023);

    // 3. Inserir dados base
    await db.exec(`
      INSERT INTO public.barbers (id, name, phone) VALUES
        ('barber-f63e', 'Barbeiro Teste', '34988880000');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-f63e', 'Cliente Teste', '34999990000');

      INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
        ('srv-f63e', 'Corte Homolog', 30, 50.00, false);
    `);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    await db.exec(`
      DELETE FROM public.notification_queue;
      DELETE FROM public.whatsapp_logs;
      DELETE FROM public.appointments;
    `);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ============================================================================
  // ETAPA D: OS 10 CENÁRIOS FUNCIONAIS OBRIGATÓRIOS
  // ============================================================================

  // CENÁRIO 1 — FILA VAZIA
  it('CENÁRIO 1: Fila vazia -> Processed=0 e nenhuma chamada externa', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(10);

    expect(res.processed).toBe(0);
    expect(res.success).toBe(0);
    expect(res.failed).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // CENÁRIO 2 — NOTIFICAÇÃO VÁLIDA
  it('CENÁRIO 2: Notificação válida -> Processamento em DRY-RUN e status simulated', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-c2', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES (
        'notif-c2', 'appt-c2', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Olá, agendamento confirmado!', now() - interval '1 minute', 'pending'
      );
    `);

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const batchRes = await processor.processBatch(10);

    expect(batchRes.processed).toBe(1);
    expect(batchRes.success).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();

    const qItem = await db.query(`SELECT * FROM public.notification_queue WHERE id = 'notif-c2';`);
    expect(qItem.rows[0].status).toBe('simulated');
    expect(qItem.rows[0].external_id).toMatch(/^sim_/);

    const logItem = await db.query(`SELECT * FROM public.whatsapp_logs WHERE id = 'notif-c2';`);
    expect(logItem.rows[0].status).toBe('simulated');
    expect(logItem.rows[0].sent_at).toBeNull();
  });

  // CENÁRIO 3 — CONCORRÊNCIA (2 WORKERS SIMULTÂNEOS)
  it('CENÁRIO 3: Concorrência -> Dois workers paralelos sem colisão via FOR UPDATE SKIP LOCKED', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    for (let i = 1; i <= 6; i++) {
      await db.exec(`
        INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
        VALUES ('appt-c3-${i}', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');
      `);
    }

    await db.exec(`DELETE FROM public.notification_queue;`);

    for (let i = 1; i <= 6; i++) {
      await db.exec(`
        INSERT INTO public.notification_queue (
          id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
        ) VALUES (
          'notif-c3-${i}', 'appt-c3-${i}', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg conc', now() - interval '1 minute', 'pending'
        );
      `);
    }

    const mockFetch = vi.fn();
    const client1 = new EvolutionApiClient();
    client1.fetchFn = mockFetch;
    const client2 = new EvolutionApiClient();
    client2.fetchFn = mockFetch;

    const worker1 = new NotificationProcessor({ db, evolutionClient: client1 });
    const worker2 = new NotificationProcessor({ db, evolutionClient: client2 });

    const [res1, res2] = await Promise.all([
      worker1.processBatch(3),
      worker2.processBatch(3)
    ]);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(res1.processed + res2.processed).toBe(6);

    const ids1 = res1.results.map(r => r.id);
    const ids2 = res2.results.map(r => r.id);
    const overlap = ids1.filter(id => ids2.includes(id));
    expect(overlap.length).toBe(0); // Zero overlap
  });

  // CENÁRIO 4 — SOBREPOSIÇÃO (NOVA EXECUÇÃO ENQUANTO ANTERIOR ATIVA)
  it('CENÁRIO 4: Sobreposição -> Registros em "processing" são ignorados pela nova execução', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-c4', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      -- Item 1: Já em processamento pelo ciclo anterior
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, updated_at
      ) VALUES (
        'notif-c4-busy', 'appt-c4', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Em voo', now() - interval '1 minute', 'processing', 1, now()
      );

      -- Item 2: Novo item pendente
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, updated_at
      ) VALUES (
        'notif-c4-new', 'appt-c4', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Pendente', now() - interval '10 seconds', 'pending', 0, now()
      );
    `);

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(10);

    // Deve pegar apenas o item pendente, nunca o item que já está em processing ativo!
    expect(res.processed).toBe(1);
    expect(res.results[0].id).toBe('notif-c4-new');
    expect(mockFetch).not.toHaveBeenCalled();

    // O item ocupado permaneceu intocado
    const busyCheck = await db.query(`SELECT status FROM public.notification_queue WHERE id = 'notif-c4-busy';`);
    expect(busyCheck.rows[0].status).toBe('processing');
  });

  // CENÁRIO 5 — FALHA DO WORKER (EXCEÇÃO INTERNA CAPTURADA)
  it('CENÁRIO 5: Falha do worker -> Exceção é tratada e registrada sem crash', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-c5', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts
      ) VALUES (
        'notif-c5', 'appt-c5', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg erro', now() - interval '1 minute', 'pending', 2, 3
      );
    `);

    const client = new EvolutionApiClient();
    // Simula falha retornada pelo cliente
    client.sendTextMessage = vi.fn().mockResolvedValue({
      success: false,
      status: 'failed',
      error: 'Erro interno inesperado no worker',
      errorCode: 'INTERNAL_ERROR'
    });

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(10);

    expect(res.processed).toBe(1);
    expect(res.failed).toBe(1);
    expect(res.results[0].error).toMatch(/Erro interno inesperado/i);

    const qItem = await db.query(`SELECT status, last_error FROM public.notification_queue WHERE id = 'notif-c5';`);
    expect(qItem.rows[0].status).toBe('failed');
    expect(qItem.rows[0].last_error).toMatch(/Erro interno inesperado/i);
  });

  // CENÁRIO 6 — TIMEOUT DE REDE
  it('CENÁRIO 6: Timeout -> Estado seguro e erro rastreável em last_error', async () => {
    process.env.WHATSAPP_DRY_RUN = 'false';
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_TEST_NUMBER = '5534988880000';
    process.env.EVOLUTION_API_KEY = 'test_key';

    const client = new EvolutionApiClient();
    client.fetchFn = vi.fn().mockImplementation(() => new Promise((_, reject) => {
      setTimeout(() => reject(new Error('ETIMEDOUT: Connection timed out to Evolution API')), 10);
    }));

    const res = await client.sendTextMessage({
      phone: '5534988880000',
      text: 'Teste timeout'
    });

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/ETIMEDOUT/i);
    expect(res.simulated).toBeFalsy();
  });

  // CENÁRIO 7 — DESTINATÁRIO INVÁLIDO
  it('CENÁRIO 7: Destinatário inválido -> Rejeição segura com status failed', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-c7', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES (
        'notif-c7', 'appt-c7', 'new_appointment', 'client', '123456', 'Tel Invalido', 'Msg invalida', now() - interval '1 minute', 'pending'
      );
    `);

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(10);

    expect(res.processed).toBe(1);
    expect(res.failed).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();

    const qItem = await db.query(`SELECT status, last_error FROM public.notification_queue WHERE id = 'notif-c7';`);
    expect(qItem.rows[0].status).toBe('failed');
    expect(qItem.rows[0].last_error).toMatch(/Validação de número falhou/i);
  });

  // CENÁRIO 8 — MÚLTIPLOS REGISTROS (RESPEITO AO BATCH_SIZE)
  it('CENÁRIO 8: Múltiplos registros -> Respeito estrito ao batch_size', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    // Inserir 10 notificações pendentes
    for (let i = 1; i <= 10; i++) {
      await db.exec(`
        INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
        VALUES ('appt-c8-${i}', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');
      `);
    }

    await db.exec(`DELETE FROM public.notification_queue;`);

    for (let i = 1; i <= 10; i++) {
      await db.exec(`
        INSERT INTO public.notification_queue (
          id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
        ) VALUES (
          'notif-c8-${i}', 'appt-c8-${i}', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg batch', now() - interval '1 minute', 'pending'
        );
      `);
    }

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    // Solicita lote de tamanho 4
    const res = await processor.processBatch(4);

    expect(res.processed).toBe(4);
    expect(mockFetch).not.toHaveBeenCalled();

    // 6 itens ainda devem permanecer com status 'pending'
    const remaining = await db.query(`SELECT count(*) FROM public.notification_queue WHERE status = 'pending';`);
    expect(Number(remaining.rows[0].count)).toBe(6);
  });

  // CENÁRIO 9 — WHATSAPP_ENABLED=false
  it('CENÁRIO 9: WHATSAPP_ENABLED=false -> Bloqueio global de envio real (força DRY-RUN)', async () => {
    process.env.WHATSAPP_DRY_RUN = 'false'; // Mesmo que dry run seja false
    process.env.WHATSAPP_ENABLED = 'false';  // enabled=false forca DRY-RUN!

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    expect(client.isLiveAllowed).toBe(false);
    expect(client.dryRun).toBe(true);

    const res = await client.sendTextMessage({
      phone: '5534988880000',
      text: 'Mensagem teste trava'
    });

    expect(res.status).toBe('simulated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // CENÁRIO 10 — WHATSAPP_DRY_RUN=true
  it('CENÁRIO 10: WHATSAPP_DRY_RUN=true -> Trava de simulação prevalece sobre qualquer configuração', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'true'; // Mesmo que enabled seja true

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    expect(client.isLiveAllowed).toBe(false);
    expect(client.dryRun).toBe(true);

    const res = await client.sendTextMessage({
      phone: '5534988880000',
      text: 'Mensagem teste trava dry run'
    });

    expect(res.status).toBe('simulated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ============================================================================
  // ETAPA E: VALIDAÇÃO DE IDEMPOTÊNCIA E FALHAS EM SISTEMAS DISTRIBUÍDOS
  // ============================================================================

  // TESTE F: DUAS TENTATIVAS COM A MESMA CHAVE DE IDEMPOTÊNCIA
  it('ETAPA E - TESTE F: Duas tentativas com a mesma chave de idempotência são rejeitadas no banco', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-ef', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, idempotency_key
      ) VALUES (
        'notif-ef-1', 'appt-ef', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg', now(), 'pending', 'idem_key_unique_123'
      );
    `);

    let errorThrown = false;
    try {
      await db.exec(`
        INSERT INTO public.notification_queue (
          id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, idempotency_key
        ) VALUES (
          'notif-ef-2', 'appt-ef', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg 2', now(), 'pending', 'idem_key_unique_123'
        );
      `);
    } catch (err) {
      errorThrown = true;
      expect(err.message).toMatch(/unique|idempotency/i);
    }
    expect(errorThrown).toBe(true);
  });

  // TESTE E & H: RECUPERAÇÃO DE REGISTRO TRAVADO EM PROCESSING APÓS 5 MINUTOS
  it('ETAPA E - TESTE E & H: Registro travado em "processing" há mais de 5 minutos é recuperado', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-ee', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      -- Item que ficou travado há 6 minutos (attempts = 1, max_attempts = 3)
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts, updated_at
      ) VALUES (
        'notif-stuck', 'appt-ee', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg travada', now() - interval '10 minutes', 'processing', 1, 3, now() - interval '6 minutes'
      );
    `);

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(10);

    // O worker deve recuperar e processar o item travado!
    expect(res.processed).toBe(1);
    expect(res.results[0].id).toBe('notif-stuck');
    expect(mockFetch).not.toHaveBeenCalled();

    const qItem = await db.query(`SELECT status, attempts FROM public.notification_queue WHERE id = 'notif-stuck';`);
    expect(qItem.rows[0].status).toBe('simulated');
    expect(qItem.rows[0].attempts).toBe(2); // Incrementado de 1 para 2 no dequeue
  });

  // TESTE DE LIMITE DE RETENTATIVAS: QUANDO ATTEMPTS >= MAX_ATTEMPTS NÃO REENFILEIRA
  it('ETAPA E - Limite de retentativas: Item travado que atingiu max_attempts não é recuperado', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-emax', 'barber-f63e', 'cust-f63e', 'srv-f63e', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      -- Item com attempts = 3 e max_attempts = 3 (esgotado)
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts, updated_at
      ) VALUES (
        'notif-exhausted', 'appt-emax', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg esgotada', now() - interval '10 minutes', 'processing', 3, 3, now() - interval '6 minutes'
      );
    `);

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(10);

    // Não deve recuperar porque atingiu max_attempts
    expect(res.processed).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

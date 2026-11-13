/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.3-D: HOMOLOGAÇÃO DO AGENDADOR AUTOMÁTICO EM DRY-RUN (8 CENÁRIOS)
 * ==============================================================================
 * Execução 100% isolada em PostgreSQL (PGlite) e mock rigoroso,
 * validando as regras de segurança, idempotência e ausência de envios reais.
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

describe('Fase 6.3-D: Homologação do Agendador Automático em DRY-RUN (8 Cenários)', () => {
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

    // 2. Carregar migrations de base (0000 até 0021)
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

    // 3. Carregar migration da Fase 6: 0022_notification_queue_and_triggers.sql
    let sql0022 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0022_notification_queue_and_triggers.sql'), 'utf-8');
    await db.exec(sql0022);

    // 4. Carregar migration da Fase 6: 0023_fix_whatsapp_logs_status_and_hardening.sql
    let sql0023 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0023_fix_whatsapp_logs_status_and_hardening.sql'), 'utf-8');
    await db.exec(sql0023);

    // 5. Inserir dados de teste base
    await db.exec(`
      INSERT INTO public.barbers (id, name, phone) VALUES
        ('barber-homolog', 'Barbeiro Homolog', '34988880000');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-homolog', 'Cliente Homolog', '34999990000');

      INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
        ('srv-homolog', 'Servico Homolog', 30, 50.00, false);
    `);
  });

  afterAll(async () => {
    if (db) await db.close();
  });

  beforeEach(async () => {
    vi.resetModules();
    // Limpar filas para cada teste
    await db.exec(`
      DELETE FROM public.notification_queue;
      DELETE FROM public.whatsapp_logs;
      DELETE FROM public.appointments;
    `);
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  // ----------------------------------------------------------------------------
  // CENÁRIO 1: Fila Vazia
  // ----------------------------------------------------------------------------
  it('CENÁRIO 1: Fila vazia -> Nenhuma notificação processada', async () => {
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
    expect(res.skipped).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------
  // CENÁRIO 2: Notificação Válida Simulada
  // ----------------------------------------------------------------------------
  it('CENÁRIO 2: Notificação válida simulada -> Identificação correta e status simulated sem transmissão', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    // Cria agendamento e limpa fila criada pelo trigger para isolar item
    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-cen2', 'barber-homolog', 'cust-homolog', 'srv-homolog', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES (
        'notif-cen2', 'appt-cen2', 'new_appointment', 'client', '34999990000', 'Cliente Homolog', 'Seu agendamento foi confirmado!', now() - interval '1 minute', 'pending'
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

    // Valida status no banco
    const queueItem = await db.query(`SELECT * FROM public.notification_queue WHERE id = 'notif-cen2';`);
    expect(queueItem.rows[0].status).toBe('simulated');
    expect(queueItem.rows[0].external_id).toMatch(/^sim_/);

    const logItem = await db.query(`SELECT * FROM public.whatsapp_logs WHERE id = 'notif-cen2';`);
    expect(logItem.rows[0].status).toBe('simulated');
    expect(logItem.rows[0].sent_at).toBeNull(); // DRY-RUN nunca preenche sent_at
  });

  // ----------------------------------------------------------------------------
  // CENÁRIO 3: Notificação Duplicada Simulada
  // ----------------------------------------------------------------------------
  it('CENÁRIO 3: Notificação duplicada simulada -> Bloqueio de duplicidade por chave de idempotência', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-cen3', 'barber-homolog', 'cust-homolog', 'srv-homolog', '2026-10-30T11:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, idempotency_key
      ) VALUES (
        'notif-cen3-orig', 'appt-cen3', 'new_appointment', 'client', '34999990000', 'Cliente Homolog', 'Msg 1', now() - interval '1 minute', 'pending', 'idem_key_cen3'
      );
    `);

    // Tentar inserir duplicata com a mesma chave de idempotência deve falhar por unique constraint
    let duplicateRejected = false;
    try {
      await db.exec(`
        INSERT INTO public.notification_queue (
          id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, idempotency_key
        ) VALUES (
          'notif-cen3-dup', 'appt-cen3', 'new_appointment', 'client', '34999990000', 'Cliente Homolog', 'Msg 2', now() - interval '1 minute', 'pending', 'idem_key_cen3'
        );
      `);
    } catch (err) {
      duplicateRejected = true;
      expect(err.message).toMatch(/unique|idempotency/i);
    }

    expect(duplicateRejected).toBe(true);

    // Processar apenas a original
    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(10);
    expect(res.processed).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------
  // CENÁRIO 4: Notificação com Destinatário Inválido
  // ----------------------------------------------------------------------------
  it('CENÁRIO 4: Notificação com destinatário inválido -> Rejeição segura com status failed', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-cen4', 'barber-homolog', 'cust-homolog', 'srv-homolog', '2026-10-30T14:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES (
        'notif-cen4', 'appt-cen4', 'new_appointment', 'client', '12345', 'Tel Invalido', 'Msg', now() - interval '1 minute', 'pending'
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

    const queueItem = await db.query(`SELECT * FROM public.notification_queue WHERE id = 'notif-cen4';`);
    expect(queueItem.rows[0].status).toBe('failed');
    expect(queueItem.rows[0].last_error).toMatch(/Validação de número falhou|Quantidade de dígitos inválida/i);
  });

  // ----------------------------------------------------------------------------
  // CENÁRIO 5: Falha Simulada da Evolution API
  // ----------------------------------------------------------------------------
  it('CENÁRIO 5: Falha simulada da Evolution API -> Tratamento de erro sem envio real e sem crash', async () => {
    process.env.WHATSAPP_DRY_RUN = 'false';
    process.env.WHATSAPP_ENABLED = 'true';
    process.env.WHATSAPP_TEST_NUMBER = '5534988880000';
    process.env.EVOLUTION_API_KEY = 'test_api_key';

    const client = new EvolutionApiClient();
    expect(client.isLiveAllowed).toBe(true);
    expect(client.dryRun).toBe(false);

    // Mock que simula erro de conexão/timeout
    client.fetchFn = vi.fn().mockRejectedValue(new Error('Evolution API timeout (simulado)'));

    const res = await client.sendTextMessage({
      phone: '5534988880000',
      text: 'Teste de falha'
    });

    expect(res.status).toBe('failed');
    expect(res.error).toMatch(/Evolution API timeout/i);
    expect(res.simulated).toBeFalsy();
  });

  // ----------------------------------------------------------------------------
  // CENÁRIO 6: Tentativa com WHATSAPP_ENABLED=false
  // ----------------------------------------------------------------------------
  it('CENÁRIO 6: Tentativa de processamento com WHATSAPP_ENABLED=false -> Bloqueio conforme política V6', async () => {
    process.env.WHATSAPP_DRY_RUN = 'false'; // Mesmo se dry run fosse false...
    process.env.WHATSAPP_ENABLED = 'false';  // ...enabled=false deve forçar DRY-RUN!

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    expect(client.isLiveAllowed).toBe(false);
    expect(client.dryRun).toBe(true);

    const res = await client.sendTextMessage({
      phone: '5534988880000',
      text: 'Teste trava enabled'
    });

    expect(res.status).toBe('simulated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------
  // CENÁRIO 7: Tentativa com WHATSAPP_DRY_RUN=true
  // ----------------------------------------------------------------------------
  it('CENÁRIO 7: Tentativa de processamento com WHATSAPP_DRY_RUN=true -> Nenhuma mensagem real transmitida', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';  // DRY-RUN ativo prevalece...
    process.env.WHATSAPP_ENABLED = 'true';  // ...mesmo que enabled seja true!

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    expect(client.isLiveAllowed).toBe(false);
    expect(client.dryRun).toBe(true);

    const res = await client.sendTextMessage({
      phone: '5534988880000',
      text: 'Teste trava dry_run'
    });

    expect(res.status).toBe('simulated');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // ----------------------------------------------------------------------------
  // CENÁRIO 8: Execuções Concorrentes Simuladas
  // ----------------------------------------------------------------------------
  it('CENÁRIO 8: Execuções concorrentes simuladas -> Ausência de processamento duplicado (FOR UPDATE SKIP LOCKED)', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    // Inserir appointments
    for (let i = 1; i <= 5; i++) {
      await db.exec(`
        INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
        VALUES ('appt-conc-${i}', 'barber-homolog', 'cust-homolog', 'srv-homolog', '2026-10-30T15:00:00Z', 'confirmed');
      `);
    }

    // Limpar itens gerados pelos triggers dos appointments
    await db.exec(`DELETE FROM public.notification_queue;`);

    // Inserir exatamente 5 notificações pendentes controladas
    for (let i = 1; i <= 5; i++) {
      await db.exec(`
        INSERT INTO public.notification_queue (
          id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
        ) VALUES (
          'notif-conc-${i}', 'appt-conc-${i}', 'new_appointment', 'client', '34999990000', 'Cliente Homolog', 'Msg Concorrencia', now() - interval '1 minute', 'pending'
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

    // Disparar os dois workers em concorrência
    const [res1, res2] = await Promise.all([
      worker1.processBatch(3),
      worker2.processBatch(3)
    ]);

    expect(mockFetch).not.toHaveBeenCalled();

    // A soma dos processamentos deve ser exatamente o total de 5 (sem overlap)
    const totalProcessed = res1.processed + res2.processed;
    expect(totalProcessed).toBe(5);

    // Nenhum item pode ter sido pego por ambos os workers
    const ids1 = res1.results.map(r => r.id);
    const ids2 = res2.results.map(r => r.id);
    const overlap = ids1.filter(id => ids2.includes(id));
    expect(overlap.length).toBe(0);

    // Todos os 5 devem estar como 'simulated'
    const queueItems = await db.query(`SELECT id, status, attempts FROM public.notification_queue;`);
    expect(queueItems.rows.length).toBe(5);
    for (const row of queueItems.rows) {
      expect(row.status).toBe('simulated');
      expect(row.attempts).toBe(1); // Exatamente 1 tentativa, nunca duplicada
    }
  });
});

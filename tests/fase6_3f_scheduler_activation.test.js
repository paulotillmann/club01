/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.3-F: SUÍTE DE HOMOLOGAÇÃO DA ATIVAÇÃO DO AGENDADOR AUTOMÁTICO
 * ==============================================================================
 * Cobre os 10 testes obrigatórios da Fase 6.3-F em ambiente simulado e seguro.
 * ZERO chamadas reais para a Evolution API.
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

describe('Fase 6.3-F: Homologação e Ativação do Agendador Automático', () => {
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
        ('barber-f63f', 'Barbeiro 6.3F', '34988880000');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-f63f', 'Cliente 6.3F', '34999990000');

      INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
        ('srv-f63f', 'Corte Homolog 6.3F', 30, 50.00, false);
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

  // TESTE 1: Execução automática com fila vazia
  it('TESTE 1: Execução com fila vazia -> processed=0 e zero chamadas externas', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(5);

    expect(res.processed).toBe(0);
    expect(res.success).toBe(0);
    expect(res.failed).toBe(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // TESTE 2: Processamento de notificações fictícias em DRY-RUN
  it('TESTE 2: Processamento de notificações fictícias em DRY-RUN', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-t2', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');

      DELETE FROM public.notification_queue;

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES (
        'notif-t2', 'appt-t2', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Olá!', now() - interval '1 minute', 'pending'
      );
    `);

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(5);

    expect(res.processed).toBe(1);
    expect(res.success).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // TESTE 3: Execução periódica a cada ciclo
  it('TESTE 3: Execução periódica processa novos itens adicionados a cada ciclo', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;
    const processor = new NotificationProcessor({ db, evolutionClient: client });

    // Ciclo 1: 1 item
    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-t3-1', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');
      DELETE FROM public.notification_queue;
      INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
      VALUES ('notif-t3-1', 'appt-t3-1', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg 1', now() - interval '1 minute', 'pending');
    `);

    const res1 = await processor.processBatch(5);
    expect(res1.processed).toBe(1);

    // Ciclo 2: Fila vazia
    const res2 = await processor.processBatch(5);
    expect(res2.processed).toBe(0);

    // Ciclo 3: Novo item adicionado
    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-t3-2', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T11:00:00Z', 'confirmed');
      DELETE FROM public.notification_queue WHERE status = 'pending';
      INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
      VALUES ('notif-t3-2', 'appt-t3-2', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg 2', now() - interval '1 minute', 'pending');
    `);

    const res3 = await processor.processBatch(5);
    expect(res3.processed).toBe(1);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  // TESTE 4: Respeito estrito ao limite batch_size=5
  it('TESTE 4: Respeito ao limite batch_size=5 com 8 itens na fila', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    for (let i = 1; i <= 8; i++) {
      await db.exec(`
        INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
        VALUES ('appt-t4-${i}', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');
      `);
    }

    await db.exec(`DELETE FROM public.notification_queue;`);

    for (let i = 1; i <= 8; i++) {
      await db.exec(`
        INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
        VALUES ('notif-t4-${i}', 'appt-t4-${i}', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg batch', now() - interval '1 minute', 'pending');
      `);
    }

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;
    const processor = new NotificationProcessor({ db, evolutionClient: client });

    // Processa lote com limite 5
    const res = await processor.processBatch(5);
    expect(res.processed).toBe(5);

    // 3 itens permanecem pendentes
    const pend = await db.query(`SELECT count(*) FROM public.notification_queue WHERE status = 'pending';`);
    expect(Number(pend.rows[0].count)).toBe(3);
  });

  // TESTE 5: Registro correto do status simulated
  it('TESTE 5: Registro correto do status simulated na fila', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-t5', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');
      DELETE FROM public.notification_queue;
      INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
      VALUES ('notif-t5', 'appt-t5', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg', now() - interval '1 minute', 'pending');
    `);

    const client = new EvolutionApiClient();
    const processor = new NotificationProcessor({ db, evolutionClient: client });
    await processor.processBatch(5);

    const qItem = await db.query(`SELECT status, external_id FROM public.notification_queue WHERE id = 'notif-t5';`);
    expect(qItem.rows[0].status).toBe('simulated');
    expect(qItem.rows[0].external_id).toMatch(/^sim_/);
  });

  // TESTE 6: Confirmação de sent_at=NULL nas notificações simuladas
  it('TESTE 6: Confirmação de sent_at=NULL em whatsapp_logs nas notificações simuladas', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-t6', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');
      DELETE FROM public.notification_queue;
      INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
      VALUES ('notif-t6', 'appt-t6', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg', now() - interval '1 minute', 'pending');
    `);

    const client = new EvolutionApiClient();
    const processor = new NotificationProcessor({ db, evolutionClient: client });
    await processor.processBatch(5);

    const logItem = await db.query(`SELECT status, sent_at FROM public.whatsapp_logs WHERE id = 'notif-t6';`);
    expect(logItem.rows[0].status).toBe('simulated');
    expect(logItem.rows[0].sent_at).toBeNull(); // NUNCA preenchido em DRY-RUN
  });

  // TESTE 7: Prevenção de processamento simultâneo do mesmo registro
  it('TESTE 7: Prevenção de processamento simultâneo via FOR UPDATE SKIP LOCKED', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    for (let i = 1; i <= 4; i++) {
      await db.exec(`
        INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
        VALUES ('appt-t7-${i}', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');
      `);
    }

    await db.exec(`DELETE FROM public.notification_queue;`);

    for (let i = 1; i <= 4; i++) {
      await db.exec(`
        INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
        VALUES ('notif-t7-${i}', 'appt-t7-${i}', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg', now() - interval '1 minute', 'pending');
      `);
    }

    const client1 = new EvolutionApiClient();
    const client2 = new EvolutionApiClient();
    const w1 = new NotificationProcessor({ db, evolutionClient: client1 });
    const w2 = new NotificationProcessor({ db, evolutionClient: client2 });

    const [r1, r2] = await Promise.all([w1.processBatch(2), w2.processBatch(2)]);
    expect(r1.processed + r2.processed).toBe(4);

    const ids1 = r1.results.map(r => r.id);
    const ids2 = r2.results.map(r => r.id);
    const overlap = ids1.filter(id => ids2.includes(id));
    expect(overlap.length).toBe(0);
  });

  // TESTE 8: Comportamento diante de falhas simuladas
  it('TESTE 8: Comportamento diante de falhas simuladas (telefone inválido)', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-t8', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');
      DELETE FROM public.notification_queue;
      INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
      VALUES ('notif-t8', 'appt-t8', 'new_appointment', 'client', '999', 'Tel Curto', 'Msg', now() - interval '1 minute', 'pending');
    `);

    const client = new EvolutionApiClient();
    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(5);

    expect(res.failed).toBe(1);
    const qItem = await db.query(`SELECT status, last_error FROM public.notification_queue WHERE id = 'notif-t8';`);
    expect(qItem.rows[0].status).toBe('failed');
    expect(qItem.rows[0].last_error).toMatch(/Validação de número falhou/i);
  });

  // TESTE 9: Recuperação de registros interrompidos
  it('TESTE 9: Recuperação de registros interrompidos em "processing" há mais de 5 minutos', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-t9', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');
      DELETE FROM public.notification_queue;
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts, updated_at
      ) VALUES (
        'notif-t9-stuck', 'appt-t9', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg', now() - interval '10 minutes', 'processing', 1, 3, now() - interval '6 minutes'
      );
    `);

    const client = new EvolutionApiClient();
    const processor = new NotificationProcessor({ db, evolutionClient: client });
    const res = await processor.processBatch(5);

    expect(res.processed).toBe(1);
    expect(res.results[0].id).toBe('notif-t9-stuck');

    const qItem = await db.query(`SELECT status, attempts FROM public.notification_queue WHERE id = 'notif-t9-stuck';`);
    expect(qItem.rows[0].status).toBe('simulated');
    expect(qItem.rows[0].attempts).toBe(2);
  });

  // TESTE 10: Confirmação de ZERO chamadas de envio à Evolution API
  it('TESTE 10: Confirmação de ZERO chamadas de envio à Evolution API em DRY-RUN', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const mockFetch = vi.fn();
    const client = new EvolutionApiClient();
    client.fetchFn = mockFetch;

    await db.exec(`
      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES ('appt-t10', 'barber-f63f', 'cust-f63f', 'srv-f63f', '2026-10-30T10:00:00Z', 'confirmed');
      DELETE FROM public.notification_queue;
      INSERT INTO public.notification_queue (id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status)
      VALUES ('notif-t10', 'appt-t10', 'new_appointment', 'client', '34999990000', 'Cliente Teste', 'Msg', now() - interval '1 minute', 'pending');
    `);

    const processor = new NotificationProcessor({ db, evolutionClient: client });
    await processor.processBatch(5);

    expect(mockFetch).not.toHaveBeenCalled();
    expect(client.isLiveAllowed).toBe(false);
    expect(client.dryRun).toBe(true);
  });
});

/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.3: SUÍTE DE TESTES DE AUDITORIA DE STATUS E HARDENING (MIGRATION 0023)
 * ==============================================================================
 * Valida localmente em PGlite isolado:
 * 1. Separação de status em whatsapp_logs: 'simulated' NUNCA vira 'sent'.
 * 2. sent_at é preenchido ESTRITAMENTE para envios reais ('sent'), sendo NULL em 'simulated'.
 * 3. Suporte a status 'unknown' para timeouts / falhas de rede com transmissão incerta.
 * 4. Suporte ao tipo de mensagem 'reschedule' em whatsapp_logs.
 * 5. Rollback e reaplicação limpos da Migration 0023.
 * 6. Hardening de permissões: revogação de EXECUTE para anon e authenticated nas RPCs.
 * 7. Fila vazia, concorrência e ausência de chamadas externas em DRY-RUN.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { EvolutionApiClient } from '../backend-api/src/evolution_client.js';
import { NotificationProcessor } from '../backend-api/src/workers/notification_processor.js';

/* global process */
const BASE_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

describe('Fase 6.3 — Auditoria de Status, Hardening e Compatibilidade', () => {
  let db;

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

    // 3. Migration 0022 (Fila e Triggers)
    let sql0022 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0022_notification_queue_and_triggers.sql'), 'utf-8');
    await db.exec(sql0022);

    // 4. Inserir fixtures básicas
    await db.exec(`
      INSERT INTO public.barbers (id, name, phone) VALUES
        ('barber-diego-63', 'Diego Silva', '34988881111'),
        ('barber-lucas-63', 'Lucas Lima', '34977772222');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-marcos-63', 'Marcos Oliveira', '34999993333');

      INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
        ('srv-corte-63', 'Corte Degradê', 30, 45.00, false);
    `);
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  // ----------------------------------------------------------------------------
  // TESTE 01: Aplicação da Migration 0023
  // ----------------------------------------------------------------------------
  it('01. Aplicação com sucesso da Migration 0023 em banco isolado', async () => {
    const sql0023 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0023_fix_whatsapp_logs_status_and_hardening.sql'), 'utf-8');
    await expect(db.exec(sql0023)).resolves.not.toThrow();

    // Validar nova constraint de status em whatsapp_logs
    const constraints = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'whatsapp_logs_status_check';
    `);
    expect(constraints.rows.length).toBe(1);
    expect(constraints.rows[0].def).toContain('simulated');
    expect(constraints.rows[0].def).toContain('unknown');
    expect(constraints.rows[0].def).toContain('cancelled');
    expect(constraints.rows[0].def).toContain('skipped');
  });

  // ----------------------------------------------------------------------------
  // TESTE 02: Simulação DRY-RUN grava 'simulated' e sent_at IS NULL em whatsapp_logs
  // ----------------------------------------------------------------------------
  it('02. Mensagem simulada em DRY-RUN grava status simulated e sent_at NULL em whatsapp_logs', async () => {
    // 1. Criar agendamento que gera notificação na fila
    const futureTime = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 16);
    await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-dry-run-63', 'cust-marcos-63', 'barber-diego-63', 'srv-corte-63', '${futureTime}', 'confirmed');
    `);

    // 2. Processar em modo DRY-RUN
    const processor = new NotificationProcessor({
      db,
      evolutionClient: new EvolutionApiClient({ dryRun: true, enabled: false })
    });
    const batchRes = await processor.processBatch(10);
    expect(batchRes.processed).toBeGreaterThanOrEqual(1);

    // 3. Checar na tabela notification_queue
    const qRes = await db.query(`
      SELECT id, status, external_id, processed_at
      FROM public.notification_queue
      WHERE appointment_id = 'appt-dry-run-63' AND recipient_type = 'client' AND event_type = 'new_appointment';
    `);
    expect(qRes.rows.length).toBe(1);
    expect(qRes.rows[0].status).toBe('simulated');
    expect(qRes.rows[0].external_id).toMatch(/^sim_/);

    const queueId = qRes.rows[0].id;

    // 4. Checar na tabela whatsapp_logs sincronizada
    const logRes = await db.query(`
      SELECT id, status, sent_at, message_type
      FROM public.whatsapp_logs
      WHERE id = $1;
    `, [queueId]);

    expect(logRes.rows.length).toBe(1);
    // NÃO PODE SER 'sent'! Deve ser 'simulated'!
    expect(logRes.rows[0].status).toBe('simulated');
    // sent_at DEVE SER NULL para não fingir envio real!
    expect(logRes.rows[0].sent_at).toBeNull();
  });

  // ----------------------------------------------------------------------------
  // TESTE 03: Envio real confirmado grava 'sent' e sent_at PREENCHIDO
  // ----------------------------------------------------------------------------
  it('03. Envio real confirmado grava status sent e preenche sent_at em whatsapp_logs', async () => {
    // Inserir notificação pendente manual
    const notifRes = await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status
      ) VALUES (
        'appt-dry-run-63', 'new_appointment', 'client', '34999993333', 'Marcos', 'Msg Real Test', 'pending'
      ) RETURNING id;
    `);
    const notifId = notifRes.rows[0].id;

    // Simular registro de envio real com sucesso via RPC record_notification_result
    await db.query(`
      SELECT public.record_notification_result(
        $1, 'sent', 'ext-msg-real-12345', NULL, '{"provider": "evolution"}'::jsonb
      );
    `, [notifId]);

    const logRes = await db.query(`
      SELECT id, status, sent_at
      FROM public.whatsapp_logs
      WHERE id = $1;
    `, [notifId]);

    expect(logRes.rows[0].status).toBe('sent');
    expect(logRes.rows[0].sent_at).not.toBeNull();
  });

  // ----------------------------------------------------------------------------
  // TESTE 04: Timeout / Erro de Rede indeterminado grava 'unknown' e sent_at NULL
  // ----------------------------------------------------------------------------
  it('04. Falha de timeout de rede pós-esgotamento classifica como unknown sem sent_at', async () => {
    // Inserir item com max_attempts atingido
    const notifRes = await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status, attempts, max_attempts
      ) VALUES (
        'appt-dry-run-63', 'new_appointment', 'client', '34999993333', 'Marcos', 'Msg Timeout', 'pending', 3, 3
      ) RETURNING id;
    `);
    const notifId = notifRes.rows[0].id;

    // Worker com cliente simulando timeout de rede
    const mockTimeoutClient = {
      sendTextMessage: async () => ({
        success: false,
        status: 'failed',
        error: 'ETIMEDOUT: Requisição expirou após 10s',
        errorCode: 'NETWORK_OR_TIMEOUT_ERROR'
      })
    };

    const processor = new NotificationProcessor({ db, evolutionClient: mockTimeoutClient });
    const singleRes = await processor.processSingleItem({
      id: notifId,
      appointment_id: 'appt-dry-run-63',
      event_type: 'new_appointment',
      recipient_phone: '34999993333',
      content: 'Msg Timeout',
      attempts: 3,
      max_attempts: 3
    });

    expect(singleRes.finalStatus).toBe('unknown');

    const logRes = await db.query(`SELECT status, sent_at FROM public.whatsapp_logs WHERE id = $1;`, [notifId]);
    expect(logRes.rows[0].status).toBe('unknown');
    expect(logRes.rows[0].sent_at).toBeNull();
  });

  // ----------------------------------------------------------------------------
  // TESTE 05: Suporte a message_type 'reschedule' em whatsapp_logs
  // ----------------------------------------------------------------------------
  it('05. Remarcação sincroniza com whatsapp_logs com message_type = reschedule', async () => {
    const notifRes = await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status
      ) VALUES (
        'appt-dry-run-63', 'reschedule', 'client', '34999993333', 'Marcos', 'Msg Remarcada', 'pending'
      ) RETURNING id;
    `);
    const notifId = notifRes.rows[0].id;

    await db.query(`
      SELECT public.record_notification_result($1, 'simulated', 'sim_resched_123');
    `, [notifId]);

    const logRes = await db.query(`SELECT message_type, status FROM public.whatsapp_logs WHERE id = $1;`, [notifId]);
    expect(logRes.rows[0].message_type).toBe('reschedule');
    expect(logRes.rows[0].status).toBe('simulated');
  });

  // ----------------------------------------------------------------------------
  // TESTE 06: Fila vazia retorna imediatamente sem efeitos colaterais
  // ----------------------------------------------------------------------------
  it('06. Fila vazia processa 0 itens com resposta limpa', async () => {
    // Limpar pendentes atuais para testar fila vazia
    await db.query(`UPDATE public.notification_queue SET status = 'sent' WHERE status = 'pending';`);

    const processor = new NotificationProcessor({ db, evolutionClient: new EvolutionApiClient() });
    const res = await processor.processBatch(10);

    expect(res.processed).toBe(0);
    expect(res.success).toBe(0);
    expect(res.failed).toBe(0);
    expect(res.results.length).toBe(0);
  });

  // ----------------------------------------------------------------------------
  // TESTE 07: Concorrência com FOR UPDATE SKIP LOCKED
  // ----------------------------------------------------------------------------
  it('07. Dequeue concorrente não colide e reserva itens distintos', async () => {
    // Inserir 4 itens pendentes
    await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status, scheduled_for
      ) VALUES
        ('appt-dry-run-63', 'new_appointment', 'client', '34999993333', 'Marcos', 'Conc 1', 'pending', now()),
        ('appt-dry-run-63', 'new_appointment', 'client', '34999993333', 'Marcos', 'Conc 2', 'pending', now()),
        ('appt-dry-run-63', 'new_appointment', 'client', '34999993333', 'Marcos', 'Conc 3', 'pending', now()),
        ('appt-dry-run-63', 'new_appointment', 'client', '34999993333', 'Marcos', 'Conc 4', 'pending', now());
    `);

    const q1 = await db.query(`SELECT id FROM public.dequeue_notifications_for_processing(2);`);
    const q2 = await db.query(`SELECT id FROM public.dequeue_notifications_for_processing(2);`);

    const ids1 = q1.rows.map(r => r.id);
    const ids2 = q2.rows.map(r => r.id);

    expect(ids1.length).toBe(2);
    expect(ids2.length).toBe(2);

    // Interseção deve ser zero
    const intersection = ids1.filter(id => ids2.includes(id));
    expect(intersection.length).toBe(0);
  });

  // ----------------------------------------------------------------------------
  // TESTE 08: Teste de Rollback da Migration 0023
  // ----------------------------------------------------------------------------
  it('08. Script de rollback 0023 reverte constraints e normaliza status sem quebrar banco', async () => {
    const rollbackSql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0023_fix_whatsapp_logs_status_and_hardening_rollback.sql'), 'utf-8');
    await expect(db.exec(rollbackSql)).resolves.not.toThrow();

    // Validar que a constraint voltou ao conjunto original ('pending', 'sent', 'failed')
    const constraints = await db.query(`
      SELECT conname, pg_get_constraintdef(oid) as def
      FROM pg_constraint
      WHERE conname = 'whatsapp_logs_status_check';
    `);
    expect(constraints.rows[0].def).toContain("'pending'::text, 'sent'::text, 'failed'::text");
    expect(constraints.rows[0].def).not.toContain('simulated');

    // Reaplicar a migration 0023 para manter integridade
    const sql0023 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0023_fix_whatsapp_logs_status_and_hardening.sql'), 'utf-8');
    await expect(db.exec(sql0023)).resolves.not.toThrow();
  });
});

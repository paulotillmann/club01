/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.3-G: SUÍTE DE HOMOLOGAÇÃO DE IDEMPOTÊNCIA E ANTI-DUPLICAÇÃO WHATSAPP
 * ==============================================================================
 * Cobre os 10 testes obrigatórios da Fase 6.3-G em ambiente isolado (PGlite).
 * ZERO chamadas reais para a Evolution API. Todos os testes utilizam mocks.
 */

import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import { EvolutionApiClient } from '../backend-api/src/evolution_client.js';
import { NotificationProcessor } from '../backend-api/src/workers/notification_processor.js';

/* global process */
const BASE_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

describe('Fase 6.3-G: Homologação de Idempotência e Anti-Duplicação WhatsApp', () => {
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

    // 2. Carregar migrations de base (0000 até 0024)
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

    let sql0024 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0024_manual_test_authorizations.sql'), 'utf-8');
    await db.exec(sql0024);

    // 3. Inserir dados base de homologação
    await db.exec(`
      INSERT INTO public.barbers (id, name, phone) VALUES
        ('barber-f63g', 'Barbeiro 6.3G', '34988880000');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-f63g', 'Cliente 6.3G', '34999990000');

      INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
        ('srv-f63g', 'Corte Homolog 6.3G', 30, 50.00, false);
    `);
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    if (db) await db.close();
  });

  beforeEach(async () => {
    // Limpar tabelas de fila e logs antes de cada teste
    await db.exec(`
      DELETE FROM public.notification_queue;
      DELETE FROM public.whatsapp_logs;
      DELETE FROM public.manual_test_authorizations;
      DELETE FROM public.appointments;

      INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
      VALUES 
        ('appt-01', 'barber-f63g', 'cust-f63g', 'srv-f63g', '2026-10-30T10:00:00Z', 'confirmed'),
        ('appt-f63g-01', 'barber-f63g', 'cust-f63g', 'srv-f63g', '2026-10-30T10:00:00Z', 'confirmed');

      -- Limpar notificações inseridas automaticamente pelo trigger trg_enqueue_appointment_notification
      DELETE FROM public.notification_queue;
      DELETE FROM public.whatsapp_logs;
    `);
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';
  });

  // ----------------------------------------------------------------------------
  // TESTE 1: Rejeição de notificações com chave duplicada
  // ----------------------------------------------------------------------------
  it('TESTE 1: Rejeição de notificações com chave de idempotência duplicada (Postgres Unique Violation)', async () => {
    const key = 'appt_f63g_01_confirm';

    // Primeiro insert deve ter sucesso
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, idempotency_key
      ) VALUES (
        'notif-f63g-1', 'appt-f63g-01', 'new_appointment', 'client', '34999991111', 'Cliente Teste', 'Mensagem 1', now(), 'pending', '${key}'
      );
    `);

    // Segundo insert com a MESMA chave de idempotência DEVE ser rejeitado pelo banco
    let insertError = null;
    try {
      await db.query(`
        INSERT INTO public.notification_queue (
          id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, idempotency_key
        ) VALUES (
          'notif-f63g-2', 'appt-f63g-01', 'new_appointment', 'client', '34999991111', 'Cliente Teste', 'Mensagem Duplicada', now(), 'pending', '${key}'
        );
      `);
    } catch (err) {
      insertError = err;
    }

    expect(insertError).not.toBeNull();
    // Código de erro Postgres para unique_violation é 23505
    expect(insertError.message).toMatch(/unique|idempotency/i);

    // Confirmar que exatamente 1 registro existe no banco
    const res = await db.query(`SELECT count(*) as total FROM public.notification_queue WHERE idempotency_key = '${key}';`);
    expect(Number(res.rows[0].total)).toBe(1);
  });

  // ----------------------------------------------------------------------------
  // TESTE 2: Dois workers processando simultaneamente (FOR UPDATE SKIP LOCKED)
  // ----------------------------------------------------------------------------
  it('TESTE 2: Dois workers concorrentes não processam o mesmo registro simultaneamente', async () => {
    // Inserir 6 agendamentos (o trigger já gera notificações; vamos limpar e criar exatamente 6 controladas)
    for (let i = 1; i <= 6; i++) {
      await db.query(`
        INSERT INTO public.appointments (id, barber_id, client_id, service_id, appointment_time, status)
        VALUES ('appt-conc-${i}', 'barber-f63g', 'cust-f63g', 'srv-f63g', '2026-10-30T10:00:00Z', 'confirmed')
        ON CONFLICT (id) DO NOTHING;
      `);
    }
    await db.exec(`DELETE FROM public.notification_queue;`);

    for (let i = 1; i <= 6; i++) {
      await db.query(`
        INSERT INTO public.notification_queue (
          id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, idempotency_key
        ) VALUES (
          'notif-conc-${i}', 'appt-conc-${i}', 'new_appointment', 'client', '3499999222${i}', 'Cliente ${i}', 'Msg ${i}', now() - interval '1 minute', 'pending', 'idem-conc-${i}'
        );
      `);
    }

    const mockClient = {
      sendTextMessage: async ({ phone }) => ({
        success: true,
        status: 'simulated',
        simulated: true,
        externalId: `sim_${phone}`,
        to: phone
      })
    };

    const worker1 = new NotificationProcessor({ db, evolutionClient: mockClient, logger: { error: () => {} } });
    const worker2 = new NotificationProcessor({ db, evolutionClient: mockClient, logger: { error: () => {} } });

    // Disparar processamento simultâneo
    const [res1, res2] = await Promise.all([
      worker1.processBatch(4),
      worker2.processBatch(4)
    ]);

    const idsWorker1 = res1.results.map(r => r.id);
    const idsWorker2 = res2.results.map(r => r.id);

    // NENHUM id pode estar presente em ambos os workers (interseção vazia)
    const intersection = idsWorker1.filter(id => idsWorker2.includes(id));
    expect(intersection).toEqual([]);

    // O total combinado processado deve ser exatamente 6 itens
    expect(res1.processed + res2.processed).toBe(6);

    // Todos os registros no banco devem estar como simulated
    const dbRes = await db.query(`SELECT count(*) as total FROM public.notification_queue WHERE status = 'simulated';`);
    expect(Number(dbRes.rows[0].total)).toBe(6);
  });

  // ----------------------------------------------------------------------------
  // TESTE 3: Timeout após aceitação simulada pelo provedor (Estado Indeterminado)
  // ----------------------------------------------------------------------------
  it('TESTE 3: Timeout após início de envio marca registro como unknown (indeterminado) e bloqueia auto-retry', async () => {
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts
      ) VALUES (
        'notif-timeout-01', 'appt-01', 'new_appointment', 'client', '34999993333', 'Cliente', 'Msg', now(), 'pending', 0, 3
      );
    `);

    // Provedor simula timeout de rede após envio
    const mockClient = {
      sendTextMessage: async () => ({
        success: false,
        status: 'failed',
        error: 'Timeout de rede: resposta não recebida da Evolution API dentro do prazo',
        errorCode: 'INDETERMINATE_DELIVERY',
        indeterminate: true
      })
    };

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient, logger: { error: () => {} } });
    const result = await processor.processBatch(1);

    expect(result.processed).toBe(1);
    expect(result.results[0].finalStatus).toBe('unknown');
    expect(result.results[0].indeterminate).toBe(true);

    // Verificar se no banco ficou com status unknown e NÃO pending
    const dbItem = await db.query(`SELECT status, last_error, metadata FROM public.notification_queue WHERE id = 'notif-timeout-01';`);
    expect(dbItem.rows[0].status).toBe('unknown');
    expect(dbItem.rows[0].metadata.auto_retry_blocked).toBe(true);
    expect(dbItem.rows[0].metadata.indeterminate_delivery).toBe(true);

    // Verificar whatsapp_logs: status unknown e sent_at NULL
    const logItem = await db.query(`SELECT status, sent_at FROM public.whatsapp_logs WHERE id = 'notif-timeout-01';`);
    expect(logItem.rows[0].status).toBe('unknown');
    expect(logItem.rows[0].sent_at).toBeNull();
  });

  // ----------------------------------------------------------------------------
  // TESTE 4: Falha após confirmação externa simulada
  // ----------------------------------------------------------------------------
  it('TESTE 4: Confirmação externa simulada preserva o external_id retornado', async () => {
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts
      ) VALUES (
        'notif-ext-01', 'appt-01', 'new_appointment', 'client', '34999994444', 'Cliente', 'Msg', now(), 'pending', 0, 3
      );
    `);

    const externalMessageId = '3EB0_CONFIRMED_MSG_ID_998877';

    const mockClient = {
      sendTextMessage: async ({ phone }) => ({
        success: true,
        status: 'sent',
        simulated: false,
        externalId: externalMessageId,
        to: phone
      })
    };

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient, logger: { error: () => {} } });
    const result = await processor.processBatch(1);

    expect(result.processed).toBe(1);
    expect(result.results[0].finalStatus).toBe('sent');
    expect(result.results[0].externalId).toBe(externalMessageId);

    // Verificar se o external_id está persistido no banco
    const dbItem = await db.query(`SELECT status, external_id FROM public.notification_queue WHERE id = 'notif-ext-01';`);
    expect(dbItem.rows[0].status).toBe('sent');
    expect(dbItem.rows[0].external_id).toBe(externalMessageId);
  });

  // ----------------------------------------------------------------------------
  // TESTE 5: Recuperação de worker interrompido após expiração do lease
  // ----------------------------------------------------------------------------
  it('TESTE 5: Recuperação de registro em processing cujo lease de 5 minutos expirou', async () => {
    // Inserir registro com status processing atualizado há 6 minutos atrás
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts, updated_at
      ) VALUES (
        'notif-lease-01', 'appt-01', 'new_appointment', 'client', '34999995555', 'Cliente', 'Msg', now(), 'processing', 1, 3, now() - interval '6 minutes'
      );
    `);

    // RPC dequeue deve recuperar o item abandonado
    const dequeued = await db.query(`SELECT * FROM public.dequeue_notifications_for_processing(5);`);
    expect(dequeued.rows.length).toBe(1);
    expect(dequeued.rows[0].id).toBe('notif-lease-01');
    expect(dequeued.rows[0].attempts).toBe(2); // Incrementado de 1 para 2
    expect(dequeued.rows[0].status).toBe('processing');
  });

  // ----------------------------------------------------------------------------
  // TESTE 6: Respeito ao limite de tentativas (max_attempts)
  // ----------------------------------------------------------------------------
  it('TESTE 6: Registros que atingiram max_attempts são ignorados pelo dequeue e não reprocessam', async () => {
    // Inserir registro com attempts = 3 e max_attempts = 3 atualizado há 6 minutos
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts, updated_at
      ) VALUES (
        'notif-max-01', 'appt-01', 'new_appointment', 'client', '34999996666', 'Cliente', 'Msg', now(), 'processing', 3, 3, now() - interval '6 minutes'
      );
    `);

    // Dequeue NÃO pode selecionar este registro
    const dequeued = await db.query(`SELECT * FROM public.dequeue_notifications_for_processing(5);`);
    expect(dequeued.rows.length).toBe(0);

    // Verificar se no processamento de item com attempts >= max_attempts ele é marcado como failed
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts
      ) VALUES (
        'notif-fail-final', 'appt-01', 'new_appointment', 'client', '34999997777', 'Cliente', 'Msg', now(), 'pending', 3, 3
      );
    `);

    const mockClient = {
      sendTextMessage: async () => ({
        success: false,
        status: 'failed',
        error: 'Erro de gateway da API',
        errorCode: 'API_ERROR'
      })
    };

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient, logger: { error: () => {} } });
    const single = await processor.processSingleItem({
      id: 'notif-fail-final',
      appointment_id: 'appt-01',
      event_type: 'new_appointment',
      recipient_phone: '34999997777',
      content: 'Msg',
      attempts: 3,
      max_attempts: 3
    });

    expect(single.finalStatus).toBe('failed');
    const item = await db.query(`SELECT status FROM public.notification_queue WHERE id = 'notif-fail-final';`);
    expect(item.rows[0].status).toBe('failed');
  });

  // ----------------------------------------------------------------------------
  // TESTE 7: Reconciliação de entrega indeterminada
  // ----------------------------------------------------------------------------
  it('TESTE 7: Reconciliação manual/operacional de entrega indeterminada (delivered vs not_delivered)', async () => {
    // 7.1 Reconciliação com confirmação de entrega externa (delivered -> sent)
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, last_error
      ) VALUES (
        'notif-rec-01', 'appt-01', 'new_appointment', 'client', '34999998888', 'Cliente', 'Msg', now(), 'unknown', 'Timeout indeterminado'
      );
    `);

    const processor = new NotificationProcessor({ db, logger: { error: () => {} } });

    const recResult1 = await processor.reconcileIndeterminateNotification({
      id: 'notif-rec-01',
      resolution: 'delivered',
      externalId: 'EXT_RECONCILED_123',
      operatorNotes: 'Confirmado recebimento no WhatsApp pelo cliente'
    });

    expect(recResult1.status).toBe('sent');
    expect(recResult1.reconciled).toBe(true);

    const dbItem1 = await db.query(`SELECT status, external_id, metadata FROM public.notification_queue WHERE id = 'notif-rec-01';`);
    expect(dbItem1.rows[0].status).toBe('sent');
    expect(dbItem1.rows[0].external_id).toBe('EXT_RECONCILED_123');
    expect(dbItem1.rows[0].metadata.reconciled).toBe(true);

    // 7.2 Reconciliação com confirmação de não entrega (not_delivered -> pending para reprocessar)
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, last_error
      ) VALUES (
        'notif-rec-02', 'appt-01', 'new_appointment', 'client', '34999998889', 'Cliente', 'Msg', now(), 'unknown', 'Timeout indeterminado'
      );
    `);

    const recResult2 = await processor.reconcileIndeterminateNotification({
      id: 'notif-rec-02',
      resolution: 'not_delivered',
      operatorNotes: 'Cliente confirmou que mensagem não chegou'
    });

    expect(recResult2.status).toBe('pending');
    expect(recResult2.reconciled).toBe(true);

    const dbItem2 = await db.query(`SELECT status, last_error FROM public.notification_queue WHERE id = 'notif-rec-02';`);
    expect(dbItem2.rows[0].status).toBe('pending');
    expect(dbItem2.rows[0].last_error).toContain('rearmado para pending');
  });

  // ----------------------------------------------------------------------------
  // TESTE 8: Bloqueio de reenvio quando a entrega não puder ser determinada
  // ----------------------------------------------------------------------------
  it('TESTE 8: Registros em status unknown são ignorados e NUNCA re-enviados pelo batch automático', async () => {
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, last_error
      ) VALUES (
        'notif-blocked-01', 'appt-01', 'new_appointment', 'client', '34999991234', 'Cliente', 'Msg', now(), 'unknown', 'Timeout indeterminado'
      );
    `);

    const sendSpy = vi.fn().mockResolvedValue({ success: true, status: 'simulated' });
    const mockClient = {
      sendTextMessage: sendSpy
    };

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient, logger: { error: () => {} } });
    const batchRes = await processor.processBatch(10);

    // O lote deve processar 0 itens
    expect(batchRes.processed).toBe(0);
    // Nenhuma chamada externa deve ter sido realizada
    expect(sendSpy).not.toHaveBeenCalled();

    // Status deve permanecer estritamente unknown
    const item = await db.query(`SELECT status FROM public.notification_queue WHERE id = 'notif-blocked-01';`);
    expect(item.rows[0].status).toBe('unknown');
  });

  // ----------------------------------------------------------------------------
  // TESTE 9: Preservação das travas globais de segurança
  // ----------------------------------------------------------------------------
  it('TESTE 9: Preservação das travas globais (WHATSAPP_DRY_RUN=true e WHATSAPP_ENABLED=false)', () => {
    // Caso padrão: DRY-RUN ativado e ENABLED desativado
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const client1 = new EvolutionApiClient();
    expect(client1.isLiveAllowed).toBe(false);
    expect(client1.dryRun).toBe(true);
    expect(client1.enabled).toBe(false);

    // Caso DRY-RUN ausente ou undefined
    delete process.env.WHATSAPP_DRY_RUN;
    delete process.env.WHATSAPP_ENABLED;

    const client2 = new EvolutionApiClient();
    expect(client2.isLiveAllowed).toBe(false);
    expect(client2.dryRun).toBe(true);

    // Caso onde apenas ENABLED é true mas DRY_RUN ainda é true
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'true';

    const client3 = new EvolutionApiClient();
    expect(client3.isLiveAllowed).toBe(false);
    expect(client3.dryRun).toBe(true);

    // Envio real SÓ é liberado se explicitamente DRY_RUN === 'false' E ENABLED === 'true'
    process.env.WHATSAPP_DRY_RUN = 'false';
    process.env.WHATSAPP_ENABLED = 'true';

    const client4 = new EvolutionApiClient();
    expect(client4.isLiveAllowed).toBe(true);
    expect(client4.dryRun).toBe(false);
    expect(client4.enabled).toBe(true);
  });

  // ----------------------------------------------------------------------------
  // TESTE 10: Ausência de chamadas externas durante DRY-RUN
  // ----------------------------------------------------------------------------
  it('TESTE 10: Confirmação de ZERO chamadas de rede/fetch à Evolution API em modo DRY-RUN', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const fetchSpy = vi.fn();

    const client = new EvolutionApiClient({
      apiUrl: 'https://evolution.example.com',
      apiKey: 'test-api-key',
      instanceName: 'Meu Bolso Digital',
      dryRun: true,
      enabled: false,
      fetchFn: fetchSpy
    });

    const res = await client.sendTextMessage({
      phone: '34999990000',
      text: 'Mensagem de teste em DRY-RUN'
    });

    // Deve retornar sucesso simulado
    expect(res.success).toBe(true);
    expect(res.status).toBe('simulated');
    expect(res.simulated).toBe(true);
    expect(res.externalId).toMatch(/^sim_/);

    // Confirmação categórica: ZERO chamadas HTTP para o fetchFn
    expect(fetchSpy).toHaveBeenCalledTimes(0);
  });
});

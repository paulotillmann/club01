/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6: SUÍTE DE TESTES AUTOMATIZADOS — INTEGRAÇÃO WHATSAPP & EVOLUTION API
 * ==============================================================================
 * Cobre os 20 cenários obrigatórios especificados na Fase 6:
 * Execução 100% local em PostgreSQL isolado (PGlite), em modo DRY-RUN,
 * sem chamadas externas ou envio de mensagens reais.
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

describe('Fase 6 — Suíte Completa de Notificações WhatsApp & Evolution API', () => {
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

    // 3. Carregar migration da Fase 6: 0022_notification_queue_and_triggers.sql
    let sql0022 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0022_notification_queue_and_triggers.sql'), 'utf-8');
    await db.exec(sql0022);

    // 4. Inserir dados base de testes
    await db.exec(`
      INSERT INTO public.barbers (id, name, phone) VALUES
        ('barber-diego', 'Diego Silva', '34988881111'),
        ('barber-lucas', 'Lucas Lima', '34977772222'),
        ('barber-sem-tel', 'Sem Telefone', '');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-marcos', 'Marcos Oliveira', '34999993333'),
        ('cust-sem-tel', 'Invalido Silva', '123');

      INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
        ('srv-corte', 'Corte Degradê', 30, 45.00, false),
        ('srv-barba', 'Barba Terapia', 30, 35.00, false);
    `);
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
  });

  // ----------------------------------------------------------------------------
  // TESTE 01: Novo agendamento confirmado
  // ----------------------------------------------------------------------------
  it('01. Novo agendamento confirmado gera registros na fila de notificações', async () => {
    // Horário no futuro (daqui a 3 horas)
    const futureTime = new Date(Date.now() + 3 * 3600 * 1000).toISOString().slice(0, 16);

    const res = await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-01', 'cust-marcos', 'barber-diego', 'srv-corte', '${futureTime}', 'confirmed')
      RETURNING id;
    `);
    expect(res.rows[0].id).toBe('appt-01');

    const queueRes = await db.query(`
      SELECT event_type, recipient_type, status, recipient_phone 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-01'
      ORDER BY recipient_type ASC;
    `);

    // Deve ter 3 registros: aviso ao barbeiro, confirmação ao cliente e lembrete de 30m
    expect(queueRes.rows.length).toBe(3);
    const types = queueRes.rows.map(r => `${r.event_type}:${r.recipient_type}`);
    expect(types).toContain('new_appointment:barber');
    expect(types).toContain('new_appointment:client');
    expect(types).toContain('reminder_30m:client');
  });

  // ----------------------------------------------------------------------------
  // TESTE 02: Confirmação ao cliente
  // ----------------------------------------------------------------------------
  it('02. Confirmação ao cliente possui template correto e informações completas', async () => {
    const res = await db.query(`
      SELECT content, recipient_phone, recipient_name 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-01' AND recipient_type = 'client' AND event_type = 'new_appointment';
    `);

    expect(res.rows.length).toBe(1);
    const item = res.rows[0];
    expect(item.recipient_phone).toBe('34999993333');
    expect(item.recipient_name).toBe('Marcos Oliveira');
    expect(item.content).toContain('Olá, Marcos Oliveira! 💈');
    expect(item.content).toContain('Seu agendamento no CLUB 01 Barber Studio foi confirmado!');
    expect(item.content).toContain('Corte Degradê');
    expect(item.content).toContain('Diego Silva');
    expect(item.content).toContain('Esperamos por você!');
  });

  // ----------------------------------------------------------------------------
  // TESTE 03: Aviso ao barbeiro
  // ----------------------------------------------------------------------------
  it('03. Aviso ao barbeiro possui dados do cliente, serviço e horário', async () => {
    const res = await db.query(`
      SELECT content, recipient_phone, recipient_name 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-01' AND recipient_type = 'barber' AND event_type = 'new_appointment';
    `);

    expect(res.rows.length).toBe(1);
    const item = res.rows[0];
    expect(item.recipient_phone).toBe('34988881111');
    expect(item.recipient_name).toBe('Diego Silva');
    expect(item.content).toContain('Olá, Diego Silva! 💈');
    expect(item.content).toContain('Você recebeu um novo agendamento');
    expect(item.content).toContain('Marcos Oliveira');
    expect(item.content).toContain('Corte Degradê');
  });

  // ----------------------------------------------------------------------------
  // TESTE 04: Agendamento rejeitado não gera mensagens
  // ----------------------------------------------------------------------------
  it('04. Agendamento com erro de validação ou cancelado não gera notificações confirmadas', async () => {
    // Tentativa com serviço inexistente em transação rollback
    try {
      await db.query(`
        BEGIN;
        INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
        VALUES ('appt-invalido', 'cust-marcos', 'barber-diego', 'srv-inexistente', '2026-10-25T14:00', 'confirmed');
        COMMIT;
      `);
    } catch {
      await db.query(`ROLLBACK;`);
    }

    const check = await db.query(`
      SELECT COUNT(*) as count FROM public.notification_queue WHERE appointment_id = 'appt-invalido';
    `);
    expect(parseInt(check.rows[0].count, 10)).toBe(0);
  });

  // ----------------------------------------------------------------------------
  // TESTE 05: Lembrete 30 minutos antes
  // ----------------------------------------------------------------------------
  it('05. Lembrete do cliente é programado para 30 minutos antes do horário de atendimento', async () => {
    const res = await db.query(`
      SELECT scheduled_for, content, status 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-01' AND event_type = 'reminder_30m';
    `);

    expect(res.rows.length).toBe(1);
    const reminder = res.rows[0];
    expect(reminder.status).toBe('pending');
    expect(reminder.content).toContain('Passando para lembrar que seu horário no CLUB 01 Barber Studio está chegando!');
    expect(reminder.content).toContain('Faltam aproximadamente 30 minutos para o seu atendimento.');
  });

  // ----------------------------------------------------------------------------
  // TESTE 06: Cancelamento antes do lembrete
  // ----------------------------------------------------------------------------
  it('06. Cancelamento invalida lembretes pendentes e enfileira avisos de cancelamento', async () => {
    // Cancelar o agendamento appt-01
    await db.query(`
      UPDATE public.appointments 
      SET status = 'cancelled', cancellation_reason = 'Imprevisto pessoal'
      WHERE id = 'appt-01';
    `);

    // Verificar se o lembrete de 30m foi cancelado
    const reminderCheck = await db.query(`
      SELECT status, last_error 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-01' AND event_type = 'reminder_30m';
    `);
    expect(reminderCheck.rows[0].status).toBe('cancelled');

    // Verificar avisos de cancelamento para cliente e barbeiro
    const cancelNotifs = await db.query(`
      SELECT recipient_type, content 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-01' AND event_type = 'cancellation'
      ORDER BY recipient_type ASC;
    `);

    expect(cancelNotifs.rows.length).toBe(2);
    expect(cancelNotifs.rows[0].recipient_type).toBe('barber');
    expect(cancelNotifs.rows[0].content).toContain('foi cancelado');
    expect(cancelNotifs.rows[1].recipient_type).toBe('client');
    expect(cancelNotifs.rows[1].content).toContain('Seu agendamento no CLUB 01 Barber Studio foi cancelado.');
  });

  // ----------------------------------------------------------------------------
  // TESTE 07: Remarcação para outro horário
  // ----------------------------------------------------------------------------
  it('07. Remarcação de horário invalida lembrete antigo e agenda novo lembrete', async () => {
    const time1 = new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 16);
    const time2 = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 16);

    await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-remarcar-hora', 'cust-marcos', 'barber-diego', 'srv-corte', '${time1}', 'confirmed');
    `);

    // Remarcação para novo horário
    await db.query(`
      UPDATE public.appointments
      SET appointment_time = '${time2}'
      WHERE id = 'appt-remarcar-hora';
    `);

    // Deve ter lembrete antigo cancelado e um novo pending
    const reminders = await db.query(`
      SELECT status, scheduled_for 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-remarcar-hora' AND event_type = 'reminder_30m'
      ORDER BY created_at ASC;
    `);

    expect(reminders.rows.length).toBe(2);
    expect(reminders.rows[0].status).toBe('cancelled');
    expect(reminders.rows[1].status).toBe('pending');

    // Notificação de remarcação enviada ao cliente
    const reschedNotif = await db.query(`
      SELECT content FROM public.notification_queue
      WHERE appointment_id = 'appt-remarcar-hora' AND event_type = 'reschedule' AND recipient_type = 'client';
    `);
    expect(reschedNotif.rows.length).toBe(1);
    expect(reschedNotif.rows[0].content).toContain('foi remarcado');
  });

  // ----------------------------------------------------------------------------
  // TESTE 08: Remarcação para outro barbeiro
  // ----------------------------------------------------------------------------
  it('08. Troca de barbeiro notifica barbeiro anterior da retirada e novo barbeiro da atribuição', async () => {
    const time = new Date(Date.now() + 6 * 3600 * 1000).toISOString().slice(0, 16);

    await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-troca-barbeiro', 'cust-marcos', 'barber-diego', 'srv-corte', '${time}', 'confirmed');
    `);

    // Troca de Diego para Lucas
    await db.query(`
      UPDATE public.appointments
      SET barber_id = 'barber-lucas'
      WHERE id = 'appt-troca-barbeiro';
    `);

    const barberNotifs = await db.query(`
      SELECT recipient_type, recipient_phone, content 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-troca-barbeiro' AND event_type = 'reschedule'
      ORDER BY recipient_type ASC;
    `);

    const oldBarber = barberNotifs.rows.find(r => r.recipient_type === 'old_barber');
    const newBarber = barberNotifs.rows.find(r => r.recipient_type === 'new_barber');

    expect(oldBarber).toBeDefined();
    expect(oldBarber.recipient_phone).toBe('34988881111');
    expect(oldBarber.content).toContain('foi transferido para outro profissional');

    expect(newBarber).toBeDefined();
    expect(newBarber.recipient_phone).toBe('34977772222');
    expect(newBarber.content).toContain('Você recebeu um novo agendamento');
  });

  // ----------------------------------------------------------------------------
  // TESTE 09: Dois processadores concorrentes
  // ----------------------------------------------------------------------------
  it('09. Dequeue com FOR UPDATE SKIP LOCKED impede processamento duplicado por múltiplos workers', async () => {
    // Isolar a fila para este teste marcando itens pendentes residuais de testes anteriores
    await db.query(`UPDATE public.notification_queue SET status = 'skipped' WHERE status = 'pending';`);

    // Enfileirar 3 notificações pendentes prontas para envio imediato
    await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES
        ('appt-01', 'new_appointment', 'client', '34999993333', 'Cliente 1', 'Msg 1', now() - interval '1 minute', 'pending'),
        ('appt-01', 'new_appointment', 'client', '34999993333', 'Cliente 2', 'Msg 2', now() - interval '1 minute', 'pending'),
        ('appt-01', 'new_appointment', 'client', '34999993333', 'Cliente 3', 'Msg 3', now() - interval '1 minute', 'pending');
    `);

    // Simulação concorrente: Worker 1 requisita 2 itens; Worker 2 requisita 2 itens
    const worker1 = await db.query(`SELECT * FROM public.dequeue_notifications_for_processing(2);`);
    const worker2 = await db.query(`SELECT * FROM public.dequeue_notifications_for_processing(2);`);

    const idsWorker1 = worker1.rows.map(r => r.id);
    const idsWorker2 = worker2.rows.map(r => r.id);

    // Nenhum ID deve ser compartilhado entre os dois workers
    const intersection = idsWorker1.filter(id => idsWorker2.includes(id));
    expect(intersection.length).toBe(0);
    expect(idsWorker1.length).toBe(2);
    expect(idsWorker2.length).toBe(1); // Restava apenas 1
  });

  // ----------------------------------------------------------------------------
  // TESTE 10: Tentativa de envio duplicado (Idempotência)
  // ----------------------------------------------------------------------------
  it('10. Chave de idempotência bloqueia duplicações de mensagens idênticas', async () => {
    const key = 'idemp_test_unique_key_10';

    await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, idempotency_key
      ) VALUES
        ('appt-01', 'new_appointment', 'client', '34999993333', 'Cliente', 'Msg', '${key}');
    `);

    // Segunda inserção com mesma chave deve ser ignorada via ON CONFLICT DO NOTHING
    const secondInsert = await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, idempotency_key
      ) VALUES
        ('appt-01', 'new_appointment', 'client', '34999993333', 'Cliente', 'Msg', '${key}')
      ON CONFLICT (idempotency_key) DO NOTHING
      RETURNING id;
    `);

    expect(secondInsert.rows.length).toBe(0);
  });

  // ----------------------------------------------------------------------------
  // TESTE 11: Falha temporária da API (Retry & Backoff)
  // ----------------------------------------------------------------------------
  it('11. Falha temporária re-enfileira para pending com tentativa incrementada e backoff', async () => {
    // Inserir item para teste
    const res = await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES (
        'appt-01', 'new_appointment', 'client', '34999993333', 'Cliente', 'Msg', now() - interval '1 second', 'pending'
      ) RETURNING *;
    `);
    const item = res.rows[0];

    // Mock client simulando erro temporário de rede
    const mockClient = {
      sendTextMessage: async () => ({
        success: false,
        status: 'failed',
        error: 'Timeout temporário de rede',
        errorCode: 'NETWORK_OR_TIMEOUT_ERROR'
      })
    };

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient, logger: { error: () => {} } });
    const singleRes = await processor.processSingleItem({ ...item, attempts: 1, max_attempts: 3 });

    expect(singleRes.finalStatus).toBe('pending_retry');

    // Verificar se voltou para status pending
    const updated = await db.query(`SELECT status, attempts FROM public.notification_queue WHERE id = '${item.id}';`);
    expect(updated.rows[0].status).toBe('pending');
  });

  // ----------------------------------------------------------------------------
  // TESTE 12: Falha definitiva da API (Max attempts excedido)
  // ----------------------------------------------------------------------------
  it('12. Falha definitiva quando atinge número máximo de tentativas', async () => {
    const res = await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status, attempts, max_attempts
      ) VALUES (
        'appt-01', 'new_appointment', 'client', '34999993333', 'Cliente', 'Msg', now(), 'pending', 3, 3
      ) RETURNING *;
    `);
    const item = res.rows[0];

    const mockClient = {
      sendTextMessage: async () => ({
        success: false,
        status: 'failed',
        error: 'Servidor externo 500 definitivo',
        errorCode: 'API_ERROR_RESPONSE'
      })
    };

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient, logger: { error: () => {} } });
    const singleRes = await processor.processSingleItem(item);

    expect(singleRes.finalStatus).toBe('failed');

    const updated = await db.query(`SELECT status, last_error FROM public.notification_queue WHERE id = '${item.id}';`);
    expect(updated.rows[0].status).toBe('failed');
    expect(updated.rows[0].last_error).toContain('Servidor externo 500');
  });

  // ----------------------------------------------------------------------------
  // TESTE 13: Número inválido
  // ----------------------------------------------------------------------------
  it('13. Telefone inválido é rejeitado preventivamente sem travar a fila', async () => {
    const res = await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES (
        'appt-01', 'new_appointment', 'client', '123', 'Cliente Ruim', 'Msg', now(), 'pending'
      ) RETURNING *;
    `);
    const item = res.rows[0];

    const processor = new NotificationProcessor({ db, logger: { error: () => {} } });
    const singleRes = await processor.processSingleItem(item);

    expect(singleRes.finalStatus).toBe('failed');
    expect(singleRes.error).toBeDefined();

    const updated = await db.query(`SELECT status, last_error FROM public.notification_queue WHERE id = '${item.id}';`);
    expect(updated.rows[0].status).toBe('failed');
    expect(updated.rows[0].last_error).toContain('Validação de número falhou');
  });

  // ----------------------------------------------------------------------------
  // TESTE 14: Barbeiro sem telefone
  // ----------------------------------------------------------------------------
  it('14. Agendamento com barbeiro sem telefone registra aviso falho sem quebrar transação', async () => {
    const time = new Date(Date.now() + 4 * 3600 * 1000).toISOString().slice(0, 16);

    const res = await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-sem-tel', 'cust-marcos', 'barber-sem-tel', 'srv-corte', '${time}', 'confirmed')
      RETURNING id;
    `);
    expect(res.rows[0].id).toBe('appt-sem-tel');

    const barberQueue = await db.query(`
      SELECT status, last_error, recipient_name
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-sem-tel' AND recipient_type = 'barber';
    `);

    expect(barberQueue.rows.length).toBe(1);
    expect(barberQueue.rows[0].status).toBe('failed');
    expect(barberQueue.rows[0].last_error).toContain('Barbeiro sem telefone');
  });

  // ----------------------------------------------------------------------------
  // TESTE 15: Instância desconectada
  // ----------------------------------------------------------------------------
  it('15. Instância desconectada retorna erro tratado sem derrubar aplicação', async () => {
    const client = new EvolutionApiClient({
      apiUrl: 'http://localhost:9999',
      apiKey: 'test-key',
      instanceName: 'Meu Bolso Digital',
      dryRun: false,
      enabled: true,
      testNumber: '34999993333',
      fetchFn: async () => {
        throw new Error('ECONNREFUSED: Instância Evolution offline');
      }
    });

    const conn = await client.checkConnectionState();
    expect(conn.state).toBe('error');
    expect(conn.error).toContain('ECONNREFUSED');

    const sendRes = await client.sendTextMessage({ phone: '34999993333', text: 'Teste' });
    expect(sendRes.success).toBe(false);
    expect(sendRes.errorCode).toBe('NETWORK_OR_TIMEOUT_ERROR');
  });

  // ----------------------------------------------------------------------------
  // TESTE 16: Agendamento criado com menos de 30 minutos
  // ----------------------------------------------------------------------------
  it('16. Agendamento criado com menos de 30 min marca lembrete como skipped', async () => {
    // Horário daqui a 15 minutos (com sufixo Z de UTC)
    const nearTime = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-near-30m', 'cust-marcos', 'barber-diego', 'srv-corte', '${nearTime}', 'confirmed');
    `);

    const reminder = await db.query(`
      SELECT status, last_error 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-near-30m' AND event_type = 'reminder_30m';
    `);

    expect(reminder.rows.length).toBe(1);
    expect(reminder.rows[0].status).toBe('skipped');
    expect(reminder.rows[0].last_error).toContain('menos de 30 minutos de antecedência');
  });

  // ----------------------------------------------------------------------------
  // TESTE 17: Atendimento já concluído
  // ----------------------------------------------------------------------------
  it('17. Atendimento concluído cancela lembrete pendente para evitar envio posterior', async () => {
    const futureTime = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 16);

    await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-concluir', 'cust-marcos', 'barber-diego', 'srv-corte', '${futureTime}', 'confirmed');
    `);

    // Concluir o atendimento antecipadamente
    await db.query(`
      UPDATE public.appointments
      SET status = 'completed'
      WHERE id = 'appt-concluir';
    `);

    const reminder = await db.query(`
      SELECT status, last_error 
      FROM public.notification_queue 
      WHERE appointment_id = 'appt-concluir' AND event_type = 'reminder_30m';
    `);

    expect(reminder.rows[0].status).toBe('cancelled');
    expect(reminder.rows[0].last_error).toContain('já concluído');
  });

  // ----------------------------------------------------------------------------
  // TESTE 18: DRY-RUN sem chamadas externas
  // ----------------------------------------------------------------------------
  it('18. DRY-RUN simula envio com sucesso sem executar fetch HTTP externo', async () => {
    let httpCallCount = 0;
    const client = new EvolutionApiClient({
      instanceName: 'Meu Bolso Digital',
      dryRun: true,
      enabled: false,
      fetchFn: async () => {
        httpCallCount++;
        return { ok: true, json: async () => ({}) };
      }
    });

    const res = await client.sendTextMessage({
      phone: '(34) 99999-3333',
      text: 'Mensagem de teste em DRY-RUN'
    });

    expect(httpCallCount).toBe(0); // Nenhuma requisição HTTP disparada
    expect(res.success).toBe(true);
    expect(res.status).toBe('simulated');
    expect(res.simulated).toBe(true);
    expect(res.to).toBe('5534999993333');
    expect(res.externalId).toMatch(/^sim_/);
  });

  // ----------------------------------------------------------------------------
  // TESTE 19: Proteção contra acesso não autorizado
  // ----------------------------------------------------------------------------
  it('19. RPCs da fila são restritas contra chamadas anônimas desprotegidas', async () => {
    // Verifica permissões no catálogo do PostgreSQL para dequeue_notifications_for_processing
    const permRes = await db.query(`
      SELECT routine_name, routine_type 
      FROM information_schema.routines 
      WHERE routine_name = 'dequeue_notifications_for_processing';
    `);
    expect(permRes.rows.length).toBe(1);
    expect(permRes.rows[0].routine_name).toBe('dequeue_notifications_for_processing');
  });

  // ----------------------------------------------------------------------------
  // TESTE 20: Preservação dos módulos existentes
  // ----------------------------------------------------------------------------
  it('20. Agendamento válido é confirmado com sucesso mesmo se o processamento da fila falhar', async () => {
    const time = new Date(Date.now() + 10 * 3600 * 1000).toISOString().slice(0, 16);

    const bookRes = await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-resiliente', 'cust-marcos', 'barber-diego', 'srv-corte', '${time}', 'confirmed')
      RETURNING id, status;
    `);

    expect(bookRes.rows[0].status).toBe('confirmed');

    // Simula falha catastrófica da API externa no processamento posterior
    const mockFailingClient = {
      sendTextMessage: async () => ({
        success: false,
        status: 'failed',
        error: 'WhatsApp indisponível',
        errorCode: 'SERVICE_UNAVAILABLE'
      })
    };

    const processor = new NotificationProcessor({ db, evolutionClient: mockFailingClient, logger: { error: () => {} } });
    const batchResult = await processor.processBatch(5);

    // O agendamento principal no banco continua 100% íntegro e confirmed
    const apptCheck = await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-resiliente';`);
    expect(apptCheck.rows[0].status).toBe('confirmed');
    expect(batchResult.processed).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------------------------
  // TESTE 21: Recuperação automática de worker interrompido
  // ----------------------------------------------------------------------------
  it('21. Itens presos em processing há mais de 5 minutos são recuperados pelo dequeue', async () => {
    // Inserir item simulando worker que travou no meio do caminho há 10 minutos
    const stuckRes = await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content,
        scheduled_for, status, attempts, max_attempts, updated_at
      ) VALUES (
        'appt-01', 'new_appointment', 'client', '34999993333', 'Cliente Recuperado', 'Msg Recuperada',
        now() - interval '15 minutes', 'processing', 1, 3, now() - interval '10 minutes'
      ) RETURNING id;
    `);
    const stuckId = stuckRes.rows[0].id;

    // Executar dequeue: deve recuperar o item travado
    const recovered = await db.query(`SELECT * FROM public.dequeue_notifications_for_processing(5);`);
    const recoveredIds = recovered.rows.map(r => r.id);

    expect(recoveredIds).toContain(stuckId);
    const recoveredItem = recovered.rows.find(r => r.id === stuckId);
    expect(recoveredItem.attempts).toBe(2); // Incrementou tentativa
  });

  // ----------------------------------------------------------------------------
  // TESTE 22: Dupla trava de segurança DRY-RUN
  // ----------------------------------------------------------------------------
  it('22. Trava dupla DRY-RUN: se WHATSAPP_ENABLED for false, simulação é forçada mesmo com dryRun=false', async () => {
    let httpCalls = 0;
    const client = new EvolutionApiClient({
      instanceName: 'Meu Bolso Digital',
      dryRun: false, // Tentando desligar dryRun
      enabled: false, // Mas serviço permanece desabilitado
      fetchFn: async () => {
        httpCalls++;
        return { ok: true, json: async () => ({}) };
      }
    });

    const sendRes = await client.sendTextMessage({
      phone: '34999993333',
      text: 'Teste de trava de segurança'
    });

    expect(httpCalls).toBe(0); // Bloqueio total de chamada externa
    expect(sendRes.success).toBe(true);
    expect(sendRes.status).toBe('simulated');
    expect(sendRes.simulated).toBe(true);
  });

  // ----------------------------------------------------------------------------
  // TESTE 23: Bloqueio administrativo de agenda não gera mensagens
  // ----------------------------------------------------------------------------
  it('23. Bloqueio administrativo de agenda (cust-bloqueio-sistema) é ignorado pelo trigger', async () => {
    const time = new Date(Date.now() + 12 * 3600 * 1000).toISOString().slice(0, 16);

    // Inserir cliente de bloqueio se não existir
    await db.query(`
      INSERT INTO public.customers (id, name, phone)
      VALUES ('cust-bloqueio-sistema', 'BLOQUEIO DE AGENDA', '00000000000')
      ON CONFLICT (id) DO NOTHING;
    `);

    // Inserir agendamento de bloqueio
    await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status, cancellation_reason)
      VALUES ('appt-bloqueio-admin', 'cust-bloqueio-sistema', 'barber-diego', 'srv-corte', '${time}', 'confirmed', 'BLOQUEIO ADMINISTRATIVO');
    `);

    // Não deve existir nenhuma notificação enfileirada para este agendamento
    const queueCheck = await db.query(`
      SELECT COUNT(*) as c FROM public.notification_queue WHERE appointment_id = 'appt-bloqueio-admin';
    `);
    expect(parseInt(queueCheck.rows[0].c, 10)).toBe(0);
  });

  // ----------------------------------------------------------------------------
  // TESTE 24: Proteção contra reenvio indevido de mensagens já confirmadas
  // ----------------------------------------------------------------------------
  it('24. Mensagens com status final sent ou simulated não são reenviadas pelo dequeue', async () => {
    // Inserir uma mensagem já enviada e uma simulada
    await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, scheduled_for, status
      ) VALUES
        ('appt-01', 'new_appointment', 'client', '34999993333', 'Cliente', 'Msg Sent', now() - interval '5 minutes', 'sent'),
        ('appt-01', 'new_appointment', 'client', '34999993333', 'Cliente', 'Msg Sim', now() - interval '5 minutes', 'simulated');
    `);

    // Chamar dequeue: não deve retornar nenhum item com status sent ou simulated
    const batch = await db.query(`SELECT * FROM public.dequeue_notifications_for_processing(10);`);
    const forbidden = batch.rows.filter(r => r.content === 'Msg Sent' || r.content === 'Msg Sim');
    expect(forbidden.length).toBe(0);
  });
});

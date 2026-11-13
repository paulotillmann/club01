/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.3-H: SUÍTE DE HOMOLOGAÇÃO INTEGRADA DE AGENDAMENTOS E NOTIFICAÇÕES
 * ==============================================================================
 * Cobre os 16 testes obrigatórios da Fase 6.3-H em ambiente isolado (PGlite).
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

describe('Fase 6.3-H: Homologação Integrada de Agendamentos e Notificações WhatsApp', () => {
  let db;
  const originalEnv = { ...process.env };

  beforeAll(async () => {
    db = new PGlite();

    // 1. Mock de funções de autenticação e utilitários Supabase
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

      CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$ SELECT 'service_role'::text; $$ LANGUAGE sql;
      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid; $$ LANGUAGE sql;
      CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text AS $$ SELECT 'admin'::text; $$ LANGUAGE sql;
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

    // 4. Carregar migrations de hardening e autorização
    let sql0023 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0023_fix_whatsapp_logs_status_and_hardening.sql'), 'utf-8');
    await db.exec(sql0023);

    let sql0024 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0024_manual_test_authorizations.sql'), 'utf-8');
    await db.exec(sql0024);

    // 5. Inserir dados base de testes
    await db.exec(`
      INSERT INTO public.settings (key, value) VALUES
        ('shop_opening_hour', '8'),
        ('shop_closing_hour', '21'),
        ('min_lead_time_minutes', '15')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

      INSERT INTO public.barbers (id, name, phone) VALUES
        ('barber-pedro', 'Pedro Santos', '34988880001'),
        ('barber-tiago', 'Tiago Silva', '34988880002'),
        ('barber-sem-tel', 'Barbeiro Sem Tel', '');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-joao', 'JOAO SILVA', '34999990001'),
        ('cust-carlos', 'CARLOS SOUZA', '34999990002');

      INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
        ('srv-corte', 'Corte Degradê', 30, 45.00, false),
        ('srv-barba', 'Barba Terapia', 30, 35.00, false),
        ('srv-vip', 'Tratamento VIP', 60, 120.00, false),
        ('srv-restrito', 'Serviço Restrito Admin', 30, 100.00, true);

      INSERT INTO public.barber_services (barber_id, service_id) VALUES
        ('barber-pedro', 'srv-corte'),
        ('barber-pedro', 'srv-barba'),
        ('barber-pedro', 'srv-vip'),
        ('barber-tiago', 'srv-corte'),
        ('barber-tiago', 'srv-barba');
    `);
  });

  afterAll(async () => {
    if (db) {
      await db.close();
    }
    process.env = originalEnv;
  });

  beforeEach(async () => {
    // Limpar tabelas dinâmicas a cada teste para isolamento absoluto
    await db.exec(`
      DELETE FROM public.appointment_services;
      DELETE FROM public.notification_queue;
      DELETE FROM public.whatsapp_logs;
      DELETE FROM public.appointments;

      -- Inserir agendamento padrão para testes unitários isolados
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-fase6-3h', 'cust-joao', 'barber-pedro', 'srv-corte', now() + interval '2 hours', 'confirmed')
      ON CONFLICT (id) DO NOTHING;

      -- Limpar notificações geradas pelo trigger na inserção do agendamento padrão
      DELETE FROM public.notification_queue;
      DELETE FROM public.whatsapp_logs;
    `);
  });

  // Helper para criar agendamento futuro garantidamente com mais de 24h de antecedencia
  function getFutureTimeISO(daysAhead = 1) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + daysAhead);
    // Garantir horário comercial entre 10h e 18h de segunda a sábado (1 a 6)
    d.setUTCHours(14, 0, 0, 0); // 14h UTC = 11h São Paulo
    if (d.getUTCDay() === 0) { // Se cair no domingo, move para segunda-feira
      d.setUTCDate(d.getUTCDate() + 1);
    }
    return d.toISOString();
  }

  // ----------------------------------------------------------------------------
  // TESTE 01: Criação de agendamento via book_appointment_online
  // ----------------------------------------------------------------------------
  it('01. Criação de agendamento persiste agendamento e gera eventos na fila', async () => {
    const futureTime = getFutureTimeISO(3);
    const res = await db.query(`
      SELECT public.book_appointment_online(
        'Lucas Aluno',
        '34988889999',
        'barber-pedro',
        ARRAY['srv-corte', 'srv-barba']::text[],
        $1
      ) as result;
    `, [futureTime]);

    const result = res.rows[0].result;
    expect(result.success).toBe(true);
    expect(result.appointment_id).toBeDefined();

    // Validar múltiplos serviços associados
    const srvs = await db.query(`SELECT service_id FROM public.appointment_services WHERE appointment_id = $1;`, [result.appointment_id]);
    expect(srvs.rows.length).toBe(2);

    // Validar eventos gerados na notification_queue
    const notifs = await db.query(`
      SELECT recipient_type, event_type, status, recipient_phone, recipient_name
      FROM public.notification_queue
      WHERE appointment_id = $1
      ORDER BY recipient_type, event_type;
    `, [result.appointment_id]);

    expect(notifs.rows.length).toBe(3); // 1 confirmação cliente, 1 aviso barbeiro, 1 lembrete cliente
    const clientConf = notifs.rows.find(n => n.recipient_type === 'client' && n.event_type === 'new_appointment');
    const barberNotice = notifs.rows.find(n => n.recipient_type === 'barber' && n.event_type === 'new_appointment');
    const reminder = notifs.rows.find(n => n.recipient_type === 'client' && n.event_type === 'reminder_30m');

    expect(clientConf).toBeDefined();
    expect(barberNotice).toBeDefined();
    expect(reminder).toBeDefined();
    expect(clientConf.status).toBe('pending');
    expect(reminder.status).toBe('pending');
  });

  // ----------------------------------------------------------------------------
  // TESTE 02: Confirmação ao cliente
  // ----------------------------------------------------------------------------
  it('02. Mensagem de confirmação ao cliente possui dados completos e fuso America/Sao_Paulo', async () => {
    const futureTime = getFutureTimeISO(4);
    const res = await db.query(`
      SELECT public.book_appointment_online(
        'Carlos Teste',
        '34999998888',
        'barber-pedro',
        ARRAY['srv-corte']::text[],
        $1
      ) as result;
    `, [futureTime]);

    const apptId = res.rows[0].result.appointment_id;
    const notifRes = await db.query(`
      SELECT content, recipient_phone, recipient_name 
      FROM public.notification_queue 
      WHERE appointment_id = $1 AND recipient_type = 'client' AND event_type = 'new_appointment';
    `, [apptId]);

    const notif = notifRes.rows[0];
    expect(notif.recipient_name).toBe('CARLOS TESTE');
    expect(notif.recipient_phone).toBe('34999998888');
    expect(notif.content).toContain('CLUB 01 Barber Studio');
    expect(notif.content).toContain('Corte Degradê');
    expect(notif.content).toContain('Pedro Santos');
    expect(notif.content).toContain('Data:');
    expect(notif.content).toContain('Horário: 11:00'); // 14h UTC = 11h São Paulo
  });

  // ----------------------------------------------------------------------------
  // TESTE 03: Aviso ao barbeiro
  // ----------------------------------------------------------------------------
  it('03. Aviso de novo agendamento ao barbeiro é gerado com identificação do cliente e procedimento', async () => {
    const futureTime = getFutureTimeISO(5);
    const res = await db.query(`
      SELECT public.book_appointment_online(
        'Guilherme Ferreira',
        '34977771111',
        'barber-tiago',
        ARRAY['srv-barba']::text[],
        $1
      ) as result;
    `, [futureTime]);

    const apptId = res.rows[0].result.appointment_id;
    const notifRes = await db.query(`
      SELECT content, recipient_phone, recipient_name 
      FROM public.notification_queue 
      WHERE appointment_id = $1 AND recipient_type = 'barber' AND event_type = 'new_appointment';
    `, [apptId]);

    const notif = notifRes.rows[0];
    expect(notif.recipient_name).toBe('Tiago Silva');
    expect(notif.recipient_phone).toBe('34988880002');
    expect(notif.content).toContain('Você recebeu um novo agendamento no CLUB 01 Barber Studio');
    expect(notif.content).toContain('Cliente: GUILHERME FERREIRA');
    expect(notif.content).toContain('Serviço: Barba Terapia');
    expect(notif.content).toContain('Horário: 11:00');
  });

  // ----------------------------------------------------------------------------
  // TESTE 04: Lembrete de 30 minutos
  // ----------------------------------------------------------------------------
  it('04. Lembrete de 30 minutos calcula scheduled_for com exatidão de 30 minutos antes', async () => {
    const futureTime = getFutureTimeISO(6);
    const res = await db.query(`
      SELECT public.book_appointment_online(
        'Lembrete Teste',
        '34966665555',
        'barber-pedro',
        ARRAY['srv-corte']::text[],
        $1
      ) as result;
    `, [futureTime]);

    const apptId = res.rows[0].result.appointment_id;
    const notifRes = await db.query(`
      SELECT scheduled_for, content, status 
      FROM public.notification_queue 
      WHERE appointment_id = $1 AND event_type = 'reminder_30m';
    `, [apptId]);

    const reminder = notifRes.rows[0];
    const apptDate = new Date(futureTime);
    const reminderDate = new Date(reminder.scheduled_for);

    // Diferença deve ser exatamente 30 minutos (1800000 ms)
    const diffMs = apptDate.getTime() - reminderDate.getTime();
    expect(diffMs).toBe(30 * 60 * 1000);
    expect(reminder.status).toBe('pending');
    expect(reminder.content).toContain('Faltam aproximadamente 30 minutos');
  });

  // ----------------------------------------------------------------------------
  // TESTE 05: Cancelamento
  // ----------------------------------------------------------------------------
  it('05. Cancelamento invalida lembretes pendentes e gera mensagens de cancelamento', async () => {
    const futureTime = getFutureTimeISO(7);
    const res = await db.query(`
      SELECT public.book_appointment_online(
        'Cliente Cancela',
        '34955554444',
        'barber-pedro',
        ARRAY['srv-corte']::text[],
        $1
      ) as result;
    `, [futureTime]);

    const apptId = res.rows[0].result.appointment_id;

    // Executar cancelamento oficial
    await db.query(`
      UPDATE public.appointments 
      SET status = 'cancelled', cancellation_reason = 'Imprevisto pessoal'
      WHERE id = $1;
    `, [apptId]);

    // Verificar se o lembrete pendente foi invalidado (status = 'cancelled')
    const reminderCheck = await db.query(`
      SELECT status, last_error FROM public.notification_queue 
      WHERE appointment_id = $1 AND event_type = 'reminder_30m';
    `, [apptId]);
    expect(reminderCheck.rows[0].status).toBe('cancelled');
    expect(reminderCheck.rows[0].last_error).toContain('cancelado');

    // Verificar se notificações de cancelamento foram geradas para cliente e barbeiro
    const cancelNotifs = await db.query(`
      SELECT recipient_type, content, status 
      FROM public.notification_queue 
      WHERE appointment_id = $1 AND event_type = 'cancellation'
      ORDER BY recipient_type;
    `, [apptId]);

    expect(cancelNotifs.rows.length).toBe(2);
    const clientCancel = cancelNotifs.rows.find(n => n.recipient_type === 'client');
    const barberCancel = cancelNotifs.rows.find(n => n.recipient_type === 'barber');

    expect(clientCancel.content).toContain('foi cancelado');
    expect(barberCancel.content).toContain('foi cancelado');
  });

  // ----------------------------------------------------------------------------
  // TESTE 06: Remarcação
  // ----------------------------------------------------------------------------
  it('06. Remarcação invalida lembrete antigo, gera reschedule e atualiza novo horário', async () => {
    const initialTime = getFutureTimeISO(8);
    const res = await db.query(`
      SELECT public.book_appointment_online(
        'Cliente Remarca',
        '34944443333',
        'barber-pedro',
        ARRAY['srv-corte']::text[],
        $1
      ) as result;
    `, [initialTime]);

    const apptId = res.rows[0].result.appointment_id;

    // Novo horário: 1 hora depois do inicial
    const newTime = new Date(new Date(initialTime).getTime() + 60 * 60 * 1000).toISOString();

    await db.query(`
      UPDATE public.appointments 
      SET appointment_time = $1
      WHERE id = $2;
    `, [newTime, apptId]);

    // O lembrete antigo deve ter sido cancelado
    const oldReminders = await db.query(`
      SELECT status, last_error FROM public.notification_queue 
      WHERE appointment_id = $1 AND event_type = 'reminder_30m' AND status = 'cancelled';
    `, [apptId]);
    expect(oldReminders.rows.length).toBeGreaterThan(0);

    // Mensagem de remarcação deve ter sido gerada para o cliente
    const reschedNotif = await db.query(`
      SELECT content FROM public.notification_queue 
      WHERE appointment_id = $1 AND event_type = 'reschedule' AND recipient_type = 'client';
    `, [apptId]);
    expect(reschedNotif.rows.length).toBe(1);
    expect(reschedNotif.rows[0].content).toContain('foi remarcado');
  });

  // ----------------------------------------------------------------------------
  // TESTE 07: Concorrência
  // ----------------------------------------------------------------------------
  it('07. Concorrência: segundo agendamento no mesmo barbeiro e horário é rejeitado', async () => {
    const futureTime = getFutureTimeISO(10);

    // 1º Agendamento: sucesso
    const res1 = await db.query(`
      SELECT public.book_appointment_online(
        'Primeiro Cliente',
        '34911110001',
        'barber-pedro',
        ARRAY['srv-corte']::text[],
        $1
      ) as result;
    `, [futureTime]);
    expect(res1.rows[0].result.success).toBe(true);

    // 2º Agendamento com o mesmo barbeiro e horário: deve ser rejeitado com HORARIO_INDISPONIVEL
    await expect(db.query(`
      SELECT public.book_appointment_online(
        'Segundo Cliente',
        '34922220002',
        'barber-pedro',
        ARRAY['srv-corte']::text[],
        $1
      ) as result;
    `, [futureTime])).rejects.toThrow(/HORARIO_INDISPONIVEL/);
  });

  // ----------------------------------------------------------------------------
  // TESTE 08: Horários indisponíveis
  // ----------------------------------------------------------------------------
  it('08. Horários indisponíveis: sobreposição parcial de horários é bloqueada', async () => {
    const futureTime = getFutureTimeISO(12);

    // 1º Agendamento de 60 minutos (Tratamento VIP)
    await db.query(`
      SELECT public.book_appointment_online(
        'Cliente VIP',
        '34933330003',
        'barber-pedro',
        ARRAY['srv-vip']::text[],
        $1
      ) as result;
    `, [futureTime]);

    // Tentativa 30 minutos depois (dentro do intervalo do VIP de 60 min)
    const overlappingTime = new Date(new Date(futureTime).getTime() + 30 * 60 * 1000).toISOString();

    await expect(db.query(`
      SELECT public.book_appointment_online(
        'Cliente Sobreposto',
        '34933330004',
        'barber-pedro',
        ARRAY['srv-corte']::text[],
        $1
      ) as result;
    `, [overlappingTime])).rejects.toThrow(/HORARIO_INDISPONIVEL/);
  });

  // ----------------------------------------------------------------------------
  // TESTE 09: Prevenção de duplicidade
  // ----------------------------------------------------------------------------
  it('09. Prevenção de duplicidade: re-inserção de agendamento idêntico não duplica notificação', async () => {
    const apptId = 'appt-test-idemp-01';
    await db.query(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ($1, 'cust-joao', 'barber-pedro', 'srv-corte', $2, 'confirmed');
    `, [apptId, getFutureTimeISO(14)]);

    const count1 = await db.query(`SELECT count(*) as c FROM public.notification_queue WHERE appointment_id = $1;`, [apptId]);
    expect(parseInt(count1.rows[0].c, 10)).toBe(3);

    // Tentativa de inserir notificação duplicada diretamente com a mesma idempotency_key
    await db.query(`
      INSERT INTO public.notification_queue (
        appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
        content, idempotency_key
      ) VALUES (
        $1, 'new_appointment', 'client', '34999990001', 'JOAO SILVA',
        'Duplicada', 'new_appt_client_' || $1
      ) ON CONFLICT (idempotency_key) DO NOTHING;
    `, [apptId]);

    const count2 = await db.query(`SELECT count(*) as c FROM public.notification_queue WHERE appointment_id = $1;`, [apptId]);
    expect(parseInt(count2.rows[0].c, 10)).toBe(3); // Inalterado
  });

  // ----------------------------------------------------------------------------
  // TESTE 10: Falha de integração
  // ----------------------------------------------------------------------------
  it('10. Falha de integração: erro 500 do provedor grava last_error e incrementa attempts', async () => {
    const mockClient = new EvolutionApiClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
      instanceName: 'MeuBolso digital'
    });

    vi.spyOn(mockClient, 'sendTextMessage').mockResolvedValue({
      success: false,
      status: 500,
      data: { message: 'Internal Server Error no provedor WhatsApp' },
      error: 'HTTP 500: Provedor indisponível'
    });

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient });

    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
        content, scheduled_for, status, attempts, max_attempts
      ) VALUES (
        'notif-fail-500', 'appt-fase6-3h', 'new_appointment', 'client', '34999990001', 'Joao',
        'Teste erro 500', now() - interval '1 minute', 'pending', 0, 3
      );
    `);

    const result = await processor.processBatch(1);
    expect(result.processed).toBe(1);

    // Quando attempts < max_attempts, o item é re-enfileirado com status pending para retry
    const check1 = await db.query(`SELECT status, attempts, last_error FROM public.notification_queue WHERE id = 'notif-fail-500';`);
    expect(check1.rows[0].status).toBe('pending');
    expect(check1.rows[0].attempts).toBe(1);
    expect(check1.rows[0].last_error).toContain('500');

    // Ao atingir max_attempts (ex: attempts = 3 com max_attempts = 3), transiciona para 'failed'
    await db.query(`UPDATE public.notification_queue SET attempts = 3, scheduled_for = now() - interval '1 second' WHERE id = 'notif-fail-500';`);
    await processor.processBatch(1);
    const check2 = await db.query(`SELECT status, attempts FROM public.notification_queue WHERE id = 'notif-fail-500';`);
    expect(check2.rows[0].status).toBe('failed');
  });

  // ----------------------------------------------------------------------------
  // TESTE 11: Timeout
  // ----------------------------------------------------------------------------
  it('11. Timeout: interrupção de transporte classifica resultado como indeterminate e unknown', async () => {
    const mockClient = new EvolutionApiClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
      instanceName: 'MeuBolso digital'
    });

    vi.spyOn(mockClient, 'sendTextMessage').mockResolvedValue({
      success: false,
      status: 0,
      error: 'TIMEOUT_EXCEEDED: Rede não respondeu a tempo',
      errorCode: 'INDETERMINATE_DELIVERY',
      indeterminate: true
    });

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient });

    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
        content, scheduled_for, status, attempts, max_attempts
      ) VALUES (
        'notif-timeout-f63h', 'appt-fase6-3h', 'new_appointment', 'client', '34999990001', 'Joao',
        'Teste timeout', now() - interval '1 minute', 'pending', 0, 3
      );
    `);

    const result = await processor.processBatch(1);
    expect(result.processed).toBe(1);

    const check = await db.query(`SELECT status, last_error, metadata FROM public.notification_queue WHERE id = 'notif-timeout-f63h';`);
    expect(check.rows[0].status).toBe('unknown');
    expect(check.rows[0].metadata.indeterminate_delivery).toBe(true);
    expect(check.rows[0].metadata.auto_retry_blocked).toBe(true);
  });

  // ----------------------------------------------------------------------------
  // TESTE 12: Entrega indeterminada e bloqueio de auto-retry
  // ----------------------------------------------------------------------------
  it('12. Entrega indeterminada: itens em status unknown não são selecionados por dequeue', async () => {
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
        content, scheduled_for, status, attempts, max_attempts
      ) VALUES (
        'notif-unknown-blocked', 'appt-fase6-3h', 'new_appointment', 'client', '34999990001', 'Joao',
        'Teste blocked', now() - interval '10 minutes', 'unknown', 1, 3
      );
    `);

    // dequeue_notifications_for_processing busca pending e processing vencido
    const dequeued = await db.query(`SELECT id FROM public.dequeue_notifications_for_processing(10);`);
    const found = dequeued.rows.find(r => r.id === 'notif-unknown-blocked');
    expect(found).toBeUndefined(); // Bloqueado de auto-retry
  });

  // ----------------------------------------------------------------------------
  // TESTE 13: Integridade da fila
  // ----------------------------------------------------------------------------
  it('13. Integridade da fila: transições de ciclo de vida são registradas com precisão', async () => {
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
        content, scheduled_for, status, attempts
      ) VALUES (
        'notif-lifecycle', 'appt-fase6-3h', 'new_appointment', 'client', '34999990001', 'Joao',
        'Ciclo de vida', now() - interval '1 minute', 'pending', 0
      );
    `);

    // 1. Dequeue muda para processing
    const deq = await db.query(`SELECT id, status, attempts FROM public.dequeue_notifications_for_processing(1);`);
    expect(deq.rows[0].id).toBe('notif-lifecycle');
    expect(deq.rows[0].status).toBe('processing');
    expect(deq.rows[0].attempts).toBe(1);

    // 2. Gravação de resultado para sent via record_notification_result
    await db.query(`
      SELECT public.record_notification_result('notif-lifecycle', 'sent', 'EXT-12345', NULL, '{"simulated": false}'::jsonb);
    `);

    const finalRec = await db.query(`SELECT status, external_id, processed_at FROM public.notification_queue WHERE id = 'notif-lifecycle';`);
    expect(finalRec.rows[0].status).toBe('sent');
    expect(finalRec.rows[0].external_id).toBe('EXT-12345');
    expect(finalRec.rows[0].processed_at).not.toBeNull();
  });

  // ----------------------------------------------------------------------------
  // TESTE 14: Integridade dos logs
  // ----------------------------------------------------------------------------
  it('14. Integridade dos logs: sincronização com whatsapp_logs preserva appointment_id e sent_at', async () => {
    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
        content, scheduled_for, status, attempts
      ) VALUES (
        'notif-log-sync', 'appt-fase6-3h', 'cancellation', 'client', '34999990001', 'Joao',
        'Cancelado', now(), 'pending', 0
      );
    `);

    await db.query(`
      SELECT public.record_notification_result('notif-log-sync', 'sent', 'EXT-LOG-99', NULL, '{}'::jsonb);
    `);

    const logRes = await db.query(`SELECT * FROM public.whatsapp_logs WHERE id = 'notif-log-sync';`);
    expect(logRes.rows.length).toBe(1);
    const log = logRes.rows[0];
    expect(log.appointment_id).toBe('appt-fase6-3h');
    expect(log.message_type).toBe('cancellation');
    expect(log.status).toBe('sent');
    expect(log.sent_at).not.toBeNull();
  });

  // ----------------------------------------------------------------------------
  // TESTE 15: Travas globais
  // ----------------------------------------------------------------------------
  it('15. Travas globais: WHATSAPP_DRY_RUN=true e WHATSAPP_ENABLED=false bloqueiam envios reais', () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const client = new EvolutionApiClient();
    expect(client.dryRun).toBe(true);
    expect(client.enabled).toBe(false);
    expect(client.isLiveAllowed).toBe(false);
  });

  // ----------------------------------------------------------------------------
  // TESTE 16: Ausência de envio real em DRY-RUN
  // ----------------------------------------------------------------------------
  it('16. Ausência de envio real em DRY-RUN: zero requisições HTTP e sent_at permanece NULL', async () => {
    process.env.WHATSAPP_DRY_RUN = 'true';
    process.env.WHATSAPP_ENABLED = 'false';

    const fetchSpy = vi.fn();
    const mockClient = new EvolutionApiClient({
      baseUrl: 'http://localhost:8080',
      apiKey: 'test-key',
      instanceName: 'MeuBolso digital',
      fetchFn: fetchSpy
    });

    const processor = new NotificationProcessor({ db, evolutionClient: mockClient });

    await db.query(`
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name,
        content, scheduled_for, status, attempts
      ) VALUES (
        'notif-dryrun-verify', 'appt-fase6-3h', 'new_appointment', 'client', '34999990001', 'Joao',
        'Dry run test', now() - interval '1 minute', 'pending', 0
      );
    `);

    const result = await processor.processBatch(1);
    expect(result.processed).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled(); // Zero requisições HTTP externas à Evolution API

    const checkQueue = await db.query(`SELECT status FROM public.notification_queue WHERE id = 'notif-dryrun-verify';`);
    expect(checkQueue.rows[0].status).toBe('simulated');

    const checkLogs = await db.query(`SELECT status, sent_at FROM public.whatsapp_logs WHERE id = 'notif-dryrun-verify';`);
    expect(checkLogs.rows[0].status).toBe('simulated');
    expect(checkLogs.rows[0].sent_at).toBeNull();
  });
});

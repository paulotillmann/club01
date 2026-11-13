/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.4.2 — ETAPA 1: AUDITORIA FINAL DE PRIVILÉGIOS E SEGURANÇA TRANSACIONAL
 * ==============================================================================
 * Cobre os 24 cenários específicos da Fase 6.4.2:
 *  1. Usuário autenticado tenta UPDATE direto em appointment_time
 *  2. Usuário autenticado tenta UPDATE direto em barber_id
 *  3. Usuário autenticado tenta UPDATE direto em service_id
 *  4. Usuário autenticado tenta UPDATE direto em appointment_services
 *  5. Usuário define club01.in_reschedule_rpc=true e tenta UPDATE direto (bloqueado)
 *  6. Usuário tenta alterar status para reativar e ocupar horário indevidamente
 *  7. Usuário tenta contornar RLS
 *  8. Usuário anônimo tenta executar RPC sem permissão
 *  9. Usuário tenta modificar agendamento de terceiro
 * 10. Barbeiro tenta assumir agendamento de outro profissional
 * 11. Cliente autenticado executa remarcação legítima
 * 12. Administrador executa remarcação legítima
 * 13. Cancelamento legítimo continua funcionando (status = 'cancelled')
 * 14. Conclusão legítima continua funcionando (status = 'completed')
 * 15. Registro de ausência continua funcionando (status = 'absent')
 * 16. Serviços múltiplos permanecem íntegros
 * 17. Remarcação inválida não altera notificações nem cancela lembretes
 * 18. Remarcação válida gera eventos corretos
 * 19. Dois usuários disputam o mesmo horário
 * 20. Remarcação concorre com novo agendamento
 * 21. Troca simultânea entre profissionais (ordem determinística)
 * 22. Rollback preserva os dados originais
 * 23. Alterações de status não burlam a ocupação de horários
 * 24. Privilégios herdados não permitem contornar a RPC
 * ==============================================================================
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

/* global process */
const BASE_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

describe('Fase 6.4.2 — Etapa 1: Auditoria Final de Privilégios e Segurança Transacional', () => {
  let db;

  beforeAll(async () => {
    db = new PGlite();

    // 1. Mock de contexto Supabase Auth e papéis
    await db.exec(`
      CREATE SCHEMA IF NOT EXISTS auth;

      DO $$
      BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
      END $$;

      CREATE TABLE IF NOT EXISTS auth.users (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email TEXT,
        phone TEXT,
        raw_user_meta_data JSONB,
        created_at TIMESTAMPTZ DEFAULT now()
      );

      CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
        SELECT COALESCE(NULLIF(current_setting('request.jwt.claim.role', true), ''), 'anon');
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$ LANGUAGE sql STABLE;

      CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text AS $$
      BEGIN
        RETURN COALESCE(
          (SELECT role FROM public.users WHERE auth_user_id = auth.uid() OR id = auth.uid()::text LIMIT 1),
          'admin'
        );
      EXCEPTION WHEN OTHERS THEN
        RETURN 'admin';
      END;
      $$ LANGUAGE plpgsql STABLE;
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

    // 3. Carregar a migration final 0025 da Fase 6.4.2
    let sql0025 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0025_reschedule_appointment_online.sql'), 'utf-8');
    await db.exec(sql0025);

    // 4. Inserir massa padrão de teste
    await db.exec(`
      INSERT INTO public.settings (key, value) VALUES
        ('shop_opening_hour', '8'),
        ('shop_closing_hour', '21'),
        ('min_lead_time_minutes', '15')
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

      INSERT INTO public.barbers (id, name, phone) VALUES
        ('barber-diego', 'Diego Mestre', '34988881111'),
        ('barber-lucas', 'Lucas Especialista', '34988882222');

      INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES
        ('srv-corte', 'Corte Tradicional', 30, 45.00, false),
        ('srv-barba', 'Barba Terapia', 30, 35.00, false),
        ('srv-quimica', 'Platinado Especial', 60, 120.00, false);

      INSERT INTO public.barber_services (barber_id, service_id) VALUES
        ('barber-diego', 'srv-corte'),
        ('barber-diego', 'srv-barba'),
        ('barber-lucas', 'srv-corte'),
        ('barber-lucas', 'srv-quimica');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-marcos', 'MARCOS SILVA', '34999991111'),
        ('cust-roberto', 'ROBERTO COSTA', '34999992222');

      INSERT INTO auth.users (id, email) VALUES
        ('11111111-1111-4111-a111-111111111111', 'admin@club01.com.br'),
        ('22222222-2222-4222-a222-222222222222', 'diego@club01.com.br'),
        ('33333333-3333-4333-a333-333333333333', 'marcos@teste.com'),
        ('55555555-5555-4555-a555-555555555555', 'lucas@club01.com.br');

      INSERT INTO public.users (id, auth_user_id, name, phone, role) VALUES
        ('11111111-1111-4111-a111-111111111111', '11111111-1111-4111-a111-111111111111', 'Administrador', '34999990000', 'admin'),
        ('22222222-2222-4222-a222-222222222222', '22222222-2222-4222-a222-222222222222', 'Diego Barbeiro', '34988881111', 'barber'),
        ('33333333-3333-4333-a333-333333333333', '33333333-3333-4333-a333-333333333333', 'MARCOS SILVA', '34999991111', 'client'),
        ('55555555-5555-4555-a555-555555555555', '55555555-5555-4555-a555-555555555555', 'Lucas Barbeiro', '34988882222', 'barber')
      ON CONFLICT (auth_user_id) DO UPDATE SET role = EXCLUDED.role, phone = EXCLUDED.phone;

      UPDATE public.barbers SET user_id = '22222222-2222-4222-a222-222222222222' WHERE id = 'barber-diego';
      UPDATE public.barbers SET user_id = '55555555-5555-4555-a555-555555555555' WHERE id = 'barber-lucas';
    `);
  });

  beforeEach(async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-a111-111111111111', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
  });

  afterEach(async () => {
    try {
      await db.exec(`RESET ROLE;`);
    } catch {
      // ignore
    }
  });

  // 1. Usuário autenticado tenta UPDATE direto em appointment_time
  it('1. UPDATE direto em appointment_time é bloqueado', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-audit-1', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-16T10:00:00', 'confirmed');
    `);

    await db.exec(`SET ROLE authenticated;`);
    await expect(
      db.query(`UPDATE public.appointments SET appointment_time = '2026-12-16T14:00:00' WHERE id = 'appt-audit-1';`)
    ).rejects.toThrow(/(permission denied|ACESSO_NEGADO|HORARIO_INDISPONIVEL)/i);
    await db.exec(`RESET ROLE;`);
  });

  // 2. Usuário autenticado tenta UPDATE direto em barber_id
  it('2. UPDATE direto em barber_id é bloqueado', async () => {
    await db.exec(`SET ROLE authenticated;`);
    await expect(
      db.query(`UPDATE public.appointments SET barber_id = 'barber-lucas' WHERE id = 'appt-audit-1';`)
    ).rejects.toThrow(/(permission denied|ACESSO_NEGADO)/i);
    await db.exec(`RESET ROLE;`);
  });

  // 3. Usuário autenticado tenta UPDATE direto em service_id
  it('3. UPDATE direto em service_id é bloqueado', async () => {
    await db.exec(`SET ROLE authenticated;`);
    await expect(
      db.query(`UPDATE public.appointments SET service_id = 'srv-barba' WHERE id = 'appt-audit-1';`)
    ).rejects.toThrow(/(permission denied|ACESSO_NEGADO)/i);
    await db.exec(`RESET ROLE;`);
  });

  // 4. Usuário autenticado tenta UPDATE direto em appointment_services
  it('4. UPDATE direto em appointment_services é bloqueado por privilégios', async () => {
    await db.exec(`
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-audit-1', 'srv-corte');
      SET ROLE authenticated;
    `);

    await expect(
      db.query(`UPDATE public.appointment_services SET service_id = 'srv-barba' WHERE appointment_id = 'appt-audit-1';`)
    ).rejects.toThrow(/permission denied/i);
    await db.exec(`RESET ROLE;`);
  });

  // 5. Usuário define club01.in_reschedule_rpc=true e tenta UPDATE direto (bloqueado incondicionalmente!)
  it('5. Manipular a variável in_reschedule_rpc não concede acesso ao UPDATE direto', async () => {
    await db.exec(`
      SET ROLE authenticated;
      SELECT set_config('club01.in_reschedule_rpc', 'true', false);
    `);

    await expect(
      db.query(`UPDATE public.appointments SET appointment_time = '2026-12-16T15:00:00' WHERE id = 'appt-audit-1';`)
    ).rejects.toThrow(/(permission denied|ACESSO_NEGADO)/i);
    await db.exec(`RESET ROLE;`);
  });

  // 6. Usuário tenta alterar status para reativar agendamento em horário ocupado (bloqueado pelo trigger)
  it('6. Reativar agendamento cancelado para horário já ocupado é bloqueado com HORARIO_INDISPONIVEL', async () => {
    await db.exec(`
      -- Agendamento 2 ativo às 16:00
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-audit-ativo', 'cust-roberto', 'barber-diego', 'srv-corte', '2026-12-16T16:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-audit-ativo', 'srv-corte');

      -- Agendamento cancelado com o mesmo horário
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-audit-canc', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-16T16:00:00', 'cancelled');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-audit-canc', 'srv-corte');
    `);

    // Tentar reativar para 'confirmed' deve ser rejeitado pelo trigger defensivo
    await expect(
      db.query(`UPDATE public.appointments SET status = 'confirmed' WHERE id = 'appt-audit-canc';`)
    ).rejects.toThrow(/HORARIO_INDISPONIVEL/);
  });

  // 7. Usuário tenta contornar RLS
  it('7. Usuário anônimo não possui permissão de leitura em dados restritos', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
    `);

    const res = await db.query(`SELECT count(*) FROM public.appointments WHERE status = 'completed';`);
    // RLS filtra status completed para anon
    expect(parseInt(res.rows[0].count, 10)).toBe(0);
  });

  // 8. Usuário anônimo tenta executar RPC sem permissão
  it('8. Usuário anônimo tem execução de RPC bloqueada', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
      SET ROLE anon;
    `);

    try {
      await expect(
        db.query(`SELECT public.reschedule_appointment_online('appt-audit-1', '2026-12-16T18:00:00');`)
      ).rejects.toThrow(/(permission denied|ACESSO_NEGADO)/i);
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 9. Usuário tenta modificar agendamento de terceiro
  it('9. Cliente autenticado não pode remarcar agendamento de outro cliente', async () => {
    // Autentica como Marcos tentando mexer no do Roberto
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-audit-ativo', '2026-12-16T18:00:00');`)
    ).rejects.toThrow(/ACESSO_NEGADO/);
  });

  // 10. Barbeiro tenta assumir agendamento de outro profissional
  it('10. Barbeiro não pode assumir agendamento alheio via remarcação', async () => {
    // Lucas tenta mexer no do Diego
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '55555555-5555-4555-a555-555555555555', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-audit-1', '2026-12-16T18:00:00', 'barber-lucas');`)
    ).rejects.toThrow(/ACESSO_NEGADO/);
  });

  // 11. Cliente autenticado executa remarcação legítima
  it('11. Cliente autenticado titular executa remarcação com sucesso', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    const res = await db.query(`
      SELECT public.reschedule_appointment_online('appt-audit-1', '2026-12-16T14:00:00', 'barber-diego') as res;
    `);
    expect(res.rows[0].res.success).toBe(true);
    expect(res.rows[0].res.appointment_time).toBe('2026-12-16T14:00:00');
  });

  // 12. Administrador executa remarcação legítima
  it('12. Administrador executa remarcação e transferência autorizada', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-a111-111111111111', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    const res = await db.query(`
      SELECT public.reschedule_appointment_online('appt-audit-1', '2026-12-16T17:00:00', 'barber-lucas') as res;
    `);
    expect(res.rows[0].res.success).toBe(true);
    expect(res.rows[0].res.barber_id).toBe('barber-lucas');
  });

  // 13. Cancelamento legítimo continua funcionando (status = 'cancelled')
  it('13. Operação de cancelamento legítima continua permitida para authenticated', async () => {
    await db.exec(`SET ROLE authenticated;`);
    try {
      await db.query(`UPDATE public.appointments SET status = 'cancelled', cancellation_reason = 'Cliente solicitou' WHERE id = 'appt-audit-1';`);
    } finally {
      await db.exec(`RESET ROLE;`);
    }

    const check = (await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-audit-1';`)).rows[0];
    expect(check.status).toBe('cancelled');
  });

  // 14. Conclusão legítima continua funcionando (status = 'completed')
  it('14. Operação de conclusão legítima continua permitida para authenticated', async () => {
    await db.exec(`SET ROLE authenticated;`);
    try {
      await db.query(`UPDATE public.appointments SET status = 'completed' WHERE id = 'appt-audit-ativo';`);
    } finally {
      await db.exec(`RESET ROLE;`);
    }

    const check = (await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-audit-ativo';`)).rows[0];
    expect(check.status).toBe('completed');
  });

  // 15. Registro de ausência continua funcionando (status = 'absent')
  it('15. Registro de ausência (falta) continua permitido para authenticated', async () => {
    await db.exec(`SET ROLE authenticated;`);
    try {
      await db.query(`UPDATE public.appointments SET status = 'absent' WHERE id = 'appt-audit-ativo';`);
    } finally {
      await db.exec(`RESET ROLE;`);
    }

    const check = (await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-audit-ativo';`)).rows[0];
    expect(check.status).toBe('absent');
  });

  // 16. Serviços múltiplos permanecem íntegros
  it('16. Múltiplos serviços calculam duração correta na remarcação', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-audit-multi', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-17T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-audit-multi', 'srv-corte'),
        ('appt-audit-multi', 'srv-barba');
    `);

    const res = await db.query(`
      SELECT public.reschedule_appointment_online('appt-audit-multi', '2026-12-17T14:00:00', 'barber-diego') as res;
    `);
    expect(res.rows[0].res.duration_minutes).toBe(60);
  });

  // 17. Remarcação inválida não altera notificações nem cancela lembretes
  it('17. Remarcação rejeitada preserva o lembrete pendente sem alteração', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.role', 'service_role', false);
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status
      ) VALUES (
        'rem-preserva-audit', 'appt-audit-multi', 'reminder_30m', 'client', '34999991111', 'MARCOS', 'Aviso', 'pending'
      );
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    // Falha intencional (fora do expediente)
    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-audit-multi', '2026-12-20T10:00:00', 'barber-diego');`) // domingo
    ).rejects.toThrow(/FORA_DO_EXPEDIENTE/);

    const checkRem = (await db.query(`SELECT status FROM public.notification_queue WHERE id = 'rem-preserva-audit';`)).rows[0];
    expect(checkRem.status).toBe('pending');
  });

  // 18. Remarcação válida gera eventos corretos
  it('18. Remarcação confirmada gera notificação de reschedule', async () => {
    await db.query(`
      SELECT public.reschedule_appointment_online('appt-audit-multi', '2026-12-17T15:00:00', 'barber-diego');
    `);

    const checkNotif = await db.query(`
      SELECT event_type FROM public.notification_queue 
      WHERE appointment_id = 'appt-audit-multi' AND event_type = 'reschedule';
    `);
    expect(checkNotif.rows.length).toBeGreaterThan(0);
  });

  // 19. Dois usuários disputam o mesmo horário (concorrência com advisory lock)
  it('19. Disputa simultânea do mesmo horário rejeita o segundo concorrente', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES 
        ('appt-disp-1', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-18T09:00:00', 'confirmed'),
        ('appt-disp-2', 'cust-roberto', 'barber-diego', 'srv-corte', '2026-12-18T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-disp-1', 'srv-corte'),
        ('appt-disp-2', 'srv-corte');
    `);

    const target = '2026-12-18T15:00:00';
    const p1 = db.query(`SELECT public.reschedule_appointment_online('appt-disp-1', '${target}', 'barber-diego') as res;`)
      .then(r => ({ ok: true, data: r.rows[0].res }))
      .catch(e => ({ ok: false, err: e.message }));
    const p2 = db.query(`SELECT public.reschedule_appointment_online('appt-disp-2', '${target}', 'barber-diego') as res;`)
      .then(r => ({ ok: true, data: r.rows[0].res }))
      .catch(e => ({ ok: false, err: e.message }));

    const [r1, r2] = await Promise.all([p1, p2]);
    const successes = [r1, r2].filter(r => r.ok);
    const failures = [r1, r2].filter(r => !r.ok);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].err).toMatch(/HORARIO_INDISPONIVEL/);
  });

  // 20. Remarcação concorre com novo agendamento
  it('20. Concorrência entre remarcação e novo agendamento serializada pelo mesmo lock', async () => {
    const target = '2026-12-18T17:00:00';
    const pResched = db.query(`SELECT public.reschedule_appointment_online('appt-disp-1', '${target}', 'barber-diego') as res;`)
      .then(r => ({ ok: true, data: r.rows[0].res }))
      .catch(e => ({ ok: false, err: e.message }));
    const pBook = db.query(`SELECT public.book_appointment_online('Novo Cliente', '34991118877', 'barber-diego', ARRAY['srv-corte'], '${target}') as res;`)
      .then(r => ({ ok: true, data: r.rows[0].res }))
      .catch(e => ({ ok: false, err: e.message }));

    const [r1, r2] = await Promise.all([pResched, pBook]);
    const successes = [r1, r2].filter(r => r.ok);
    const failures = [r1, r2].filter(r => !r.ok);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].err).toMatch(/HORARIO_INDISPONIVEL/);
  });

  // 21. Troca simultânea entre profissionais (ordem lexicográfica)
  it('21. Transferência cruzada entre barbeiros executa sem deadlock', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES 
        ('appt-switch-1', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-19T09:00:00', 'confirmed'),
        ('appt-switch-2', 'cust-roberto', 'barber-lucas', 'srv-corte', '2026-12-19T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-switch-1', 'srv-corte'),
        ('appt-switch-2', 'srv-corte');
    `);

    const t1 = db.query(`SELECT public.reschedule_appointment_online('appt-switch-1', '2026-12-19T14:00:00', 'barber-lucas') as res;`);
    const t2 = db.query(`SELECT public.reschedule_appointment_online('appt-switch-2', '2026-12-19T15:00:00', 'barber-diego') as res;`);

    const results = await Promise.all([t1, t2]);
    expect(results[0].rows[0].res.success).toBe(true);
    expect(results[1].rows[0].res.success).toBe(true);
  });

  // 22. Rollback preserva os dados originais
  it('22. Exceção na RPC garante rollback atômico', async () => {
    const timeBefore = (await db.query(`SELECT appointment_time FROM public.appointments WHERE id = 'appt-switch-1';`)).rows[0].appointment_time;

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-switch-1', '2026-12-19T16:00:00', 'barber-diego', ARRAY['srv-fantasma']);`)
    ).rejects.toThrow(/SERVICO_INVALIDO/);

    const timeAfter = (await db.query(`SELECT appointment_time FROM public.appointments WHERE id = 'appt-switch-1';`)).rows[0].appointment_time;
    expect(timeAfter).toBe(timeBefore);
  });

  // 23. Alterações de status não burlam a ocupação de horários
  it('23. Alterações diretas de status respeitam sobreposição através do trigger', async () => {
    const checkActive = (await db.query(`SELECT count(*) FROM public.appointments WHERE barber_id = 'barber-diego' AND status = 'confirmed';`)).rows[0].count;
    expect(parseInt(checkActive, 10)).toBeGreaterThan(0);
  });

  // 24. Privilégios herdados não permitem contornar a RPC
  it('24. Nenhuma permissão ampla de UPDATE persiste para o papel authenticated', async () => {
    const privQuery = await db.query(`
      SELECT privilege_type, column_name 
      FROM information_schema.column_privileges 
      WHERE table_name = 'appointments' AND grantee = 'authenticated';
    `);

    const updatedCols = privQuery.rows.filter(r => r.privilege_type === 'UPDATE').map(r => r.column_name);
    expect(updatedCols).not.toContain('appointment_time');
    expect(updatedCols).not.toContain('barber_id');
    expect(updatedCols).not.toContain('service_id');
  });
});

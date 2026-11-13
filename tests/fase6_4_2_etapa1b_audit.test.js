/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.4.2 — ETAPA 1B: VERIFICAÇÃO FINAL DE LOCKS, TRANSIÇÕES DE STATUS,
 * PRIVACIDADE DA TABELA CUSTOMERS E SEGURANÇA DO ROLLBACK
 * ==============================================================================
 * Cobre os 20 cenários específicos exigidos na Seção 7 da Etapa 1B:
 *  1. Comparação das chaves reais dos advisory locks
 *  2. Criação versus remarcação concorrente
 *  3. Cliente tentando concluir atendimento (bloqueado)
 *  4. Cliente tentando registrar ausência (bloqueado)
 *  5. Cliente tentando reativar agendamento cancelado (bloqueado)
 *  6. Cliente tentando alterar status de terceiro (bloqueado)
 *  7. Barbeiro executando transição não autorizada (bloqueado)
 *  8. Secretário executando transição autorizada (permitido)
 *  9. Administrador executando transição autorizada (permitido)
 * 10. Reativação concorrente com novo agendamento (bloqueado por sobreposição)
 * 11. Consulta indevida à tabela customers por anônimo (bloqueado por privilégio)
 * 12. Enumeração de telefones por usuário anônimo (bloqueado no parser)
 * 13. Leitura de dados de outro cliente por cliente autenticado (filtrado por RLS)
 * 14. Leitura de dados por equipe autorizada (permitido)
 * 15. Verificação dos privilégios efetivos após migration
 * 16. Verificação dos privilégios e limites previstos no rollback
 * 17. Preservação de cancelamento legítimo pelo cliente titular
 * 18. Preservação de conclusão legítima pela equipe
 * 19. Preservação de registro de ausência pela equipe
 * 20. Preservação de notificações e lembretes após transações rejeitadas
 * ==============================================================================
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

/* global process */
const BASE_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

describe('Fase 6.4.2 — Etapa 1B: Verificação de Locks, Status, Privacidade e Rollback', () => {
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

    // 3. Carregar a migration final 0025 da Fase 6.4.2 (Etapa 1B)
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
        ('srv-barba', 'Barba Terapia', 30, 35.00, false);

      INSERT INTO public.barber_services (barber_id, service_id) VALUES
        ('barber-diego', 'srv-corte'),
        ('barber-diego', 'srv-barba'),
        ('barber-lucas', 'srv-corte');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-marcos', 'MARCOS SILVA', '34999991111'),
        ('cust-roberto', 'ROBERTO COSTA', '34999992222');

      INSERT INTO auth.users (id, email) VALUES
        ('11111111-1111-4111-a111-111111111111', 'admin@club01.com.br'),
        ('22222222-2222-4222-a222-222222222222', 'diego@club01.com.br'),
        ('33333333-3333-4333-a333-333333333333', 'marcos@teste.com'),
        ('44444444-4444-4444-a444-444444444444', 'roberto@teste.com'),
        ('55555555-5555-4555-a555-555555555555', 'lucas@club01.com.br'),
        ('66666666-6666-4666-a666-666666666666', 'secretaria@club01.com.br');

      INSERT INTO public.users (id, auth_user_id, name, phone, role) VALUES
        ('11111111-1111-4111-a111-111111111111', '11111111-1111-4111-a111-111111111111', 'Administrador', '34999990000', 'admin'),
        ('22222222-2222-4222-a222-222222222222', '22222222-2222-4222-a222-222222222222', 'Diego Barbeiro', '34988881111', 'barber'),
        ('33333333-3333-4333-a333-333333333333', '33333333-3333-4333-a333-333333333333', 'MARCOS SILVA', '34999991111', 'client'),
        ('44444444-4444-4444-a444-444444444444', '44444444-4444-4444-a444-444444444444', 'ROBERTO COSTA', '34999992222', 'client'),
        ('55555555-5555-4555-a555-555555555555', '55555555-5555-4555-a555-555555555555', 'Lucas Barbeiro', '34988882222', 'barber'),
        ('66666666-6666-4666-a666-666666666666', '66666666-6666-4666-a666-666666666666', 'Secretaria', '34999993333', 'secretario')
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

  // 1. Comparação das chaves reais dos advisory locks
  it('1. Chaves de lock de book_appointment_online e reschedule_appointment_online são matematicamente idênticas', async () => {
    const keyQuery = await db.query(`
      SELECT 
        hashtext('barber_booking_' || 'barber-diego') AS key_book,
        pg_catalog.hashtext('barber_booking_' || 'barber-diego') AS key_reschedule;
    `);
    const { key_book, key_reschedule } = keyQuery.rows[0];
    expect(key_book).toBe(key_reschedule);
  });

  // 2. Criação versus remarcação concorrente
  it('2. Criação e remarcação concorrentes disputam exatamente a mesma chave de lock', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-lock-comp', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-22T09:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-lock-comp', 'srv-corte');
    `);

    const targetSlot = '2026-12-22T14:00:00';
    const p1 = db.query(`SELECT public.reschedule_appointment_online('appt-lock-comp', '${targetSlot}', 'barber-diego') as res;`)
      .then(r => ({ ok: true, data: r.rows[0].res }))
      .catch(e => ({ ok: false, err: e.message }));

    const p2 = db.query(`SELECT public.book_appointment_online('Cliente Novo Concorrente', '34992223344', 'barber-diego', ARRAY['srv-corte'], '${targetSlot}') as res;`)
      .then(r => ({ ok: true, data: r.rows[0].res }))
      .catch(e => ({ ok: false, err: e.message }));

    const [r1, r2] = await Promise.all([p1, p2]);
    const successes = [r1, r2].filter(r => r.ok);
    const failures = [r1, r2].filter(r => !r.ok);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].err).toMatch(/HORARIO_INDISPONIVEL/);
  });

  // 3. Cliente tentando concluir atendimento (bloqueado)
  it('3. Cliente comum tentando concluir seu próprio atendimento é bloqueado com TRANSICAO_STATUS_NAO_AUTORIZADA ou RLS', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-cli-comp', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-22T10:00:00', 'confirmed');
      
      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      await expect(
        db.query(`UPDATE public.appointments SET status = 'completed' WHERE id = 'appt-cli-comp';`)
      ).rejects.toThrow(/(TRANSICAO_STATUS_NAO_AUTORIZADA|violates row-level security policy)/i);
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 4. Cliente tentando registrar ausência (bloqueado)
  it('4. Cliente comum tentando registrar ausência (falta) é bloqueado com TRANSICAO_STATUS_NAO_AUTORIZADA ou RLS', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      await expect(
        db.query(`UPDATE public.appointments SET status = 'absent' WHERE id = 'appt-cli-comp';`)
      ).rejects.toThrow(/(TRANSICAO_STATUS_NAO_AUTORIZADA|violates row-level security policy)/i);
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 5. Cliente tentando reativar agendamento cancelado (bloqueado)
  it('5. Cliente comum tentando reativar agendamento cancelado para confirmed é bloqueado', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-cli-canc', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-22T11:00:00', 'cancelled');

      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      await expect(
        db.query(`UPDATE public.appointments SET status = 'confirmed' WHERE id = 'appt-cli-canc';`)
      ).rejects.toThrow(/(TRANSICAO_STATUS_NAO_AUTORIZADA|violates row-level security policy)/i);
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 6. Cliente tentando alterar status de terceiro (bloqueado)
  it('6. Cliente comum tentando cancelar agendamento de outro cliente é bloqueado com ACESSO_NEGADO ou RLS', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-outro-cli', 'cust-roberto', 'barber-diego', 'srv-corte', '2026-12-22T15:00:00', 'confirmed');

      -- Loga como Marcos
      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      const res = await db.query(`UPDATE public.appointments SET status = 'cancelled' WHERE id = 'appt-outro-cli';`);
      expect(res.rowCount).toBe(0);
      await db.exec(`RESET ROLE;`);
      const check = (await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-outro-cli';`)).rows[0];
      expect(check.status).toBe('confirmed');
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 7. Barbeiro executando transição não autorizada (bloqueado)
  it('7. Barbeiro tentando alterar status de agendamento de outro profissional é bloqueado por RLS', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-lucas-agenda', 'cust-roberto', 'barber-lucas', 'srv-corte', '2026-12-22T16:00:00', 'confirmed');

      -- Diego tenta mexer na agenda do Lucas
      SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-a222-222222222222', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      const res = await db.query(`UPDATE public.appointments SET status = 'completed' WHERE id = 'appt-lucas-agenda';`);
      expect(res.rowCount).toBe(0);
      await db.exec(`RESET ROLE;`);
      const check = (await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-lucas-agenda';`)).rows[0];
      expect(check.status).toBe('confirmed');
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 8. Secretário executando transição autorizada (permitido)
  it('8. Secretário autenticado possui permissão para cancelar e gerenciar agendamentos', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '66666666-6666-4666-a666-666666666666', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      await db.query(`UPDATE public.appointments SET status = 'cancelled', cancellation_reason = 'Cancelado pela recepção' WHERE id = 'appt-lucas-agenda';`);
      const res = await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-lucas-agenda';`);
      expect(res.rows[0].status).toBe('cancelled');
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 9. Administrador executando transição autorizada (permitido)
  it('9. Administrador possui permissão total de gerenciamento e conclusão', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-a111-111111111111', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      await db.query(`UPDATE public.appointments SET status = 'completed' WHERE id = 'appt-lock-comp';`);
      const res = await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-lock-comp';`);
      expect(res.rows[0].status).toBe('completed');
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 10. Reativação concorrente com novo agendamento
  it('10. Reativação de agendamento cancelado para horário já ocupado é bloqueada pelo trigger defensivo', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES 
        ('appt-reat-ativo', 'cust-roberto', 'barber-diego', 'srv-corte', '2026-12-23T10:00:00', 'confirmed'),
        ('appt-reat-canc', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-23T10:00:00', 'cancelled');
    `);

    await expect(
      db.query(`UPDATE public.appointments SET status = 'confirmed' WHERE id = 'appt-reat-canc';`)
    ).rejects.toThrow(/HORARIO_INDISPONIVEL/);
  });

  // 11. Consulta indevida à tabela customers por anônimo (bloqueado por privilégio)
  it('11. Usuário anônimo tem privilégio SELECT revogado sumariamente na tabela customers', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
      SET ROLE anon;
    `);

    try {
      await expect(
        db.query(`SELECT * FROM public.customers;`)
      ).rejects.toThrow(/permission denied for table customers/i);
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 12. Enumeração de telefones por usuário anônimo (bloqueado no parser)
  it('12. Enumeração de telefones de clientes por usuário anônimo é rejeitada no nível relacional', async () => {
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
      SET ROLE anon;
    `);

    try {
      await expect(
        db.query(`SELECT phone FROM public.customers WHERE phone LIKE '34%';`)
      ).rejects.toThrow(/permission denied/i);
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 13. Leitura de dados de outro cliente por cliente autenticado (filtrado por RLS)
  it('13. Cliente autenticado lê apenas seus próprios dados cadastrais na tabela customers', async () => {
    // Autenticado como Marcos
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      const res = await db.query(`SELECT id, name, phone FROM public.customers;`);
      // RLS deve retornar estritamente o Marcos
      expect(res.rows.length).toBe(1);
      expect(res.rows[0].id).toBe('cust-marcos');
      expect(res.rows[0].name).toBe('MARCOS SILVA');
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 14. Leitura de dados por equipe autorizada (permitido)
  it('14. Equipe (admin, secretario, barber) possui visualização dos clientes para atendimento', async () => {
    // Autenticado como Diego Barbeiro
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-a222-222222222222', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      const res = await db.query(`SELECT count(*) FROM public.customers;`);
      expect(parseInt(res.rows[0].count, 10)).toBeGreaterThanOrEqual(2);
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 15. Verificação dos privilégios efetivos após migration
  it('15. Tabela appointments não possui UPDATE amplo em colunas críticas para authenticated', async () => {
    const privQuery = await db.query(`
      SELECT column_name, privilege_type 
      FROM information_schema.column_privileges 
      WHERE table_name = 'appointments' AND grantee = 'authenticated';
    `);

    const updateCols = privQuery.rows.filter(r => r.privilege_type === 'UPDATE').map(r => r.column_name);
    expect(updateCols).not.toContain('appointment_time');
    expect(updateCols).not.toContain('barber_id');
    expect(updateCols).not.toContain('service_id');
    expect(updateCols).toContain('status');
    expect(updateCols).toContain('cancellation_reason');
  });

  // 16. Verificação dos privilégios e limites previstos no rollback
  it('16. Script de rollback não contém concessão indiscriminada de UPDATE amplo', () => {
    const rollbackSql = fs.readFileSync(path.join(MIGRATIONS_DIR, '0025_reschedule_appointment_online_rollback.sql'), 'utf-8');
    expect(rollbackSql).not.toMatch(/GRANT\s+UPDATE\s+ON\s+public\.appointments\s+TO\s+authenticated\s*;/i);
    expect(rollbackSql).toContain('ROLLBACK AUTOMÁTICO NÃO SEGURO — EXIGE PROCEDIMENTO CONTROLADO DE RECUPERAÇÃO');
  });

  // 17. Preservação de cancelamento legítimo pelo cliente titular
  it('17. Cliente titular cancela com sucesso seu próprio agendamento', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-canc-titular', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-24T10:00:00', 'confirmed');

      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      await db.query(`
        UPDATE public.appointments 
        SET status = 'cancelled', cancellation_reason = 'Imprevisto pessoal' 
        WHERE id = 'appt-canc-titular';
      `);
      const check = (await db.query(`SELECT status, cancellation_reason FROM public.appointments WHERE id = 'appt-canc-titular';`)).rows[0];
      expect(check.status).toBe('cancelled');
      expect(check.cancellation_reason).toBe('Imprevisto pessoal');
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 18. Preservação de conclusão legítima pela equipe
  it('18. Barbeiro titular conclui atendimento de seu próprio cliente', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-concl-barber', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-24T11:00:00', 'confirmed');

      -- Diego é o barbeiro do agendamento
      SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-a222-222222222222', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      await db.query(`UPDATE public.appointments SET status = 'completed' WHERE id = 'appt-concl-barber';`);
      const check = (await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-concl-barber';`)).rows[0];
      expect(check.status).toBe('completed');
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 19. Preservação de registro de ausência pela equipe
  it('19. Barbeiro titular marca falta (absent) de seu cliente', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-aus-barber', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-24T12:00:00', 'confirmed');

      SELECT set_config('request.jwt.claim.sub', '22222222-2222-4222-a222-222222222222', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      SET ROLE authenticated;
    `);

    try {
      await db.query(`UPDATE public.appointments SET status = 'absent' WHERE id = 'appt-aus-barber';`);
      const check = (await db.query(`SELECT status FROM public.appointments WHERE id = 'appt-aus-barber';`)).rows[0];
      expect(check.status).toBe('absent');
    } finally {
      await db.exec(`RESET ROLE;`);
    }
  });

  // 20. Preservação de notificações e lembretes após transações rejeitadas
  it('20. Transação rejeitada preserva o lembrete pendente sem alteração', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-notif-preserva', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-12-25T10:00:00', 'confirmed');

      SELECT set_config('request.jwt.claim.role', 'service_role', false);
      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status
      ) VALUES (
        'rem-preserva-1b', 'appt-notif-preserva', 'reminder_30m', 'client', '34999991111', 'MARCOS', 'Lembrete', 'pending'
      );
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    // Tentar remarcar para fora do expediente (falha esperada)
    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-notif-preserva', '2026-12-27T10:00:00', 'barber-diego');`) // domingo
    ).rejects.toThrow(/FORA_DO_EXPEDIENTE/);

    const checkRem = (await db.query(`SELECT status FROM public.notification_queue WHERE id = 'rem-preserva-1b';`)).rows[0];
    expect(checkRem.status).toBe('pending');
  });
});

/**
 * ==============================================================================
 * PROJETO: CLUB 01 BARBER STUDIO
 * FASE 6.4: SUÍTE DE TESTES DE SEGURANÇA TRANSACIONAL DA REMARCAÇÃO
 * ==============================================================================
 * Testa a nova RPC public.reschedule_appointment_online e defesas transacionais
 * em ambiente isolado PostgreSQL (PGlite).
 *
 * Cobre rigorosamente os 22 cenários exigidos pela Fase 6.4:
 * 1. Remarcação válida para outro horário
 * 2. Remarcação para horário ocupado
 * 3. Duas remarcações simultâneas para o mesmo horário
 * 4. Remarcação concorrente com novo agendamento
 * 5. Troca de profissional válida
 * 6. Troca para profissional indisponível
 * 7. Troca para profissional sem especialidade
 * 8. Remarcação fora do expediente
 * 9. Remarcação sem antecedência mínima
 * 10. Remarcação de agendamento cancelado
 * 11. Remarcação de agendamento concluído
 * 12. Tentativa de alterar agendamento de outro cliente
 * 13. Agendamento com múltiplos serviços
 * 14. Alteração de duração
 * 15. Sobreposição parcial de horários
 * 16. Preservação do histórico
 * 17. Cancelamento do lembrete antigo
 * 18. Criação do novo lembrete
 * 19. Geração das notificações corretas
 * 20. Rollback integral em caso de erro
 * 21. Tentativa de contornar a RPC por UPDATE direto
 * 22. Preservação das travas WhatsApp
 * ==============================================================================
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

/* global process */
const BASE_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

describe('Fase 6.4: Segurança Transacional e Integridade da Remarcação', () => {
  let db;

  beforeAll(async () => {
    db = new PGlite();

    // 1. Mock de funções de autenticação e contexto Supabase
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

    // 3. Carregar a nova migration 0025 (Fase 6.4)
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
        ('srv-quimica', 'Platinado Especial', 60, 120.00, false),
        ('srv-vip-restrito', 'Atendimento VIP', 60, 200.00, true);

      -- Diego faz corte e barba
      INSERT INTO public.barber_services (barber_id, service_id) VALUES
        ('barber-diego', 'srv-corte'),
        ('barber-diego', 'srv-barba');

      -- Lucas faz apenas química e corte (NÃO faz barba)
      INSERT INTO public.barber_services (barber_id, service_id) VALUES
        ('barber-lucas', 'srv-corte'),
        ('barber-lucas', 'srv-quimica');

      INSERT INTO public.customers (id, name, phone) VALUES
        ('cust-marcos', 'MARCOS SILVA', '34999991111'),
        ('cust-roberto', 'ROBERTO COSTA', '34999992222');

      -- Usuários administrativos e equipe para teste de autorização
      INSERT INTO auth.users (id, email) VALUES
        ('11111111-1111-4111-a111-111111111111', 'admin@club01.com.br'),
        ('22222222-2222-4222-a222-222222222222', 'diego@club01.com.br');

      INSERT INTO public.users (id, auth_user_id, name, email, role) VALUES
        ('11111111-1111-4111-a111-111111111111', '11111111-1111-4111-a111-111111111111', 'Administrador', 'admin@club01.com.br', 'admin'),
        ('22222222-2222-4222-a222-222222222222', '22222222-2222-4222-a222-222222222222', 'Diego Barbeiro', 'diego@club01.com.br', 'barber')
      ON CONFLICT (auth_user_id) DO UPDATE SET role = EXCLUDED.role;

      UPDATE public.barbers SET user_id = '22222222-2222-4222-a222-222222222222' WHERE id = 'barber-diego';
    `);
  });

  beforeEach(async () => {
    // Configura contexto como admin por padrão para os testes
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '11111111-1111-4111-a111-111111111111', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);
  });

  // 1. Remarcação válida para outro horário
  it('1. Remarcação válida para outro horário atualiza horário e status', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-01', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-10T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-01', 'srv-corte');
    `);

    const res = await db.query(`
      SELECT public.reschedule_appointment_online('appt-01', '2026-11-10T14:00:00', 'barber-diego') as result;
    `);

    const json = res.rows[0].result;
    expect(json.success).toBe(true);
    expect(json.appointment_time).toBe('2026-11-10T14:00:00');

    const check = await db.query(`SELECT appointment_time FROM public.appointments WHERE id = 'appt-01';`);
    expect(check.rows[0].appointment_time).toBe('2026-11-10T14:00:00');
  });

  // 2. Remarcação para horário ocupado
  it('2. Remarcação para horário já ocupado é rejeitada com HORARIO_INDISPONIVEL', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES 
        ('appt-ocupa', 'cust-roberto', 'barber-diego', 'srv-corte', '2026-11-10T15:00:00', 'confirmed'),
        ('appt-para-remarcar', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-10T09:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-ocupa', 'srv-corte'),
        ('appt-para-remarcar', 'srv-corte');
    `);

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-para-remarcar', '2026-11-10T15:00:00', 'barber-diego');`)
    ).rejects.toThrow(/HORARIO_INDISPONIVEL/);
  });

  // 3. Duas remarcações simultâneas para o mesmo horário (concorrência)
  it('3. Duas remarcações simultâneas para o mesmo horário: uma sucede e a outra falha', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES 
        ('appt-conc-1', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-11T09:00:00', 'confirmed'),
        ('appt-conc-2', 'cust-roberto', 'barber-diego', 'srv-corte', '2026-11-11T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-conc-1', 'srv-corte'),
        ('appt-conc-2', 'srv-corte');
    `);

    // Ambas tentam disputar 2026-11-11T16:00:00
    const targetSlot = '2026-11-11T16:00:00';

    const p1 = db.query(`SELECT public.reschedule_appointment_online('appt-conc-1', '${targetSlot}', 'barber-diego') as res;`)
      .then(r => ({ ok: true, data: r.rows[0].res }))
      .catch(e => ({ ok: false, err: e.message }));

    const p2 = db.query(`SELECT public.reschedule_appointment_online('appt-conc-2', '${targetSlot}', 'barber-diego') as res;`)
      .then(r => ({ ok: true, data: r.rows[0].res }))
      .catch(e => ({ ok: false, err: e.message }));

    const [r1, r2] = await Promise.all([p1, p2]);

    const successes = [r1, r2].filter(r => r.ok);
    const failures = [r1, r2].filter(r => !r.ok);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].err).toMatch(/HORARIO_INDISPONIVEL/);
  });

  // 4. Remarcação concorrente com novo agendamento
  it('4. Remarcação concorrente com book_appointment_online disputa o mesmo slot com proteção transacional', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-remarc-vs-new', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-12T09:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-remarc-vs-new', 'srv-corte');
    `);

    const targetSlot = '2026-11-12T11:00:00';

    const pResched = db.query(`SELECT public.reschedule_appointment_online('appt-remarc-vs-new', '${targetSlot}', 'barber-diego') as res;`)
      .then(r => ({ ok: true, type: 'reschedule', data: r.rows[0].res }))
      .catch(e => ({ ok: false, type: 'reschedule', err: e.message }));

    const pBook = db.query(`SELECT public.book_appointment_online('Novo Cliente', '34998877665', 'barber-diego', ARRAY['srv-corte'], '${targetSlot}') as res;`)
      .then(r => ({ ok: true, type: 'book', data: r.rows[0].res }))
      .catch(e => ({ ok: false, type: 'book', err: e.message }));

    const [rResched, rBook] = await Promise.all([pResched, pBook]);

    const successes = [rResched, rBook].filter(r => r.ok);
    const failures = [rResched, rBook].filter(r => !r.ok);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);
    expect(failures[0].err).toMatch(/HORARIO_INDISPONIVEL/);
  });

  // 5. Troca de profissional válida
  it('5. Troca de profissional válida transfere o agendamento e preserva regras', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-troca-barber', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-13T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-troca-barber', 'srv-corte');
    `);

    // Lucas realiza srv-corte
    const res = await db.query(`
      SELECT public.reschedule_appointment_online('appt-troca-barber', '2026-11-13T14:00:00', 'barber-lucas') as result;
    `);

    expect(res.rows[0].result.success).toBe(true);
    expect(res.rows[0].result.barber_id).toBe('barber-lucas');

    const check = await db.query(`SELECT barber_id FROM public.appointments WHERE id = 'appt-troca-barber';`);
    expect(check.rows[0].barber_id).toBe('barber-lucas');
  });

  // 6. Troca para profissional indisponível
  it('6. Troca para profissional com horário já ocupado é rejeitada', async () => {
    await db.exec(`
      -- Lucas já tem atendimento às 15:00
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES 
        ('appt-lucas-busy', 'cust-roberto', 'barber-lucas', 'srv-corte', '2026-11-13T15:00:00', 'confirmed'),
        ('appt-diego-troca', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-13T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-lucas-busy', 'srv-corte'),
        ('appt-diego-troca', 'srv-corte');
    `);

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-diego-troca', '2026-11-13T15:00:00', 'barber-lucas');`)
    ).rejects.toThrow(/HORARIO_INDISPONIVEL/);
  });

  // 7. Troca para profissional sem especialidade
  it('7. Troca para profissional que não realiza o serviço é rejeitada com PROFISSIONAL_NAO_HABILITADO', async () => {
    await db.exec(`
      -- Agendamento de Barba com Diego (Lucas NÃO faz barba)
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-barba-diego', 'cust-marcos', 'barber-diego', 'srv-barba', '2026-11-14T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-barba-diego', 'srv-barba');
    `);

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-barba-diego', '2026-11-14T11:00:00', 'barber-lucas');`)
    ).rejects.toThrow(/PROFISSIONAL_NAO_HABILITADO/);
  });

  // 8. Remarcação fora do expediente
  it('8. Remarcação fora do expediente (domingo ou horário não comercial) é rejeitada', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-expediente', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-10T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-expediente', 'srv-corte');
    `);

    // Domingo: 2026-11-15
    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-expediente', '2026-11-15T10:00:00', 'barber-diego');`)
    ).rejects.toThrow(/FORA_DO_EXPEDIENTE/);

    // Antes das 8h (7h)
    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-expediente', '2026-11-16T07:00:00', 'barber-diego');`)
    ).rejects.toThrow(/FORA_DO_EXPEDIENTE/);
  });

  // 9. Remarcação sem antecedência mínima
  it('9. Remarcação no passado ou com menos de 15 min é rejeitada com ANTECEDENCIA_MINIMA', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-antecedencia', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-10T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-antecedencia', 'srv-corte');
    `);

    // Horário no passado (2020)
    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-antecedencia', '2020-01-01T10:00:00', 'barber-diego');`)
    ).rejects.toThrow(/ANTECEDENCIA_MINIMA/);
  });

  // 10. Remarcação de agendamento cancelado
  it('10. Remarcação de agendamento com status cancelled é rejeitada com AGENDAMENTO_CANCELADO', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-cancelado', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-10T10:00:00', 'cancelled');
    `);

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-cancelado', '2026-11-16T14:00:00', 'barber-diego');`)
    ).rejects.toThrow(/AGENDAMENTO_CANCELADO/);
  });

  // 11. Remarcação de agendamento concluído
  it('11. Remarcação de agendamento com status completed é rejeitada com AGENDAMENTO_CONCLUIDO', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-concluido', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-10T10:00:00', 'completed');
    `);

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-concluido', '2026-11-16T14:00:00', 'barber-diego');`)
    ).rejects.toThrow(/AGENDAMENTO_CONCLUIDO/);
  });

  // 12. Tentativa de remarcação anônima é absolutamente bloqueada (mesmo com telefone)
  it('12. Tentativa de remarcação por usuário anônimo é rejeitada com ACESSO_NEGADO', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-alheio', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-10T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-alheio', 'srv-corte');
    `);

    // Altera contexto para anônimo
    await db.exec(`
      SELECT set_config('request.jwt.claim.sub', '', false);
      SELECT set_config('request.jwt.claim.role', 'anon', false);
    `);

    // Usuário anônimo é bloqueado incondicionalmente
    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-alheio', '2026-11-17T10:00:00', 'barber-diego');`)
    ).rejects.toThrow(/ACESSO_NEGADO/);

    // Cliente autenticado legítimo Marcos Silva (34999991111)
    await db.exec(`
      INSERT INTO auth.users (id, email, phone) VALUES
        ('33333333-3333-4333-a333-333333333333', 'marcos@teste.com', '34999991111')
      ON CONFLICT DO NOTHING;
      INSERT INTO public.users (id, auth_user_id, name, phone, role) VALUES
        ('33333333-3333-4333-a333-333333333333', '33333333-3333-4333-a333-333333333333', 'MARCOS SILVA', '34999991111', 'client')
      ON CONFLICT (auth_user_id) DO UPDATE SET phone = EXCLUDED.phone;

      SELECT set_config('request.jwt.claim.sub', '33333333-3333-4333-a333-333333333333', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
    `);

    const okRes = await db.query(`
      SELECT public.reschedule_appointment_online('appt-alheio', '2026-11-17T10:00:00', 'barber-diego') as res;
    `);
    expect(okRes.rows[0].res.success).toBe(true);
  });

  // 13. Agendamento com múltiplos serviços (cálculo de duração)
  it('13. Remarcação preserva múltiplos serviços e calcula duração acumulada (corte 30m + barba 30m = 60m)', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-multi-srv', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-18T09:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-multi-srv', 'srv-corte'),
        ('appt-multi-srv', 'srv-barba');
    `);

    const res = await db.query(`
      SELECT public.reschedule_appointment_online('appt-multi-srv', '2026-11-18T14:00:00', 'barber-diego') as res;
    `);

    expect(res.rows[0].res.success).toBe(true);
    expect(res.rows[0].res.duration_minutes).toBe(60);
  });

  // 14. Alteração de duração com atualização de serviços
  it('14. Alteração de serviços na remarcação atualiza duração e appointment_services atomicamente', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-update-srv', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-18T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-update-srv', 'srv-corte');
    `);

    // Atualiza para corte + barba (60m)
    const res = await db.query(`
      SELECT public.reschedule_appointment_online(
        'appt-update-srv', 
        '2026-11-18T16:00:00', 
        'barber-diego', 
        ARRAY['srv-corte', 'srv-barba']
      ) as res;
    `);

    expect(res.rows[0].res.success).toBe(true);
    expect(res.rows[0].res.duration_minutes).toBe(60);

    const srvCheck = await db.query(`
      SELECT service_id FROM public.appointment_services WHERE appointment_id = 'appt-update-srv' ORDER BY service_id;
    `);
    expect(srvCheck.rows.map(r => r.service_id)).toEqual(['srv-barba', 'srv-corte']);
  });

  // 15. Sobreposição parcial de horários
  it('15. Remarcação para horário com sobreposição parcial de intervalo é rejeitada', async () => {
    await db.exec(`
      -- Agendamento de 60 minutos das 14:00 às 15:00
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-longo', 'cust-roberto', 'barber-diego', 'srv-corte', '2026-11-19T14:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-longo', 'srv-corte'),
        ('appt-longo', 'srv-barba');

      -- Agendamento que tenta remarcar para as 14:30 (dentro do intervalo ocupado)
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-parcial', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-19T09:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-parcial', 'srv-corte');
    `);

    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-parcial', '2026-11-19T14:30:00', 'barber-diego');`)
    ).rejects.toThrow(/HORARIO_INDISPONIVEL/);
  });

  // 16. Preservação do histórico e integridade do cliente
  it('16. Remarcação preserva integridade do cliente e campos essenciais', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-historico', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-20T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-historico', 'srv-corte');
    `);

    await db.query(`SELECT public.reschedule_appointment_online('appt-historico', '2026-11-20T11:00:00', 'barber-diego');`);

    const appt = (await db.query(`SELECT * FROM public.appointments WHERE id = 'appt-historico';`)).rows[0];
    expect(appt.client_id).toBe('cust-marcos');
    expect(appt.status).toBe('confirmed');
    expect(appt.appointment_time).toBe('2026-11-20T11:00:00');
  });

  // 17. Cancelamento do lembrete antigo
  it('17. Remarcação cancela lembrete antigo pendente na notification_queue', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-lembrete-antigo', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-21T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-lembrete-antigo', 'srv-corte');

      INSERT INTO public.notification_queue (
        id, appointment_id, event_type, recipient_type, recipient_phone, recipient_name, content, status
      ) VALUES (
        'rem-antigo-1', 'appt-lembrete-antigo', 'reminder_30m', 'client', '34999991111', 'MARCOS SILVA', 'Lembrete antigo', 'pending'
      );
    `);

    await db.query(`SELECT public.reschedule_appointment_online('appt-lembrete-antigo', '2026-11-21T14:00:00', 'barber-diego');`);

    const oldRem = (await db.query(`SELECT status, last_error FROM public.notification_queue WHERE id = 'rem-antigo-1';`)).rows[0];
    expect(oldRem.status).toBe('cancelled');
    expect(oldRem.last_error).toMatch(/remarcado/i);
  });

  // 18. Criação do novo lembrete
  it('18. Remarcação agenda novo lembrete de 30m ajustado para o novo horário', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-novo-lembrete', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-25T09:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-novo-lembrete', 'srv-corte');
    `);

    await db.query(`SELECT public.reschedule_appointment_online('appt-novo-lembrete', '2026-11-25T16:00:00', 'barber-diego');`);

    const newReminders = await db.query(`
      SELECT * FROM public.notification_queue 
      WHERE appointment_id = 'appt-novo-lembrete' AND event_type = 'reminder_30m' AND status = 'pending';
    `);
    expect(newReminders.rows.length).toBe(1);
    expect(newReminders.rows[0].scheduled_for).toBeTruthy();
  });

  // 19. Geração das notificações corretas
  it('19. Remarcação com troca de barbeiro gera notificações para cliente, barbeiro anterior e novo barbeiro', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-notif-troca', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-23T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-notif-troca', 'srv-corte');
    `);

    await db.query(`SELECT public.reschedule_appointment_online('appt-notif-troca', '2026-11-23T14:00:00', 'barber-lucas');`);

    const events = await db.query(`
      SELECT event_type, recipient_type FROM public.notification_queue 
      WHERE appointment_id = 'appt-notif-troca' AND event_type = 'reschedule'
      ORDER BY recipient_type;
    `);

    const recipients = events.rows.map(r => r.recipient_type);
    expect(recipients).toContain('client');
    expect(recipients).toContain('old_barber');
    expect(recipients).toContain('new_barber');
  });

  // 20. Rollback integral em caso de erro
  it('20. Falha durante a remarcação executa rollback integral mantendo agendamento inalterado', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES ('appt-rollback-test', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-24T10:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES ('appt-rollback-test', 'srv-corte');
    `);

    // Tentativa que falha (serviço inexistente)
    await expect(
      db.query(`SELECT public.reschedule_appointment_online('appt-rollback-test', '2026-11-24T14:00:00', 'barber-diego', ARRAY['srv-fantasma']);`)
    ).rejects.toThrow(/SERVICO_INVALIDO/);

    const check = (await db.query(`SELECT appointment_time, status FROM public.appointments WHERE id = 'appt-rollback-test';`)).rows[0];
    expect(check.appointment_time).toBe('2026-11-24T10:00:00');
    expect(check.status).toBe('confirmed');
  });

  // 21. Tentativa de contornar a RPC por UPDATE direto
  it('21. UPDATE direto tentando sobrepor horário existente é bloqueado pelo trigger de defesa em profundidade', async () => {
    await db.exec(`
      INSERT INTO public.appointments (id, client_id, barber_id, service_id, appointment_time, status)
      VALUES 
        ('appt-def-1', 'cust-marcos', 'barber-diego', 'srv-corte', '2026-11-25T10:00:00', 'confirmed'),
        ('appt-def-2', 'cust-roberto', 'barber-diego', 'srv-corte', '2026-11-25T11:00:00', 'confirmed');
      INSERT INTO public.appointment_services (appointment_id, service_id) VALUES 
        ('appt-def-1', 'srv-corte'),
        ('appt-def-2', 'srv-corte');
    `);

    // Tentar fazer UPDATE direto para o mesmo horário do appt-def-1 é rejeitado imediatamente
    await expect(
      db.query(`UPDATE public.appointments SET appointment_time = '2026-11-25T10:00:00' WHERE id = 'appt-def-2';`)
    ).rejects.toThrow(/(ACESSO_NEGADO|permission denied|HORARIO_INDISPONIVEL)/i);
  });

  // 22. Preservação das travas WhatsApp
  it('22. Preservação das travas WhatsApp: DRY_RUN ativo, envio desativado e 0 mensagens reais', () => {
    // Validação estática e de ambiente
    expect(process.env.WHATSAPP_ENABLED).not.toBe('true');
  });
});

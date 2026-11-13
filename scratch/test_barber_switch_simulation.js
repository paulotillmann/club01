import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

async function runBarberSwitchSimulation() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — SIMULAÇÃO DE TROCA DE PROFISSIONAL (TESTE ISOLADO) ===");
  console.log("=========================================================================\n");

  const db = new PGlite();
  const MIGRATIONS_DIR = path.resolve('backend-api/migrations');

  // 1. Roles e Schema
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

    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$ SELECT 'service_role'::text; $$ LANGUAGE sql;
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT '00000000-0000-0000-0000-000000000000'::uuid; $$ LANGUAGE sql;
    CREATE OR REPLACE FUNCTION public.current_user_role() RETURNS text AS $$ SELECT 'admin'::text; $$ LANGUAGE sql;
  `);

  // 2. Carregar Migrations Oficiais
  const files = [
    'supabase_club01_init.sql',
    '0019_supabase_security_and_rpc.sql',
    '0020_book_appointment_online.sql',
    '0021_fase5_security_and_concurrency_corrections.sql',
    '0022_notification_queue_and_triggers.sql',
    '0023_fix_whatsapp_logs_status_and_hardening.sql',
    '0024_manual_test_authorizations.sql'
  ];

  for (const f of files) {
    let sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
    sql = sql.replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- CREATE EXTENSION IF NOT EXISTS');
    await db.exec(sql);
  }

  // 3. Settings e Dados de Teste
  await db.exec(`
    INSERT INTO public.settings (key, value) VALUES
      ('shop_opening_hour', '8'),
      ('shop_closing_hour', '21'),
      ('cancellation_min_lead_time_minutes', '60')
    ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

    INSERT INTO public.barbers (id, name, phone) VALUES 
      ('barber-alpha', 'Barbeiro Alpha', '5534911111111'),
      ('barber-beta', 'Barbeiro Beta', '5534922222222');

    INSERT INTO public.services (id, name, duration_minutes, price, restricted_access) VALUES 
      ('srv-switch', 'Corte Troca', 30, 50.00, false);

    INSERT INTO public.barber_services (barber_id, service_id) VALUES 
      ('barber-alpha', 'srv-switch'),
      ('barber-beta', 'srv-switch');

    INSERT INTO public.customers (id, name, phone) VALUES 
      ('cust-switch', 'Cliente Troca', '5534988322462');
  `);

  // 4. Criar agendamento inicial com Barbeiro Alpha (Data futura segura)
  const apptTime = '2026-11-05T14:00:00';
  const bookRes = await db.query(`
    SELECT public.book_appointment_online(
      'Cliente Troca',
      '5534988322462',
      'barber-alpha',
      ARRAY['srv-switch']::text[],
      $1
    ) as result;
  `, [apptTime]);
  const apptId = bookRes.rows[0].result.appointment_id;
  console.log("1. Agendamento inicial criado com Barbeiro Alpha:", apptId);

  // Validar ocupação com Alpha
  const occ1 = await db.query(`
    SELECT * FROM public.get_occupied_slots()
    WHERE barber_id = 'barber-alpha' AND appointment_time = $1;
  `, [apptTime]);
  console.log("   Slot ocupado com Barbeiro Alpha:", occ1.rows.length === 1 ? "SIM (1 slot)" : "NÃO");

  // 5. Executar TROCA DE PROFISSIONAL para Barbeiro Beta
  console.log("\n2. Executando Troca de Profissional para Barbeiro Beta...");
  await db.query(`
    UPDATE public.appointments
    SET barber_id = 'barber-beta'
    WHERE id = $1;
  `, [apptId]);

  // Validar liberação com Alpha e ocupação com Beta
  const occAlpha = await db.query(`
    SELECT * FROM public.get_occupied_slots()
    WHERE barber_id = 'barber-alpha' AND appointment_time = $1;
  `, [apptTime]);
  const occBeta = await db.query(`
    SELECT * FROM public.get_occupied_slots()
    WHERE barber_id = 'barber-beta' AND appointment_time = $1;
  `, [apptTime]);

  console.log("3. Validação de liberação e reserva:");
  console.log("   - Horário liberado para Barbeiro Alpha:", occAlpha.rows.length === 0 ? "LIBERADO (0 slots)" : "OCUPADO");
  console.log("   - Horário reservado para Barbeiro Beta:", occBeta.rows.length === 1 ? "RESERVADO (1 slot)" : "LIVRE");

  // 6. Validar notificações geradas pelo trigger na troca de profissional
  console.log("\n4. Validação de Notificações geradas na troca:");
  const notifs = await db.query(`
    SELECT recipient_type, recipient_name, event_type, content
    FROM public.notification_queue
    WHERE appointment_id = $1 AND event_type = 'reschedule'
    ORDER BY recipient_type ASC;
  `, [apptId]);

  for (const n of notifs.rows) {
    console.log(`   - [${n.recipient_type}] para ${n.recipient_name}: "${n.content.split('\n')[0]}..."`);
  }

  const clientNotif = notifs.rows.find(n => n.recipient_type === 'client');
  const oldBarberNotif = notifs.rows.find(n => n.recipient_type === 'old_barber');
  const newBarberNotif = notifs.rows.find(n => n.recipient_type === 'new_barber');

  const success = (
    occAlpha.rows.length === 0 &&
    occBeta.rows.length === 1 &&
    clientNotif &&
    oldBarberNotif &&
    newBarberNotif &&
    oldBarberNotif.content.includes('transferido para outro profissional') &&
    newBarberNotif.content.includes('Você recebeu um novo agendamento')
  );

  console.log("\n5. RESULTADO DA SIMULAÇÃO DE TROCA DE BARBEIRO:", success ? "APROVADO COM SUCESSO" : "REPROVADO");
  await db.close();
}

runBarberSwitchSimulation().catch(console.error);

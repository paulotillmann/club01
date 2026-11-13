/* global process */
import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';

const BASE_DIR = process.cwd();
const MIGRATIONS_DIR = path.join(BASE_DIR, 'backend-api', 'migrations');

async function main() {
  console.log('=== TESTE DE ROLLBACK EM AMBIENTE ISOLADO (PGLITE) ===\n');
  const db = new PGlite();

  // 1. Setup Auth
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN; END IF;
    END $$;
    CREATE TABLE IF NOT EXISTS auth.users (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), email TEXT);
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$ SELECT NULL::uuid; $$ LANGUAGE sql STABLE;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS TEXT AS $$ SELECT 'anon'; $$ LANGUAGE sql STABLE;
  `);

  // 2. Setup baseline (0000 até 0021)
  let initSql = fs.readFileSync(path.join(MIGRATIONS_DIR, 'supabase_club01_init.sql'), 'utf-8').replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- EXT');
  await db.exec(initSql);
  let sql0019 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0019_supabase_security_and_rpc.sql'), 'utf-8').replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- EXT');
  await db.exec(sql0019);
  let sql0020 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0020_book_appointment_online.sql'), 'utf-8').replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- EXT');
  await db.exec(sql0020);
  let sql0021 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0021_fase5_security_and_concurrency_corrections.sql'), 'utf-8').replace(/CREATE EXTENSION IF NOT EXISTS/gi, '-- EXT');
  await db.exec(sql0021);

  // Snapshot de baseline
  const baselineTables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`)).rows.map(r => r.table_name);
  const baselineTriggers = (await db.query(`SELECT trigger_name FROM information_schema.triggers WHERE event_object_schema = 'public' ORDER BY trigger_name;`)).rows.map(r => r.trigger_name);
  console.log('✓ Baseline carregado:');
  console.log('  Tabelas (' + baselineTables.length + '):', baselineTables.join(', '));
  console.log('  Triggers (' + baselineTriggers.length + '):', baselineTriggers.join(', '));

  // 3. Aplicar Migration 0022
  console.log('\n--- Aplicando Migration 0022 ---');
  let sql0022 = fs.readFileSync(path.join(MIGRATIONS_DIR, '0022_notification_queue_and_triggers.sql'), 'utf-8');
  await db.exec(sql0022);

  const postMigTables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`)).rows.map(r => r.table_name);
  const postMigTriggers = (await db.query(`SELECT trigger_name FROM information_schema.triggers WHERE event_object_schema = 'public' ORDER BY trigger_name;`)).rows.map(r => r.trigger_name);
  if (!postMigTables.includes('notification_queue')) throw new Error('notification_queue não encontrada após 0022');
  if (!postMigTriggers.includes('trigger_appointment_notifications')) throw new Error('trigger_appointment_notifications não encontrado após 0022');
  console.log('✓ Migration 0022 aplicada com sucesso.');

  // 4. Executar Rollback
  console.log('\n--- Executando Rollback 0022 ---');
  let sqlRollback = fs.readFileSync(path.join(MIGRATIONS_DIR, '0022_notification_queue_rollback.sql'), 'utf-8');
  await db.exec(sqlRollback);

  const postRollbackTables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`)).rows.map(r => r.table_name);
  const postRollbackTriggers = (await db.query(`SELECT trigger_name FROM information_schema.triggers WHERE event_object_schema = 'public' ORDER BY trigger_name;`)).rows.map(r => r.trigger_name);

  // Comparação com baseline
  const tablesDiff = baselineTables.filter(t => !postRollbackTables.includes(t)).concat(postRollbackTables.filter(t => !baselineTables.includes(t)));
  const triggersDiff = baselineTriggers.filter(t => !postRollbackTriggers.includes(t)).concat(postRollbackTriggers.filter(t => !baselineTriggers.includes(t)));

  if (tablesDiff.length > 0) throw new Error('Divergência de tabelas após rollback: ' + tablesDiff.join(', '));
  if (triggersDiff.length > 0) throw new Error('Divergência de triggers após rollback: ' + triggersDiff.join(', '));
  console.log('✓ Rollback validado: o schema retornou EXATAMENTE ao baseline anterior.');

  // 5. Reaplicar Migration 0022 após rollback
  console.log('\n--- Reaplicando Migration 0022 após Rollback ---');
  await db.exec(sql0022);
  const reapplyTables = (await db.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;`)).rows.map(r => r.table_name);
  if (!reapplyTables.includes('notification_queue')) throw new Error('Reaplicação falhou');
  console.log('✓ Reaplicação pós-rollback concluída com 100% de sucesso.');

  await db.close();
  console.log('\n=== TESTE DE ROLLBACK APROVADO! ===');
}

main().catch(err => {
  console.error('FALHA NO TESTE DE ROLLBACK:', err);
  process.exit(1);
});

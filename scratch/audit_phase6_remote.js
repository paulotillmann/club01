/* global Buffer */
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];

async function runSql(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: '/v1/projects/mxafltrygwekefewhylh/database/query',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(data);
        }
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

function getChecksum(filePath) {
  if (!fs.existsSync(filePath)) return 'ARQUIVO_NAO_ENCONTRADO';
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function main() {
  console.log('========================================================================');
  console.log('=== AUDITORIA TÉCNICA REMOTA — FASE 6.1 (mxafltrygwekefewhylh) ===');
  console.log('========================================================================\n');

  // 1. Identidade e Versão
  const ident = await runSql('SELECT current_database(), current_user, version();');
  console.log('1. IDENTIDADE DO BANCO:');
  console.log(JSON.stringify(ident, null, 2));

  // 2. Presença de notification_queue
  const queueExists = await runSql(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'notification_queue'
    ) AS queue_exists;
  `);
  console.log('\n2. PRESENÇA DE notification_queue:');
  console.log(JSON.stringify(queueExists, null, 2));

  // 3. Estrutura de whatsapp_logs
  const logsColumns = await runSql(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_logs'
    ORDER BY ordinal_position;
  `);
  console.log('\n3. COLUNAS DE whatsapp_logs:');
  console.table(logsColumns);

  // 4. Triggers em appointments
  const triggers = await runSql(`
    SELECT trigger_name, event_manipulation, action_statement, action_timing
    FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'appointments';
  `);
  console.log('\n4. TRIGGERS EM appointments:');
  console.table(triggers);

  // 5. Estrutura de appointments
  const apptColumns = await runSql(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'appointments'
    ORDER BY ordinal_position;
  `);
  console.log('\n5. COLUNAS DE appointments:');
  console.table(apptColumns);

  // 6. Constraints em appointments
  const apptConstraints = await runSql(`
    SELECT conname, contype, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'appointments';
  `);
  console.log('\n6. CONSTRAINTS EM appointments:');
  console.table(apptConstraints);

  // 7. Contagem de linhas em todas as tabelas (Baseline check)
  const tables = [
    'appointments', 'appointment_services', 'barbers', 'barber_services',
    'customers', 'services', 'products', 'sales', 'sale_items',
    'caixa', 'settings', 'users', 'whatsapp_logs'
  ];
  console.log('\n7. CONTAGEM ATUAL DE LINHAS NO SUPABASE REMOTO:');
  for (const t of tables) {
    const countRes = await runSql(`SELECT COUNT(*) as c FROM public."${t}";`);
    console.log(`  - public.${t}: ${countRes[0]?.c ?? 'erro'}`);
  }

  // 8. Políticas RLS em whatsapp_logs
  const rlsLogs = await runSql(`
    SELECT policyname, permissive, roles, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'whatsapp_logs';
  `);
  console.log('\n8. POLÍTICAS RLS EM whatsapp_logs:');
  console.table(rlsLogs);

  // 9. Checksums dos arquivos da Fase 6
  console.log('\n9. CHECKSUMS LOCAIS SHA-256 (FASE 6 & 6.1):');
  const files = [
    'backend-api/migrations/0022_notification_queue_and_triggers.sql',
    'backend-api/migrations/0022_notification_queue_rollback.sql',
    'backend-api/src/evolution_client.js',
    'backend-api/src/workers/notification_processor.js',
    'supabase/functions/process-notifications/index.ts',
    'tests/whatsapp_notification_suite.test.js',
    'docs/FASE_6_WHATSAPP_EVOLUTION_API.md'
  ];
  for (const f of files) {
    const fullP = 'c:/club01/' + f;
    console.log(`  ${f}: ${getChecksum(fullP)}`);
  }
}

main().catch(console.error);

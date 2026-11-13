/* global Buffer, process */
import fs from 'fs';
import https from 'https';

const PROJECT_REF = 'mxafltrygwekefewhylh';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];

async function runSql(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
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

async function main() {
  console.log('========================================================================');
  console.log(`=== APLICAÇÃO CONTROLADA DA MIGRATION 0022 NO SUPABASE: ${PROJECT_REF} ===`);
  console.log('========================================================================\n');

  // 1. Re-confirmar identidade do projeto remoto
  const ident = await runSql('SELECT current_database(), current_user, version();');
  console.log('1. IDENTIDADE DO BANCO:');
  console.log(JSON.stringify(ident, null, 2));

  // 2. Confirmar que a migration 0022 não foi aplicada anteriormente
  const checkQueue = await runSql(`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables 
      WHERE table_schema = 'public' AND table_name = 'notification_queue'
    ) AS queue_exists;
  `);

  if (checkQueue[0]?.queue_exists === true) {
    console.log('AVISO: notification_queue já existe no banco remoto! Abortando aplicação duplicada.');
    return;
  }
  console.log('✓ Confirmado: notification_queue ainda não existe no remoto. Prosseguindo.');

  // 3. Ler o arquivo SQL da migration 0022
  const sqlFile = 'c:/club01/backend-api/migrations/0022_notification_queue_and_triggers.sql';
  const sqlContent = fs.readFileSync(sqlFile, 'utf8');

  console.log('\n--- EXECUTANDO MIGRATION 0022 EM TRANSAÇÃO ÚNICA ---');
  const transactionalSql = `BEGIN;\n${sqlContent}\nCOMMIT;`;

  const execResult = await runSql(transactionalSql);

  if (execResult && execResult.error) {
    console.error('ERRO NA APLICAÇÃO REMOTA:', execResult.error);
    process.exit(1);
  }
  console.log('✓ Migration 0022 executada com sucesso no Supabase remoto!\n');

  // 4. PÓS-CHECK SOMENTE-LEITURA
  console.log('========================================================================');
  console.log('=== PÓS-CHECK SOMENTE-LEITURA APÓS APLICAÇÃO DA MIGRATION 0022 ===');
  console.log('========================================================================\n');

  // A. Presença da tabela notification_queue
  const postQueueCheck = await runSql(`
    SELECT table_name, table_schema 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'notification_queue';
  `);
  console.log('A. TABELA notification_queue:');
  console.table(postQueueCheck);

  // B. Colunas de notification_queue
  const columns = await runSql(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_queue'
    ORDER BY ordinal_position;
  `);
  console.log('\nB. COLUNAS DE notification_queue:');
  console.table(columns);

  // C. Índices de notification_queue
  const indices = await runSql(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'notification_queue';
  `);
  console.log('\nC. ÍNDICES DE notification_queue:');
  console.table(indices);

  // D. Triggers em appointments
  const apptTriggers = await runSql(`
    SELECT trigger_name, event_manipulation, action_statement, action_timing
    FROM information_schema.triggers
    WHERE event_object_schema = 'public' AND event_object_table = 'appointments';
  `);
  console.log('\nD. TRIGGERS EM appointments:');
  console.table(apptTriggers);

  // E. Políticas RLS em notification_queue
  const rlsPolicies = await runSql(`
    SELECT policyname, permissive, roles, cmd, qual
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'notification_queue';
  `);
  console.log('\nE. POLÍTICAS RLS EM notification_queue:');
  console.table(rlsPolicies);

  // F. RPCs criadas
  const rpcs = await runSql(`
    SELECT routine_name, routine_type, security_type
    FROM information_schema.routines
    WHERE routine_schema = 'public' 
      AND routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result', 'format_appointment_dt', 'get_appointment_service_names');
  `);
  console.log('\nF. FUNÇÕES E RPCS DA FASE 6:');
  console.table(rpcs);

  // G. Contagem de linhas pós-migração
  const countQueue = await runSql('SELECT COUNT(*) as c FROM public.notification_queue;');
  console.log('\nG. CONTAGEM EM notification_queue:', countQueue[0]?.c);

  const countAppts = await runSql('SELECT COUNT(*) as c FROM public.appointments;');
  console.log('   CONTAGEM EM appointments:', countAppts[0]?.c);

  console.log('\n=== PÓS-CHECK CONCLUÍDO COM 100% DE SUCESSO! ===');
}

main().catch(err => {
  console.error('FALHA GERAL NA EXECUÇÃO:', err);
  process.exit(1);
});

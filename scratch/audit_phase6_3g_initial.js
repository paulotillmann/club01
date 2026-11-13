/* global Buffer, process */
import https from 'https';
import fs from 'fs';

const PROJECT_REF = 'mxafltrygwekefewhylh';
const LOGS_FILE = 'C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl';

function getAccessToken() {
  const content = fs.readFileSync(LOGS_FILE, 'utf8');
  const lines = content.split('\n');
  const match = lines[294].match(/sbp_[a-zA-Z0-9]+/);
  return match ? match[0] : null;
}

function apiRequest(path, method = 'GET', data = null) {
  const token = getAccessToken();
  return new Promise((resolve, reject) => {
    const postData = data ? JSON.stringify(data) : null;
    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };
    if (postData) {
      options.headers['Content-Length'] = Buffer.byteLength(postData);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: body ? JSON.parse(body) : null });
        } catch {
          resolve({ status: res.statusCode, raw: body });
        }
      });
    });

    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function runSql(query) {
  const res = await apiRequest(`/v1/projects/${PROJECT_REF}/database/query`, 'POST', { query });
  return res.data;
}

async function main() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-G: AUDITORIA INICIAL DO AMBIENTE SUPABASE DEV ===");
  console.log(`=== Projeto Alvo: ${PROJECT_REF} ===\n`);

  // 1. Confirmar projeto
  const projRes = await apiRequest(`/v1/projects/${PROJECT_REF}`);
  console.log("1. PROJETO CONECTADO:", {
    id: projRes.data?.id,
    name: projRes.data?.name,
    status: projRes.data?.status,
    region: projRes.data?.region
  });

  // 2. Edge Function process-notifications
  console.log("\n2. EDGE FUNCTION process-notifications:");
  const fnsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  const procFn = Array.isArray(fnsRes.data) ? fnsRes.data.find(f => f.slug === 'process-notifications') : null;
  console.log("Status da função:", procFn ? {
    id: procFn.id,
    slug: procFn.slug,
    version: procFn.version,
    status: procFn.status,
    verify_jwt: procFn.verify_jwt,
    created_at: procFn.created_at,
    updated_at: procFn.updated_at
  } : "NÃO ENCONTRADA");

  // 3. Secrets do projeto
  console.log("\n3. SECRETS DO PROJETO:");
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  if (Array.isArray(secretsRes.data)) {
    const secretsMap = {};
    for (const s of secretsRes.data) {
      // Mascarar valores sensíveis
      if (['WHATSAPP_DRY_RUN', 'WHATSAPP_ENABLED', 'EVOLUTION_INSTANCE_NAME'].includes(s.name)) {
        secretsMap[s.name] = s.value;
      } else {
        secretsMap[s.name] = s.value ? `[CONFIGURADO, len=${s.value.length}]` : '[VAZIO]';
      }
    }
    console.log("Secrets auditados:", secretsMap);
  } else {
    console.log("Resposta Secrets:", secretsRes.data);
  }

  // 4. Extensões instaladas
  console.log("\n4. EXTENSÕES POSTGRESQL:");
  const exts = await runSql(`
    SELECT extname, extversion, extnamespace::regnamespace::text as schema
    FROM pg_extension 
    WHERE extname IN ('pg_cron', 'pg_net');
  `);
  console.log("Extensões:", exts);

  // 5. Jobs em cron.job
  console.log("\n5. JOBS EM cron.job:");
  const jobs = await runSql(`
    SELECT jobid, jobname, schedule, active, command
    FROM cron.job;
  `);
  console.log("Jobs agendados:", jobs);

  // 6. Estrutura da notification_queue
  console.log("\n6. ESTRUTURA E CONSTRAINTS DE notification_queue:");
  const queueCols = await runSql(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notification_queue'
    ORDER BY ordinal_position;
  `);
  console.log("Colunas notification_queue:", queueCols);

  const queueConstraints = await runSql(`
    SELECT conname, contype, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'notification_queue';
  `);
  console.log("Constraints notification_queue:", queueConstraints);

  const queueIndexes = await runSql(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'notification_queue';
  `);
  console.log("Índices notification_queue:", queueIndexes);

  // 7. Estrutura de whatsapp_logs
  console.log("\n7. ESTRUTURA DE whatsapp_logs:");
  const logCols = await runSql(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_logs'
    ORDER BY ordinal_position;
  `);
  console.log("Colunas whatsapp_logs:", logCols);

  // 8. RPCs críticas
  console.log("\n8. DEFINIÇÃO DAS RPCS CRÍTICAS:");
  const rpcs = await runSql(`
    SELECT routine_name, routine_type
    FROM information_schema.routines 
    WHERE routine_schema = 'public' 
    AND routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result', 'consume_manual_test_authorization');
  `);
  console.log("RPCs encontradas:", rpcs);

  // Obter DDL das RPCs
  const rpcDefs = await runSql(`
    SELECT p.proname, pg_get_functiondef(p.oid) as definition
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
    AND p.proname IN ('dequeue_notifications_for_processing', 'record_notification_result', 'consume_manual_test_authorization');
  `);
  for (const r of rpcDefs) {
    console.log(`\n--- RPC ${r.proname} ---`);
    console.log(r.definition);
  }

  // 9. Estado das tabelas
  console.log("\n9. CONTAGEM POR STATUS:");
  const qCount = await runSql(`SELECT status, count(*) FROM public.notification_queue GROUP BY status;`);
  console.log("notification_queue:", qCount);
  const lCount = await runSql(`SELECT status, count(*) FROM public.whatsapp_logs GROUP BY status;`);
  console.log("whatsapp_logs:", lCount);
  const aCount = await runSql(`SELECT status, count(*) FROM public.manual_test_authorizations GROUP BY status;`);
  console.log("manual_test_authorizations:", aCount);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

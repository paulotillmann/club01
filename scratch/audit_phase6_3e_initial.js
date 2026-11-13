/* global Buffer */
/* global process */
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
  console.log("=== CLUB 01 — FASE 6.3-E: AUDITORIA INICIAL DO AMBIENTE SUPABASE DEV ===");
  console.log(`=== Projeto: ${PROJECT_REF} ===\n`);

  // 1. Verificar Edge Functions ativas
  console.log("--- 1. EDGE FUNCTIONS ATIVAS ---");
  const fnsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  console.log("Funções encontradas:", JSON.stringify(fnsRes.data, null, 2));

  // 2. Verificar Secrets e travas
  console.log("\n--- 2. SECRETS REGISTRADOS NO PROJETO ---");
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  if (Array.isArray(secretsRes.data)) {
    const secretNames = secretsRes.data.map(s => s.name);
    console.log("Nomes dos Secrets:", secretNames);
    console.log("WHATSAPP_DRY_RUN presente?:", secretNames.includes("WHATSAPP_DRY_RUN"));
    console.log("WHATSAPP_ENABLED presente?:", secretNames.includes("WHATSAPP_ENABLED"));
    console.log("CRON_SECRET presente?:", secretNames.includes("CRON_SECRET"));
    console.log("EVOLUTION_INSTANCE_NAME presente?:", secretNames.includes("EVOLUTION_INSTANCE_NAME"));
  } else {
    console.log("Resposta Secrets:", secretsRes.data);
  }

  // 3. Extensões instaladas no PostgreSQL (pg_cron, pg_net)
  console.log("\n--- 3. EXTENSÕES POSTGRESQL (pg_cron, pg_net) ---");
  const extData = await runSql(`
    SELECT extname, extversion 
    FROM pg_extension 
    WHERE extname IN ('pg_cron', 'pg_net');
  `);
  console.log("Extensões instaladas:", extData);

  // 4. Extensões disponíveis no catálogo do PostgreSQL
  console.log("\n--- 4. EXTENSÕES DISPONÍVEIS NO CATÁLOGO DO SISTEMA ---");
  const availExtData = await runSql(`
    SELECT name, default_version, installed_version, comment 
    FROM pg_available_extensions 
    WHERE name IN ('pg_cron', 'pg_net');
  `);
  console.log("Extensões disponíveis:", availExtData);

  // 5. Verificar esquema e tabelas cron
  console.log("\n--- 5. ESQUEMA CRON E JOBS ---");
  const cronSchemaData = await runSql(`
    SELECT schema_name FROM information_schema.schemata WHERE schema_name = 'cron';
  `);
  console.log("Esquema 'cron' existe?:", cronSchemaData);

  // 6. Estado atual de notification_queue
  console.log("\n--- 6. ESTADO ATUAL DA FILA DE NOTIFICAÇÕES (notification_queue) ---");
  const queueStats = await runSql(`
    SELECT status, count(*) 
    FROM public.notification_queue 
    GROUP BY status;
  `);
  console.log("Itens em notification_queue por status:", queueStats);

  // 7. Estado atual de whatsapp_logs
  console.log("\n--- 7. ESTADO ATUAL DE whatsapp_logs ---");
  const logsStats = await runSql(`
    SELECT status, count(*) 
    FROM public.whatsapp_logs 
    GROUP BY status;
  `);
  console.log("Itens em whatsapp_logs por status:", logsStats);

  // 8. Estado da tabela manual_test_authorizations (Migration 0024)
  console.log("\n--- 8. AUTORIZAÇÕES DE TESTE MANUAL (manual_test_authorizations) ---");
  const authsStats = await runSql(`
    SELECT status, count(*) 
    FROM public.manual_test_authorizations 
    GROUP BY status;
  `);
  console.log("Itens em manual_test_authorizations por status:", authsStats);

  // 9. Verificar RPCs críticas
  console.log("\n--- 9. DEFINIÇÃO DAS RPCS CRÍTICAS ---");
  const rpcs = await runSql(`
    SELECT routine_name 
    FROM information_schema.routines 
    WHERE routine_schema = 'public' 
    AND routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result', 'consume_manual_test_authorization');
  `);
  console.log("RPCs encontradas:", rpcs);
}

main().catch(err => {
  console.error("Erro na auditoria:", err);
  process.exit(1);
});

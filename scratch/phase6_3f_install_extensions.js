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
  console.log("=== CLUB 01 — FASE 6.3-F: AUDITORIA INICIAL E INSTALAÇÃO DE EXTENSÕES ===");
  console.log(`=== Ambiente: Supabase DEV (${PROJECT_REF}) ===\n`);

  // 1. Verificar Edge Functions
  console.log("--- 1. VERIFICAÇÃO DA EDGE FUNCTION ---");
  const fnsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  console.log("Funções ativas:", JSON.stringify(fnsRes.data, null, 2));

  // 2. Verificar Secrets e Travas Globais
  console.log("\n--- 2. VERIFICAÇÃO DOS SECRETS ---");
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  const names = Array.isArray(secretsRes.data) ? secretsRes.data.map(s => s.name) : [];
  console.log("Secrets cadastrados:", names);
  console.log("WHATSAPP_DRY_RUN presente?:", names.includes("WHATSAPP_DRY_RUN"));
  console.log("WHATSAPP_ENABLED presente?:", names.includes("WHATSAPP_ENABLED"));
  console.log("CRON_SECRET presente?:", names.includes("CRON_SECRET"));

  // 3. Verificar estado das extensões antes da instalação
  console.log("\n--- 3. EXTENSÕES ANTES DA INSTALAÇÃO ---");
  const extPre = await runSql(`SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');`);
  console.log("Extensões instaladas:", extPre);

  // 4. Instalar extensões pg_net e pg_cron (autorizadas expressamente na Fase 6.3-F)
  console.log("\n--- 4. INSTALAÇÃO DAS EXTENSÕES pg_net E pg_cron ---");
  try {
    const installNet = await runSql(`CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;`);
    console.log("pg_net instalação resultado:", installNet);
  } catch (err) {
    console.error("Erro instalando pg_net:", err);
  }

  try {
    const installCron = await runSql(`CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;`);
    console.log("pg_cron instalação resultado:", installCron);
  } catch (err) {
    console.error("Erro instalando pg_cron:", err);
  }

  // 5. Verificar estado pós-instalação
  console.log("\n--- 5. EXTENSÕES PÓS-INSTALAÇÃO ---");
  const extPost = await runSql(`SELECT extname, extversion, extnamespace::regnamespace::text as schema FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');`);
  console.log("Extensões ativas no banco:", extPost);

  // 6. Consultar jobs existentes em cron.job
  console.log("\n--- 6. VERIFICAÇÃO DE JOBS EXISTENTES ---");
  try {
    const jobs = await runSql(`SELECT jobid, schedule, command, nodename, nodeport, database, username, active, jobname FROM cron.job;`);
    console.log("Jobs existentes em cron.job:", jobs);
  } catch (err) {
    console.log("Erro consultando cron.job:", err.message);
  }

  // 7. Verificar notification_queue
  console.log("\n--- 7. FILA DE NOTIFICAÇÕES ---");
  const queueStats = await runSql(`SELECT status, count(*) FROM public.notification_queue GROUP BY status;`);
  console.log("Itens em notification_queue:", queueStats);
}

main().catch(err => {
  console.error("Erro na execução:", err);
  process.exit(1);
});

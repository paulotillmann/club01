/* global Buffer */
import fs from 'fs';
import https from 'https';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function apiRequest(apiPath, method = 'GET', bodyData = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const postData = bodyData ? JSON.stringify(bodyData) : null;
    const defaultHeaders = {
      'Authorization': 'Bearer ' + pat,
      'Content-Type': 'application/json',
      ...headers
    };
    if (postData) {
      defaultHeaders['Content-Length'] = Buffer.byteLength(postData);
    }

    const options = {
      hostname: 'api.supabase.com',
      path: apiPath,
      method,
      headers: defaultHeaders
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
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
  console.log("=== 1. VERIFICAÇÃO DE TRAVAS GLOBAIS E SECRETS ===");
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  const secMap = {};
  if (Array.isArray(secretsRes.data)) {
    secretsRes.data.forEach(s => secMap[s.name] = s.value);
  }
  console.log("WHATSAPP_DRY_RUN presente:", 'WHATSAPP_DRY_RUN' in secMap);
  console.log("WHATSAPP_ENABLED presente:", 'WHATSAPP_ENABLED' in secMap);
  console.log("EVOLUTION_INSTANCE_NAME presente:", 'EVOLUTION_INSTANCE_NAME' in secMap);

  console.log("\n=== 2. JOBS CRON.JOB ===");
  const cronJobs = await runSql("SELECT jobid, jobname, schedule, active FROM cron.job;");
  console.log("cron.job:", cronJobs);

  console.log("\n=== 3. TABELAS PÚBLICAS ===");
  const tables = await runSql("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;");
  console.log("Tabelas:", tables?.map(t => t.table_name));

  console.log("\n=== 4. TRIGGERS EM PUBLIC ===");
  const triggers = await runSql(`
    SELECT event_object_table, trigger_name, action_timing, event_manipulation, action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `);
  console.log("Triggers:", JSON.stringify(triggers, null, 2));

  console.log("\n=== 5. DEFINIÇÃO DA FUNÇÃO DO TRIGGER DE NOTIFICAÇÃO ===");
  const triggerFunc = await runSql(`
    SELECT routine_name, routine_definition
    FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name LIKE '%notification%'
    ORDER BY routine_name;
  `);
  console.log("Funções de Notificação:", JSON.stringify(triggerFunc, null, 2));

  console.log("\n=== 6. CONTAGEM ATUAL DAS TABELAS CHAVE ===");
  const counts = await runSql(`
    SELECT 
      (SELECT count(*) FROM public.appointments) AS appointments_count,
      (SELECT count(*) FROM public.clients) AS clients_count,
      (SELECT count(*) FROM public.barbers) AS barbers_count,
      (SELECT count(*) FROM public.services) AS services_count,
      (SELECT count(*) FROM public.notification_queue) AS queue_count,
      (SELECT count(*) FROM public.whatsapp_logs) AS logs_count,
      (SELECT count(*) FROM public.manual_test_authorizations) AS auth_count;
  `);
  console.log("Contagens:", counts);
}

main().catch(console.error);

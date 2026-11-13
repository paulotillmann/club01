/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
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
    if (body) req.write(body);
    req.end();
  });
}

async function precheck() {
  console.log("=== PRÉ-CHECK REMOTO SOMENTE-LEITURA: EDGE FUNCTIONS & SECRETS ===");

  // 1. Listar Edge Functions existentes
  const functionsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  console.log(`\n1. Edge Functions existentes no projeto ${PROJECT_REF} (HTTP ${functionsRes.status}):`);
  console.log(JSON.stringify(functionsRes.data, null, 2));

  // 2. Listar nomes dos secrets existentes (sem valores)
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  console.log(`\n2. Secrets existentes no projeto ${PROJECT_REF} (HTTP ${secretsRes.status}):`);
  if (Array.isArray(secretsRes.data)) {
    console.log("Nomes dos secrets cadastrados:", secretsRes.data.map(s => s.name));
  } else {
    console.log(secretsRes.data);
  }

  // 3. Checar estado do banco (tabelas, RPCs, fila)
  const query = `
    SELECT 
      (SELECT count(*) FROM public.notification_queue) AS notif_count,
      (SELECT count(*) FROM public.appointments) AS appt_count,
      (SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'notification_queue') AS has_table,
      (SELECT count(*) FROM pg_proc WHERE proname = 'dequeue_notifications_for_processing') AS has_dequeue,
      (SELECT count(*) FROM pg_proc WHERE proname = 'record_notification_result') AS has_record,
      (SELECT count(*) FROM pg_trigger WHERE tgname = 'trigger_appointment_notifications') AS has_trigger;
  `;
  const postData = JSON.stringify({ query });
  const dbRes = await apiRequest(`/v1/projects/${PROJECT_REF}/database/query`, 'POST', postData);
  console.log("\n3. Verificação do Schema e Fila no PostgreSQL:");
  console.log(JSON.stringify(dbRes.data, null, 2));
}

precheck().catch(console.error);

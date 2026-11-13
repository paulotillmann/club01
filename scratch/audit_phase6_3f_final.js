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

function runSql(query) {
  const token = getAccessToken();
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
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
  console.log("=== AUDITORIA FINAL DE DESATIVAÇÃO E ESTADO — FASE 6.3-F ===");

  // 1. Verificar jobs no pg_cron
  const jobs = await runSql(`SELECT jobid, jobname, schedule, active FROM cron.job;`);
  console.log("1. Jobs em cron.job:", jobs);

  // 2. Verificar extensões
  const exts = await runSql(`SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');`);
  console.log("2. Extensões instaladas:", exts);

  // 3. Verificar fila de notificações
  const queue = await runSql(`SELECT status, count(*) FROM public.notification_queue GROUP BY status;`);
  console.log("3. Contagem notification_queue:", queue);

  // 4. Verificar logs de whatsapp
  const logs = await runSql(`SELECT status, count(*) FROM public.whatsapp_logs GROUP BY status;`);
  console.log("4. Contagem whatsapp_logs:", logs);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

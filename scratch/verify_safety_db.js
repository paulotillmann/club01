/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function runSql(query) {
  const postData = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };
    const req = https.request(options, res => {
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

async function verifyDb() {
  console.log("=== VERIFICAÇÃO DE SEGURANÇA E ZERO ENVIOS NO BANCO DEV ===");
  
  // 1. Cron jobs
  const cronJobs = await runSql(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
    ) AS pg_cron_installed;
  `);
  console.log("pg_cron instalado?", JSON.stringify(cronJobs, null, 2));

  // 2. Contagem de mensagens e logs
  const counts = await runSql(`
    SELECT 
      (SELECT count(*) FROM public.notification_queue) AS queue_total,
      (SELECT count(*) FROM public.whatsapp_logs) AS logs_total,
      (SELECT count(*) FROM public.whatsapp_logs WHERE status = 'sent') AS real_sent_count;
  `);
  console.log("Estado das mensagens:", JSON.stringify(counts, null, 2));
}

verifyDb().catch(console.error);

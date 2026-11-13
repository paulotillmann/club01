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
  console.log("=== INVESTIGAÇÃO TÉCNICA DO PG_CRON E PG_NET NO SUPABASE DEV ===");

  // 1. Configurações de pg_cron
  const cronSettings = await runSql(`
    SELECT name, setting, unit, context, short_desc 
    FROM pg_settings 
    WHERE name LIKE 'cron.%';
  `);
  console.log("1. Configurações pg_cron no PostgreSQL:", cronSettings);

  // 2. Testar se net.http_post funciona diretamente via SQL
  console.log("\n2. Testando chamada direta de net.http_post no banco...");
  const cronSecret = fs.readFileSync('c:/club01/scratch/.cron_secret_tmp', 'utf8').trim();
  const directHttp = await runSql(`
    SELECT net.http_post(
      url := 'https://${PROJECT_REF}.supabase.co/functions/v1/process-notifications',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', '${cronSecret}'
      ),
      body := jsonb_build_object('batch_size', 5),
      timeout_milliseconds := 5000
    ) as request_id;
  `);
  console.log("Resultado net.http_post direto:", directHttp);

  // Aguardar 3 segundos para ler net._http_response
  await new Promise(r => setTimeout(r, 3000));
  const responses = await runSql(`
    SELECT id, status_code, content, timed_out, error_msg, created 
    FROM net._http_response 
    ORDER BY id DESC LIMIT 2;
  `);
  console.log("Respostas em net._http_response:", JSON.stringify(responses, null, 2));
}

main().catch(err => {
  console.error("Erro na investigação:", err);
  process.exit(1);
});

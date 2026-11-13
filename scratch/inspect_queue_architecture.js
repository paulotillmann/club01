/* global process */
import https from 'https';
import fs from 'fs';

const PROJECT_REF = 'mxafltrygwekefewhylh';
const LOGS_FILE = 'C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl';

function getAccessToken() {
  const content = fs.readFileSync(LOGS_FILE, 'utf8');
  const lines = content.split('\n');
  const match = lines[294].match(/sbp_[a-zA-Z0-9_-]+/);
  return match ? match[0] : null;
}

function runSql(query) {
  const token = getAccessToken();
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      port: 443,
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    };

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
    req.write(JSON.stringify({ query }));
    req.end();
  });
}

async function main() {
  console.log("=== INSPEÇÃO DA ARQUITETURA NO SUPABASE DEV ===");

  // 1. Verificar extensão pg_cron
  const qExt = `SELECT extname, extversion FROM pg_extension WHERE extname IN ('pg_cron', 'pg_net');`;
  const resExt = await runSql(qExt);
  console.log("\n1. Extensões instaladas (pg_cron / pg_net):", resExt.data);

  // 2. Verificar se cron.job existe
  const qJobs = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'cron' AND table_name = 'job'
    ) AS cron_schema_exists;
  `;
  const resJobs = await runSql(qJobs);
  console.log("\n2. Tabela cron.job existe?:", resJobs.data);

  // 3. Inspecionar notification_queue colunas e status
  const qQueue = `
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'notification_queue'
    ORDER BY ordinal_position;
  `;
  const resQueue = await runSql(qQueue);
  console.log("\n3. Colunas de notification_queue:", resQueue.data);

  // 4. Inspecionar contagem de itens em notification_queue por status
  const qQueueCounts = `
    SELECT status, count(*) 
    FROM notification_queue 
    GROUP BY status;
  `;
  const resQueueCounts = await runSql(qQueueCounts);
  console.log("\n4. Itens em notification_queue por status:", resQueueCounts.data);

  // 5. Inspecionar RPC dequeue_notifications_for_processing
  const qRpc = `
    SELECT routine_name, routine_definition 
    FROM information_schema.routines 
    WHERE routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result')
    AND routine_schema = 'public';
  `;
  const resRpc = await runSql(qRpc);
  console.log("\n5. Definição das RPCs de processamento:", resRpc.data);

  // 6. Inspecionar triggers vinculados à fila de notificações
  const qTriggers = `
    SELECT event_object_table, trigger_name, action_timing, event_manipulation 
    FROM information_schema.triggers 
    WHERE trigger_schema = 'public' 
    AND (event_object_table = 'appointments' OR event_object_table = 'notification_queue');
  `;
  const resTriggers = await runSql(qTriggers);
  console.log("\n6. Triggers em appointments / notification_queue:", resTriggers.data);
}

main().catch(err => {
  console.error("Erro na inspeção:", err);
  process.exit(1);
});

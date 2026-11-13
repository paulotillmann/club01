/* global Buffer */
/* global process */
import https from 'https';
import fs from 'fs';

const PROJECT_REF = 'mxafltrygwekefewhylh';
const cronSecret = fs.readFileSync('c:/club01/scratch/.cron_secret_tmp', 'utf8').trim();

function invokeWithHeaders(headers = {}) {
  return new Promise((resolve) => {
    const postData = JSON.stringify({ batch_size: 1 });
    const req = https.request({
      hostname: `${PROJECT_REF}.supabase.co`,
      path: '/functions/v1/process-notifications',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
      }
    }, res => {
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
    req.on('error', err => resolve({ status: 500, error: err.message }));
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log("=== TESTE DE AUTENTICAÇÃO CRON NA V6 REMOTA (DEV) ===");

  // 1. Sem credencial
  console.log("1. Invocação sem autenticação:");
  const resNoAuth = await invokeWithHeaders({});
  console.log("   Status:", resNoAuth.status, "| Resposta:", JSON.stringify(resNoAuth.data));

  // 2. Com segredo incorreto
  console.log("2. Invocação com x-cron-secret inválido:");
  const resBadAuth = await invokeWithHeaders({ 'x-cron-secret': 'segredo_invalido_123' });
  console.log("   Status:", resBadAuth.status, "| Resposta:", JSON.stringify(resBadAuth.data));

  // 3. Com x-cron-secret válido
  console.log("3. Invocação com x-cron-secret válido:");
  const resValidCron = await invokeWithHeaders({ 'x-cron-secret': cronSecret });
  console.log("   Status:", resValidCron.status, "| Resposta:", JSON.stringify(resValidCron.data));
}

main().catch(err => {
  console.error("Erro no teste:", err);
  process.exit(1);
});

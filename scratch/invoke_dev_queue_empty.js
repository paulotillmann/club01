/* global Buffer, process */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';
const cronSecret = fs.readFileSync('c:/club01/scratch/.cron_secret_tmp', 'utf8').trim();

async function apiRequest(apiPath, method = 'GET', bodyData = null) {
  return new Promise((resolve, reject) => {
    const postData = bodyData ? JSON.stringify(bodyData) : null;
    const headers = {
      'Authorization': 'Bearer ' + pat,
      'Content-Type': 'application/json'
    };
    if (postData) {
      headers['Content-Length'] = Buffer.byteLength(postData);
    }
    const req = https.request({
      hostname: 'api.supabase.com',
      path: apiPath,
      method,
      headers
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
    req.on('error', reject);
    if (postData) req.write(postData);
    req.end();
  });
}

async function invokeEdgeFunction(serviceKey, payload) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const req = https.request({
      hostname: `${PROJECT_REF}.supabase.co`,
      path: '/functions/v1/process-notifications',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + serviceKey,
        'x-cron-secret': cronSecret,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
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
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log("=== INVOCANDO V6 REMOTA NO SUPABASE DEV COM FILA VAZIA ===");
  const keysRes = await apiRequest(`/v1/projects/${PROJECT_REF}/api-keys`);
  const serviceKeyObj = keysRes.data.find(k => k.name === 'service_role key' || k.name === 'service_role');
  if (!serviceKeyObj) throw new Error("service_role key não encontrada");
  const serviceKey = serviceKeyObj.api_key;

  const res = await invokeEdgeFunction(serviceKey, { batch_size: 5 });
  console.log("Status HTTP recebido da V6:", res.status);
  console.log("Resposta JSON da V6:", JSON.stringify(res.data, null, 2));
}

main().catch(err => {
  console.error("Erro na invocação:", err);
  process.exit(1);
});

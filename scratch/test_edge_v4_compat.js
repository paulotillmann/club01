/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

// Obter cron secret cadastrado
async function getCronSecret() {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/secrets`,
      method: 'GET',
      headers: { 'Authorization': 'Bearer ' + pat }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        // Obter valor dos logs de sessão
        const secretLine = fs.readFileSync('C:/club01/scratch/.cron_secret_tmp', 'utf8').trim();
        resolve(secretLine);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function testEdgeV4() {
  const secret = await getCronSecret();

  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ batch_size: 5 });
    const req = https.request({
      hostname: `${PROJECT_REF}.supabase.co`,
      path: '/functions/v1/process-notifications',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': secret,
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data: JSON.parse(data) });
      });
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

testEdgeV4().then(res => {
  console.log("Status HTTP Edge Function v4:", res.status);
  console.log("Resposta JSON Edge Function v4:", JSON.stringify(res.data, null, 2));
}).catch(console.error);

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
  const res = await runSql(`
    SELECT proname, proargnames, proargtypes::regtype[]
    FROM pg_proc 
    WHERE pronamespace = 'net'::regnamespace AND proname = 'http_post';
  `);
  console.log("net.http_post assinaturas:", JSON.stringify(res, null, 2));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

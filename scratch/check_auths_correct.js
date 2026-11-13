/* global Buffer */
import fs from 'fs';
import https from 'https';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

function runSql(query) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${pat}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      }
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve(body);
        }
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

async function checkAuths() {
  const auths = await runSql(`
    SELECT id, authorization_code, target_recipient, status, consumed_at, created_at
    FROM public.manual_test_authorizations
    ORDER BY created_at DESC;
  `);
  console.log('Autorizações existentes:', JSON.stringify(auths, null, 2));
}

checkAuths().catch(console.error);

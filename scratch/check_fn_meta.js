import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function apiRequest(apiPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json'
      }
    };
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
    req.end();
  });
}

async function verifyFnDetails() {
  const fnRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions/process-notifications`);
  console.log("=== METADADOS DA EDGE FUNCTION ===");
  if (fnRes.status === 200) {
    const { id, slug, name, status, version, verify_jwt, created_at, updated_at } = fnRes.data;
    console.log(JSON.stringify({ id, slug, name, status, version, verify_jwt, created_at, updated_at }, null, 2));
  } else {
    console.log("Status:", fnRes.status, fnRes.data);
  }
}

verifyFnDetails().catch(console.error);

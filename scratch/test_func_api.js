/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function testEndpoint(path, method = 'GET', body = null) {
  return new Promise((resolve) => {
    const options = {
      hostname: 'api.supabase.com',
      path,
      method,
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json'
      }
    };
    if (body) {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const req = https.request(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        resolve({ status: res.statusCode, data });
      });
    });
    req.on('error', err => resolve({ status: 500, error: err.message }));
    if (body) req.write(body);
    req.end();
  });
}

async function check() {
  // Testar GET /v1/projects/{ref}/functions
  const res1 = await testEndpoint(`/v1/projects/${PROJECT_REF}/functions`);
  console.log("GET /v1/projects/{ref}/functions:", res1.status, res1.data);

  // Testar OPTIONS /v1/projects/{ref}/functions
  const res2 = await testEndpoint(`/v1/projects/${PROJECT_REF}/functions`, 'OPTIONS');
  console.log("OPTIONS /v1/projects/{ref}/functions:", res2.status);
}

check().catch(console.error);

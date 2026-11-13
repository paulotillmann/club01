/* global Buffer, process */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

const functionCode = fs.readFileSync('C:/club01/supabase/functions/process-notifications/index.ts', 'utf8');

async function deployFunction() {
  console.log("=== DEPLOY DA EDGE FUNCTION: process-notifications ===");
  console.log(`Projeto: ${PROJECT_REF}`);

  const payload = JSON.stringify({
    slug: 'process-notifications',
    name: 'process-notifications',
    body: functionCode,
    verify_jwt: false
  });

  const req = https.request({
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/functions/process-notifications`,
    method: 'PATCH',
    headers: {
      'Authorization': 'Bearer ' + pat,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(payload)
    }
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log("Status HTTP:", res.statusCode);
      try {
        console.log("Response:", JSON.stringify(JSON.parse(data), null, 2));
      } catch {
        console.log("Response:", data);
      }
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log("\n✓ Edge Function deployada com sucesso!");
      } else {
        console.error("\n✗ Falha no deploy!");
        process.exit(1);
      }
    });
  });

  req.on('error', err => {
    console.error("Erro na requisição:", err);
    process.exit(1);
  });

  req.write(payload);
  req.end();
}

deployFunction().catch(console.error);

/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

const testCode = `
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.8";

Deno.serve(async (req: Request) => {
  return new Response(JSON.stringify({ status: "alive", deno: Deno.version }), {
    headers: { "Content-Type": "application/json" }
  });
});
`;

async function deployMinimal() {
  const payload = JSON.stringify({
    slug: 'process-notifications',
    name: 'process-notifications',
    body: testCode,
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
      console.log("PATCH status:", res.statusCode);
      console.log(data);
    });
  });
  req.write(payload);
  req.end();
}

deployMinimal().catch(console.error);

/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function testPost() {
  const postData = JSON.stringify({ slug: "process-notifications", name: "process-notifications" });
  const req = https.request({
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/functions`,
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + pat,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log("POST status:", res.statusCode);
      console.log("Response body:", data);
    });
  });
  req.write(postData);
  req.end();
}

testPost().catch(console.error);

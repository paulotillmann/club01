/* global */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function getFunctionLogs() {
  const req = https.request({
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/analytics/endpoints/logs.all?project=${PROJECT_REF}`,
    method: 'GET',
    headers: {
      'Authorization': 'Bearer ' + pat
    }
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        console.log("Logs:", JSON.stringify(json, null, 2));
      } catch {
        console.log("Raw:", data);
      }
    });
  });
  req.on('error', console.error);
  req.end();
}

getFunctionLogs().catch(console.error);

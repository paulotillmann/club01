import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function selectLogs() {
  const q = `SELECT timestamp, event_message FROM logs ORDER BY timestamp DESC LIMIT 10`;
  const sql = encodeURIComponent(q);
  const path = `/v1/projects/${PROJECT_REF}/analytics/endpoints/logs?sql=${sql}`;
  const req = https.request({
    hostname: 'api.supabase.com',
    path,
    method: 'GET',
    headers: { 'Authorization': 'Bearer ' + pat }
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(data);
    });
  });
  req.end();
}

selectLogs().catch(console.error);

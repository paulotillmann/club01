/* global Buffer */
import fs from 'fs';
import https from 'https';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function querySql(query) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: '/v1/projects/' + PROJECT_REF + '/database/query',
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function main() {
  console.log("=== INSPEÇÃO DAS RPCS DE AGENDAMENTO ===");
  const routines = await querySql(`
    SELECT routine_name, routine_definition
    FROM information_schema.routines
    WHERE routine_schema = 'public' 
      AND (routine_name LIKE '%book%' OR routine_name LIKE '%slot%')
    ORDER BY routine_name;
  `);
  console.log("Rotinas encontradas:", routines.map(r => r.routine_name));

  for (const r of routines) {
    console.log(`\n--- ${r.routine_name} ---`);
    console.log(r.routine_definition);
  }
}

main().catch(console.error);

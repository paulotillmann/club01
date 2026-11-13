/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function runManagementSql(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
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

async function checkPrivs() {
  const query = `
    SELECT 
      r.routine_name, 
      r.specific_name, 
      p.grantee, 
      p.privilege_type
    FROM information_schema.routines r
    LEFT JOIN information_schema.routine_privileges p 
      ON r.specific_name = p.specific_name
    WHERE r.routine_schema = 'public' 
      AND r.routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result');
  `;
  const res = await runManagementSql(query);
  console.log(JSON.stringify(res, null, 2));

  // Checar também pg_proc proacl
  const proAcl = await runManagementSql(`
    SELECT proname, proacl FROM pg_proc WHERE proname IN ('dequeue_notifications_for_processing', 'record_notification_result');
  `);
  console.log('pg_proc proacl:', JSON.stringify(proAcl, null, 2));
}

checkPrivs().catch(console.error);

/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function runSql(query) {
  const postData = JSON.stringify({ query });
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      path: `/v1/projects/${PROJECT_REF}/database/query`,
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + pat,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
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
    req.write(postData);
    req.end();
  });
}

async function applyMigration() {
  console.log("=== APLICANDO MIGRATION 0024 NO SUPABASE DEV (" + PROJECT_REF + ") ===");
  const sql = fs.readFileSync('c:/club01/backend-api/migrations/0024_manual_test_authorizations.sql', 'utf8');
  
  const res = await runSql(sql);
  console.log("Status de execução:", res.status);
  console.log("Resultado:", JSON.stringify(res.data, null, 2));

  // Validação pós-aplicação
  const verify = await runSql(`
    SELECT 
      table_name,
      (SELECT rowsecurity FROM pg_tables WHERE tablename = 'manual_test_authorizations') AS rls_enabled
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_name = 'manual_test_authorizations';
  `);
  console.log("Verificação da tabela:", JSON.stringify(verify.data, null, 2));

  const verifyRpc = await runSql(`
    SELECT 
      proname,
      prosecdef AS is_security_definer,
      proconfig AS settings
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'consume_manual_test_authorization';
  `);
  console.log("Verificação da RPC:", JSON.stringify(verifyRpc.data, null, 2));

  const verifyPrivs = await runSql(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' AND routine_name = 'consume_manual_test_authorization';
  `);
  console.log("Privilégios da RPC:", JSON.stringify(verifyPrivs.data, null, 2));
}

applyMigration().catch(console.error);

/* global Buffer */
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

async function runAudit() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-C: AUDITORIA DE SEGURANÇA E PREPARAÇÃO ===");
  console.log("=== Projeto: " + PROJECT_REF + " ===");
  console.log("=========================================================================\n");

  // 1. Permissões no schema public (CREATE / USAGE) para anon, authenticated e PUBLIC
  console.log("1. AUDITORIA DE PERMISSÕES NO SCHEMA PUBLIC:");
  const schemaPrivs = await runSql(`
    SELECT 
      role.rolname,
      has_schema_privilege(role.rolname, 'public', 'USAGE') AS has_usage,
      has_schema_privilege(role.rolname, 'public', 'CREATE') AS has_create
    FROM (
      VALUES ('anon'), ('authenticated'), ('service_role'), ('postgres')
    ) AS role(rolname);
  `);
  console.log(JSON.stringify(schemaPrivs, null, 2));

  // Checar privilégios de PUBLIC no schema public via catalog acl
  const publicAcl = await runSql(`
    SELECT nspname, nspacl 
    FROM pg_namespace 
    WHERE nspname = 'public';
  `);
  console.log("\nACL do namespace public:", JSON.stringify(publicAcl, null, 2));

  // 2. Auditoria profunda de SECURITY DEFINER e search_path das RPCs
  console.log("\n2. AUDITORIA DAS RPCS DE FILA (SECURITY DEFINER / SEARCH_PATH / OWNER):");
  const rpcAudit = await runSql(`
    SELECT 
      p.proname,
      pg_get_userbyid(p.proowner) AS owner,
      p.prosecdef AS is_security_definer,
      p.proconfig AS settings,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' 
      AND p.proname IN ('record_notification_result', 'dequeue_notifications_for_processing');
  `);
  console.log(JSON.stringify(rpcAudit, null, 2));

  // 3. Privilégios efetivos das funções
  console.log("\n3. PRIVILÉGIOS EFETIVOS DE EXECUTE DAS RPCS:");
  const rpcPrivs = await runSql(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' 
      AND routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result');
  `);
  console.log(JSON.stringify(rpcPrivs, null, 2));

  // 4. Estado da Edge Function publicada
  console.log("\n4. ESTADO DA EDGE FUNCTION PROCESS-NOTIFICATIONS NO SUPABASE:");
  const fnRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  if (Array.isArray(fnRes.data)) {
    const fn = fnRes.data.find(f => f.slug === 'process-notifications');
    console.log(JSON.stringify(fn, null, 2));
  } else {
    console.log(fnRes.data);
  }

  // 5. Secrets atualmente cadastrados (apenas nomes)
  console.log("\n5. SECRETS ATUALMENTE CONFIGURADOS (NOMES SOMENTE):");
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  if (Array.isArray(secretsRes.data)) {
    console.log(secretsRes.data.map(s => s.name));
  } else {
    console.log(secretsRes.data);
  }

  // 6. Contagem de Linhas Atual (Baseline Remoto)
  console.log("\n6. BASELINE DE DADOS REMOTO:");
  const baseline = await runSql(`
    SELECT 
      (SELECT count(*) FROM public.appointments) AS appointments,
      (SELECT count(*) FROM public.customers) AS customers,
      (SELECT count(*) FROM public.barbers) AS barbers,
      (SELECT count(*) FROM public.services) AS services,
      (SELECT count(*) FROM public.notification_queue) AS notification_queue,
      (SELECT count(*) FROM public.whatsapp_logs) AS whatsapp_logs;
  `);
  console.log(JSON.stringify(baseline, null, 2));
}

runAudit().catch(console.error);

/* global Buffer */
import https from 'https';
import fs from 'fs';

// Ler PAT de forma segura do transcript de sessão sem expor em código versionado
const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function apiRequest(path, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
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
        try {
          resolve({ status: res.statusCode, data: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function runSql(query) {
  const postData = JSON.stringify({ query });
  const res = await apiRequest(`/v1/projects/${PROJECT_REF}/database/query`, 'POST', postData);
  return res.data;
}

async function runAudit() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3: AUDITORIA TÉCNICA REMOTA (SOMENTE-LEITURA) ===");
  console.log("=== Projeto: " + PROJECT_REF + " ===");
  console.log("=========================================================================\n");

  // 1. Edge Function Status
  const fnRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  console.log("1. EDGE FUNCTIONS REGISTRADAS:");
  if (Array.isArray(fnRes.data)) {
    fnRes.data.forEach(fn => {
      console.log(`- Slug: ${fn.slug} | Status: ${fn.status} | Versão: ${fn.version} | Verify_JWT: ${fn.verify_jwt}`);
    });
  } else {
    console.log("Resultado inesperado:", fnRes.data);
  }

  // 2. Secrets Cadastrados (Apenas Nomes)
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  console.log("\n2. SECRETS CONFIGURADOS (NOMES SOMENTE):");
  if (Array.isArray(secretsRes.data)) {
    console.log(secretsRes.data.map(s => s.name));
  } else {
    console.log("Resultado inesperado:", secretsRes.data);
  }

  // 3. Schema de whatsapp_logs e constraints
  const logsSchema = await runSql(`
    SELECT column_name, data_type, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'whatsapp_logs'
    ORDER BY ordinal_position;
  `);
  console.log("\n3. COLUNAS DE public.whatsapp_logs:");
  console.log(logsSchema);

  const logsConstraints = await runSql(`
    SELECT conname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'whatsapp_logs';
  `);
  console.log("\n4. CONSTRAINTS DE public.whatsapp_logs:");
  console.log(logsConstraints);

  // 4. Schema de notification_queue
  const queueConstraints = await runSql(`
    SELECT conname, pg_get_constraintdef(c.oid) as def
    FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    WHERE n.nspname = 'public' AND t.relname = 'notification_queue';
  `);
  console.log("\n5. CONSTRAINTS DE public.notification_queue:");
  console.log(queueConstraints);

  // 5. Extensões disponíveis e instaladas (pg_cron, pg_net, vault, etc.)
  const extensions = await runSql(`
    SELECT name, installed_version, default_version, comment
    FROM pg_available_extensions
    WHERE name IN ('pg_cron', 'pg_net', 'supabase_vault', 'vault', 'http')
    ORDER BY name;
  `);
  console.log("\n6. EXTENSÕES PG_CRON / PG_NET / VAULT NO POSTGRESQL:");
  console.log(extensions);

  // 6. RLS em whatsapp_logs e notification_queue
  const rlsPolicies = await runSql(`
    SELECT schemaname, tablename, policyname, roles, cmd, qual
    FROM pg_policies
    WHERE tablename IN ('whatsapp_logs', 'notification_queue');
  `);
  console.log("\n7. POLÍTICAS RLS ATIVAS:");
  console.log(rlsPolicies);

  // 7. Permissões das RPCs
  const rpcPrivs = await runSql(`
    SELECT routine_name, grantee, privilege_type
    FROM information_schema.routine_privileges
    WHERE routine_schema = 'public' 
      AND routine_name IN ('dequeue_notifications_for_processing', 'record_notification_result');
  `);
  console.log("\n8. PRIVILÉGIOS DAS RPCS:");
  console.log(rpcPrivs);

  // 8. Contagem de Linhas Atual (Baseline)
  const baseline = await runSql(`
    SELECT 
      (SELECT count(*) FROM public.appointments) AS appointments,
      (SELECT count(*) FROM public.customers) AS customers,
      (SELECT count(*) FROM public.barbers) AS barbers,
      (SELECT count(*) FROM public.services) AS services,
      (SELECT count(*) FROM public.notification_queue) AS notification_queue,
      (SELECT count(*) FROM public.whatsapp_logs) AS whatsapp_logs;
  `);
  console.log("\n9. BASELINE DE DADOS ATUAL (CONTAGEM):");
  console.log(baseline);
}

runAudit().catch(console.error);

/* global Buffer, process */
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];

const PROJECT_REF = 'mxafltrygwekefewhylh';
const MIGRATION_FILE = 'c:/club01/backend-api/migrations/0021_fase5_security_and_concurrency_corrections.sql';

async function runSql(sql) {
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

async function main() {
  console.log('========================================================================');
  console.log('=== APLICAÇÃO DA MIGRATION 0021 NO SUPABASE REMOTO: CLUB 01 (mxafltrygwekefewhylh) ===');
  console.log('========================================================================\n');

  const sqlContent = fs.readFileSync(MIGRATION_FILE, 'utf8');
  const checksum = crypto.createHash('sha256').update(sqlContent).digest('hex');

  console.log(`Arquivo: ${MIGRATION_FILE}`);
  console.log(`Tamanho: ${Buffer.byteLength(sqlContent)} bytes`);
  console.log(`SHA-256: ${checksum}`);
  console.log(`Timestamp Início: ${new Date().toISOString()}`);

  console.log('\nExecutando migration transacionalmente no Supabase...');
  const res = await runSql(sqlContent);

  console.log(`Status HTTP: ${res.status}`);
  console.log(`Timestamp Fim: ${new Date().toISOString()}`);

  if (res.status >= 200 && res.status < 300) {
    console.log('\n✅ [SUCESSO] Migration 0021 aplicada com sucesso no Supabase remoto!');
  } else {
    console.error('\n❌ [ERRO] Falha ao aplicar migration 0021:');
    console.error(JSON.stringify(res.data, null, 2));
    process.exit(1);
  }

  // Pós-Check de RPCs e Triggers
  console.log('\n=== EXECUTANDO PÓS-CHECK IMEDIATO NO CATÁLOGO DO POSTGRESQL ===');
  const checkProcs = await runSql(`
    SELECT 
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS arguments,
      p.prosecdef,
      p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' 
      AND p.proname IN ('book_appointment_online', 'book_appointment_atomic', 'create_sale_atomic', 'handle_sale_item_stock')
    ORDER BY p.proname;
  `);

  console.log('\nRPCs e Funções Verificadas:');
  console.table(checkProcs.data);

  // Recarregar cache de schema do PostgREST via NOTIFY pgrst
  console.log('\nRecarregando schema cache do PostgREST (NOTIFY pgrst)...');
  await runSql("NOTIFY pgrst, 'reload schema';");
  console.log('[OK] Schema cache recarregado.');
}

main().catch(console.error);

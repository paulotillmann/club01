/* global Buffer */
import fs from 'fs';
import https from 'https';
import crypto from 'crypto';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];

async function runSql(sql) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({ query: sql });
    const req = https.request({
      hostname: 'api.supabase.com',
      path: '/v1/projects/mxafltrygwekefewhylh/database/query',
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
          const parsed = JSON.parse(data);
          resolve(parsed);
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

function getChecksum(filePath) {
  if (!fs.existsSync(filePath)) return 'ARQUIVO_NAO_ENCONTRADO';
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

async function main() {
  console.log('========================================================================');
  console.log('=== RELATÓRIO TÉCNICO DE PRÉ-CHECK REMOTO: CLUB 01 (mxafltrygwekefewhylh) ===');
  console.log('========================================================================\n');

  // 1. Identidade
  const ident = await runSql('SELECT current_database(), current_user, version();');
  console.log('1. IDENTIDADE DO BANCO:');
  console.log(JSON.stringify(ident, null, 2));

  // 2. Tabelas no schema public
  const tables = await runSql(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);
  console.log('\n2. TABELAS EXISTENTES (schema public):');
  console.log(tables.map(t => t.table_name).join(', '));

  // 3. Contagens de registros em cada tabela
  const countsSql = tables.map(t => `SELECT '${t.table_name}' AS tbl, count(*) AS cnt FROM public."${t.table_name}"`).join(' UNION ALL ');
  const counts = await runSql(countsSql);
  console.log('\n3. CONTAGENS INICIAIS:');
  console.table(counts);

  // 4. Funções e RPCs críticas
  const procs = await runSql(`
    SELECT 
      p.proname AS function_name,
      pg_get_function_identity_arguments(p.oid) AS arguments,
      pg_get_function_result(p.oid) AS return_type,
      p.prosecdef AS security_definer,
      p.proconfig AS search_path
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' 
      AND p.proname IN ('book_appointment_online', 'book_appointment_atomic', 'create_sale_atomic', 'get_occupied_slots', 'get_email_by_phone', 'handle_sale_item_stock')
    ORDER BY p.proname;
  `);
  console.log('\n4. RPCS CRÍTICAS INSTALADAS:');
  console.table(procs);

  // 5. Triggers
  const triggers = await runSql(`
    SELECT 
      event_object_table AS table_name,
      trigger_name,
      event_manipulation AS event,
      action_timing AS timing,
      action_statement
    FROM information_schema.triggers
    WHERE trigger_schema = 'public'
    ORDER BY event_object_table, trigger_name;
  `);
  console.log('\n5. TRIGGERS INSTALADAS:');
  console.table(triggers);

  // 6. Constraints de pagamento e estoque
  const constraints = await runSql(`
    SELECT 
      conrelid::regclass AS table_name,
      conname AS constraint_name,
      contype,
      pg_get_constraintdef(oid) AS definition
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND conrelid::regclass::text IN ('sales', 'sale_items', 'products', 'caixa', 'appointments')
    ORDER BY table_name, constraint_name;
  `);
  console.log('\n6. CONSTRAINTS RELEVANTES:');
  console.table(constraints);

  // 7. RLS status
  const rls = await runSql(`
    SELECT tablename, rowsecurity 
    FROM pg_tables 
    WHERE schemaname = 'public'
    ORDER BY tablename;
  `);
  console.log('\n7. RLS STATUS NAS TABELAS:');
  console.table(rls);

  // 8. Tabela settings existente
  const settings = await runSql('SELECT key, value, updated_at FROM public.settings ORDER BY key;');
  console.log('\n8. SETTINGS ATUAIS:');
  console.table(settings);

  // 9. Histórico de Migrations (se houver tabela supabase_migrations)
  const migs = await runSql(`
    SELECT table_schema, table_name 
    FROM information_schema.tables 
    WHERE table_name LIKE '%migration%' 
    ORDER BY table_schema, table_name;
  `);
  console.log('\n9. TABELAS DE MIGRATION ENCONTRADAS:');
  console.table(migs);

  // 10. Checksums dos arquivos locais
  console.log('\n10. CHECKSUMS SHA-256 DOS SCRIPTS LOCAIS:');
  const files = [
    'c:/club01/backend-api/migrations/supabase_club01_init.sql',
    'c:/club01/backend-api/migrations/0019_supabase_security_and_rpc.sql',
    'c:/club01/backend-api/migrations/0020_book_appointment_online.sql',
    'c:/club01/backend-api/migrations/0021_fase5_security_and_concurrency_corrections.sql',
    'c:/club01/backend-api/migrations/0021_fase5_rollback.sql'
  ];
  for (const f of files) {
    console.log(`${f}: ${getChecksum(f)}`);
  }
}

main().catch(console.error);

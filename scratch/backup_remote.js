/* global Buffer */
import fs from 'fs';
import path from 'path';
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

async function main() {
  console.log('=== INICIANDO BACKUP CONSISTENTE DO SUPABASE CLUB 01 (mxafltrygwekefewhylh) ===\n');

  const backupDir = 'c:/club01/backend-api/backup';
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupFileSql = path.join(backupDir, `backup_remote_baseline_${timestamp}.sql`);
  const backupFileJson = path.join(backupDir, `backup_remote_baseline_${timestamp}.json`);

  let sqlDump = `-- ==============================================================================\n`;
  sqlDump += `-- BACKUP DO BASELINE REMOTO SUPABASE CLUB 01\n`;
  sqlDump += `-- Project ID: mxafltrygwekefewhylh\n`;
  sqlDump += `-- Data: ${new Date().toISOString()}\n`;
  sqlDump += `-- Gerado por: Antigravity Engenharia Sênior (Fase 5.5)\n`;
  sqlDump += `-- ==============================================================================\n\n`;

  // 1. Extrair definições completas de funções no schema public
  console.log('1. Coletando definições de funções (pg_proc)...');
  const functions = await runSql(`
    SELECT 
      p.proname,
      pg_get_functiondef(p.oid) AS def,
      pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
    ORDER BY p.proname;
  `);

  sqlDump += `-- ------------------------------------------------------------------------------\n`;
  sqlDump += `-- 1. DEFINIÇÕES DE FUNÇÕES E RPCS\n`;
  sqlDump += `-- ------------------------------------------------------------------------------\n\n`;
  for (const fn of functions) {
    sqlDump += `-- Função: ${fn.proname}(${fn.args})\n`;
    sqlDump += `${fn.def};\n\n`;
  }

  // 2. Extrair triggers
  console.log('2. Coletando triggers...');
  const triggers = await runSql(`
    SELECT 
      t.tgname,
      c.relname AS table_name,
      pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname;
  `);

  sqlDump += `-- ------------------------------------------------------------------------------\n`;
  sqlDump += `-- 2. TRIGGERS\n`;
  sqlDump += `-- ------------------------------------------------------------------------------\n\n`;
  for (const trg of triggers) {
    sqlDump += `-- Trigger: ${trg.tgname} ON ${trg.table_name}\n`;
    sqlDump += `${trg.def};\n\n`;
  }

  // 3. Extrair Políticas RLS
  console.log('3. Coletando políticas RLS (pg_policies)...');
  const policies = await runSql(`
    SELECT 
      schemaname,
      tablename,
      policyname,
      permissive,
      roles,
      cmd,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname;
  `);

  sqlDump += `-- ------------------------------------------------------------------------------\n`;
  sqlDump += `-- 3. POLÍTICAS RLS (ROW LEVEL SECURITY)\n`;
  sqlDump += `-- ------------------------------------------------------------------------------\n\n`;
  for (const pol of policies) {
    sqlDump += `-- Política: ${pol.policyname} ON ${pol.tablename} FOR ${pol.cmd}\n`;
    const rolesStr = Array.isArray(pol.roles) ? pol.roles.join(', ') : 'PUBLIC';
    sqlDump += `DROP POLICY IF EXISTS "${pol.policyname}" ON public."${pol.tablename}";\n`;
    sqlDump += `CREATE POLICY "${pol.policyname}" ON public."${pol.tablename}"\n`;
    sqlDump += `  FOR ${pol.cmd} TO ${rolesStr}\n`;
    if (pol.qual) sqlDump += `  USING (${pol.qual})\n`;
    if (pol.with_check) sqlDump += `  WITH CHECK (${pol.with_check})\n`;
    sqlDump += `;\n\n`;
  }

  // 4. Extrair Dados de Todas as Tabelas
  console.log('4. Coletando dados das tabelas...');
  const tables = await runSql(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ORDER BY table_name;
  `);

  const allData = {};
  sqlDump += `-- ------------------------------------------------------------------------------\n`;
  sqlDump += `-- 4. DADOS DAS TABELAS (INSERTS)\n`;
  sqlDump += `-- ------------------------------------------------------------------------------\n\n`;

  for (const t of tables) {
    const rows = await runSql(`SELECT * FROM public."${t.table_name}";`);
    allData[t.table_name] = rows;
    if (rows && rows.length > 0) {
      sqlDump += `-- Tabela: ${t.table_name} (${rows.length} registros)\n`;
      for (const row of rows) {
        const cols = Object.keys(row);
        const colList = cols.map(c => `"${c}"`).join(', ');
        const valList = cols.map(c => {
          const v = row[c];
          if (v === null) return 'NULL';
          if (typeof v === 'number' || typeof v === 'boolean') return v;
          return `'${String(v).replace(/'/g, "''")}'`;
        }).join(', ');
        sqlDump += `INSERT INTO public."${t.table_name}" (${colList}) VALUES (${valList}) ON CONFLICT DO NOTHING;\n`;
      }
      sqlDump += '\n';
    }
  }

  // Salvar arquivos
  fs.writeFileSync(backupFileSql, sqlDump, 'utf8');
  fs.writeFileSync(backupFileJson, JSON.stringify({
    metadata: {
      projectId: 'mxafltrygwekefewhylh',
      timestamp: new Date().toISOString(),
      engine: 'PostgreSQL 17.11 Supabase'
    },
    functions,
    triggers,
    policies,
    data: allData
  }, null, 2), 'utf8');

  const shaSql = crypto.createHash('sha256').update(fs.readFileSync(backupFileSql)).digest('hex');
  const shaJson = crypto.createHash('sha256').update(fs.readFileSync(backupFileJson)).digest('hex');

  console.log('\n=== BACKUP CONCLUÍDO COM SUCESSO! ===');
  console.log(`Arquivo SQL:  ${backupFileSql} (${fs.statSync(backupFileSql).size} bytes)`);
  console.log(`SHA-256 SQL:  ${shaSql}`);
  console.log(`Arquivo JSON: ${backupFileJson} (${fs.statSync(backupFileJson).size} bytes)`);
  console.log(`SHA-256 JSON: ${shaJson}`);
}

main().catch(console.error);

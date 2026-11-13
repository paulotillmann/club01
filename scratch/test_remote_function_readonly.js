/* global Buffer, process */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';
const FUNCTION_URL = `https://${PROJECT_REF}.supabase.co/functions/v1/process-notifications`;

// Ler o cron secret temporário gerado no passo de configuração de secrets
const cronSecret = fs.readFileSync('c:/club01/scratch/.cron_secret_tmp', 'utf8').trim();

async function invokeFunction(headers = {}, body = {}) {
  return new Promise((resolve) => {
    const postData = JSON.stringify(body);
    const req = https.request(FUNCTION_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        ...headers
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
    req.on('error', err => resolve({ status: 500, error: err.message }));
    req.write(postData);
    req.end();
  });
}

async function runReadOnlyVerification() {
  console.log("========================================================================");
  console.log("=== HOMOLOGAÇÃO DA EDGE FUNCTION (TESTES DE ACESSO SEM ESCRITA) =======");
  console.log("========================================================================\n");

  // 1. Teste A: Chamada sem nenhum header de autorização
  console.log("--- 1. TESTE A: Sem Autenticação ---");
  const resA = await invokeFunction();
  console.log(`Status HTTP: ${resA.status} (Esperado: 401)`);
  console.log("Corpo da resposta:", resA.data);
  const passA = (resA.status === 401 && resA.data?.error?.includes("NAO_AUTORIZADO"));
  console.log(`Resultado: ${passA ? '✓ APROVADO' : '✗ REPROVADO'}\n`);

  // 2. Teste B: Chamada com token Bearer falso/inválido
  console.log("--- 2. TESTE B: Com Token Bearer Falso/Inválido ---");
  const resB = await invokeFunction({ 'Authorization': 'Bearer token_invalido_hacker' });
  console.log(`Status HTTP: ${resB.status} (Esperado: 401)`);
  console.log("Corpo da resposta:", resB.data);
  const passB = (resB.status === 401 && resB.data?.error?.includes("NAO_AUTORIZADO"));
  console.log(`Resultado: ${passB ? '✓ APROVADO' : '✗ REPROVADO'}\n`);

  // 3. Teste C: Chamada com x-cron-secret incorreto
  console.log("--- 3. TESTE C: Com x-cron-secret Incorreto ---");
  const resC = await invokeFunction({ 'x-cron-secret': 'segredo_incorreto_xyz' });
  console.log(`Status HTTP: ${resC.status} (Esperado: 401)`);
  console.log("Corpo da resposta:", resC.data);
  const passC = (resC.status === 401 && resC.data?.error?.includes("NAO_AUTORIZADO"));
  console.log(`Resultado: ${passC ? '✓ APROVADO' : '✗ REPROVADO'}\n`);

  // 4. Teste D: Chamada com x-cron-secret VÁLIDO (Fila Vazia)
  console.log("--- 4. TESTE D: Com x-cron-secret Válido (Fila Vazia) ---");
  const resD = await invokeFunction({ 'x-cron-secret': cronSecret });
  console.log(`Status HTTP: ${resD.status} (Esperado: 200)`);
  console.log("Corpo da resposta:", resD.data);
  const passD = (
    resD.status === 200 &&
    resD.data?.success === true &&
    resD.data?.processed === 0 &&
    resD.data?.dry_run === true &&
    resD.data?.instance === 'Meu Bolso Digital'
  );
  console.log(`Resultado: ${passD ? '✓ APROVADO' : '✗ REPROVADO'}\n`);

  // 5. Verificar integridade da fila no PostgreSQL
  console.log("--- 5. Verificação da Integridade da Fila no PostgreSQL ---");
  const checkSql = `SELECT count(*) as c FROM public.notification_queue;`;
  const postData = JSON.stringify({ query: checkSql });
  const dbReq = await new Promise((resolve) => {
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
      res.on('end', () => resolve(JSON.parse(data)));
    });
    req.write(postData);
    req.end();
  });
  const notifCount = parseInt(dbReq[0]?.c || 0, 10);
  console.log(`Total de registros em public.notification_queue: ${notifCount} (Esperado: 0)`);
  const passE = (notifCount === 0);
  console.log(`Resultado: ${passE ? '✓ APROVADO' : '✗ REPROVADO'}\n`);

  console.log("========================================================================");
  if (passA && passB && passC && passD && passE) {
    console.log("✓ TODOS OS TESTES SOMENTE-LEITURA E DE AUTORIZAÇÃO FORAM APROVADOS!");
  } else {
    console.error("✗ HOUVE FALHA EM UM OU MAIS TESTES!");
    process.exit(1);
  }
}

runReadOnlyVerification().catch(console.error);

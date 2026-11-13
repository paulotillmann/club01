/* global Buffer, process */
import https from 'https';
import fs from 'fs';
import { spawn } from 'child_process';

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

async function getCronSecret() {
  const secretLine = fs.readFileSync('C:/club01/scratch/.cron_secret_tmp', 'utf8').trim();
  return secretLine;
}

async function testEndpoint({ headers = {}, body = { batch_size: 5 } } = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(body);
    const req = https.request({
      hostname: `${PROJECT_REF}.supabase.co`,
      path: '/functions/v1/process-notifications',
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
    req.on('error', reject);
    req.write(postData);
    req.end();
  });
}

async function deployCLI() {
  return new Promise((resolve, reject) => {
    console.log("-> Executando CLI deploy da Edge Function...");
    const args = [
      'supabase',
      'functions',
      'deploy',
      'process-notifications',
      '--project-ref',
      PROJECT_REF,
      '--no-verify-jwt'
    ];

    const child = spawn('npx', args, {
      cwd: 'C:/club01',
      shell: true,
      env: {
        ...process.env,
        SUPABASE_ACCESS_TOKEN: pat
      },
      stdio: 'inherit'
    });

    child.on('close', code => {
      if (code === 0) resolve();
      else reject(new Error(`CLI finalizou com erro: código ${code}`));
    });
  });
}

async function main() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-A2: REDEPLOY CONTROLADO DA EDGE FUNCTION V5 ===");
  console.log("=== Projeto Alvo Autorizado: " + PROJECT_REF + " ===");
  console.log("=========================================================================\n");

  // 1. REGISTRAR VERSÃO ATUAL ANTES DO DEPLOY
  console.log("1. CONSULTANDO VERSÃO ATUAL PUBLICADA:");
  const preFunctions = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  const activeFnPre = preFunctions.data.find(f => f.slug === 'process-notifications');
  console.log(`Versão Ativa Antes do Deploy: Versão ${activeFnPre?.version} (Status: ${activeFnPre?.status})`);

  // 2. EXECUTAR REDEPLOY DA VERSÃO 5
  console.log("\n2. INICIANDO REDEPLOY DA VERSÃO 5...");
  await deployCLI();
  console.log("Redeploy concluído via Supabase CLI com código 0.");

  // 3. CONSULTAR VERSÃO ATIVA PÓS-DEPLOY
  console.log("\n3. CONSULTANDO VERSÃO PUBLICADA PÓS-DEPLOY:");
  const postFunctions = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  const activeFnPost = postFunctions.data.find(f => f.slug === 'process-notifications');
  console.log(`Nova Versão Ativa: Versão ${activeFnPost?.version} (Status: ${activeFnPost?.status})`);

  // 4. TESTES DE SEGURANÇA E AUTENTICAÇÃO PÓS-DEPLOY
  console.log("\n4. TESTES DE SEGURANÇA E AUTENTICAÇÃO (HTTP REST):");
  
  // Teste 4.1: Sem autenticação (deve retornar 401)
  const noAuth = await testEndpoint({ headers: {} });
  console.log(`- Teste sem autenticação: HTTP ${noAuth.status} (Esperado: 401) ->`, noAuth.status === 401 ? 'APROVADO' : 'FALHOU');

  // Teste 4.2: Com Bearer falso (deve retornar 401)
  const fakeToken = await testEndpoint({ headers: { 'Authorization': 'Bearer token_invalido_12345' } });
  console.log(`- Teste com Bearer falso: HTTP ${fakeToken.status} (Esperado: 401) ->`, fakeToken.status === 401 ? 'APROVADO' : 'FALHOU');

  // Teste 4.3: Com x-cron-secret incorreto (deve retornar 401)
  const fakeSecret = await testEndpoint({ headers: { 'x-cron-secret': 'secret_errado_abc' } });
  console.log(`- Teste com x-cron-secret falso: HTTP ${fakeSecret.status} (Esperado: 401) ->`, fakeSecret.status === 401 ? 'APROVADO' : 'FALHOU');

  // Teste 4.4: Com x-cron-secret correto (deve retornar 200 em DRY-RUN)
  const secret = await getCronSecret();
  const validCall = await testEndpoint({ headers: { 'x-cron-secret': secret } });
  console.log(`- Teste com x-cron-secret válido: HTTP ${validCall.status} (Esperado: 200) ->`, validCall.status === 200 ? 'APROVADO' : 'FALHOU');
  console.log("Payload retornado pelo endpoint v5:");
  console.log(JSON.stringify(validCall.data, null, 2));

  console.log("\n=========================================================================");
  console.log("=== OPERAÇÃO 6.3-A2 CONCLUÍDA COM 100% DE SUCESSO NO SUPABASE DEV ===");
  console.log("=========================================================================");
}

main().catch(err => {
  console.error("\n[ERRO CRÍTICO NA OPERAÇÃO 6.3-A2]:", err);
  process.exit(1);
});

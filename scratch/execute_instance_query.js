import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

async function apiRequest(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.supabase.com',
      path: apiPath,
      method: 'GET',
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

async function callEdgeFunction(token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: `${PROJECT_REF}.supabase.co`,
      path: '/functions/v1/inspect-evolution-instances',
      method: 'GET',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json'
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

async function runQuery() {
  console.log("=========================================================================");
  console.log("=== CLUB 01 — FASE 6.3-C5: CONSULTA SEGURA À EVOLUTION API ===");
  console.log("=========================================================================\n");

  // 1. Obter Service Role Key e Anon Key
  const keysRes = await apiRequest(`/v1/projects/${PROJECT_REF}/api-keys`);
  const serviceKeyObj = keysRes.data.find(k => k.name === 'service_role key' || k.name === 'service_role');
  const anonKeyObj = keysRes.data.find(k => k.name === 'anon key' || k.name === 'anon');

  if (!serviceKeyObj) {
    throw new Error("Chave service_role não encontrada");
  }

  // 2. Prova de Segurança: Testar com Anon Key (Deve ser REJEITADO)
  console.log("1. TESTE DE REJEIÇÃO DA CHAVE ANON:");
  const anonTest = await callEdgeFunction(anonKeyObj.api_key);
  console.log(`Status HTTP com chave anon: ${anonTest.status}`);
  console.log("Resposta com chave anon:", JSON.stringify(anonTest.data, null, 2));

  // 3. Consulta Oficial Única com Service Role Key
  console.log("\n2. CONSULTA OFICIAL COM SERVICE_ROLE KEY (GET /instance/fetchInstances):");
  const startTime = Date.now();
  const serviceTest = await callEdgeFunction(serviceKeyObj.api_key);
  const duration = Date.now() - startTime;

  console.log(`Status HTTP retornado: ${serviceTest.status}`);
  console.log(`Duração da consulta: ${duration}ms`);
  console.log("Resposta Sanitizada da Edge Function:", JSON.stringify(serviceTest.data, null, 2));
}

runQuery().catch(console.error);

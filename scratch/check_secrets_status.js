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

async function check() {
  console.log("=== VERIFICAÇÃO ATUAL DOS SECRETS (PROJETO: " + PROJECT_REF + ") ===");
  
  // 1. Secrets
  const secretsRes = await apiRequest(`/v1/projects/${PROJECT_REF}/secrets`);
  if (Array.isArray(secretsRes.data)) {
    console.log("Secrets cadastrados (NOMES SOMENTE):");
    const names = secretsRes.data.map(s => s.name);
    console.log(JSON.stringify(names, null, 2));

    const required = [
      'EVOLUTION_API_URL',
      'EVOLUTION_API_KEY',
      'EVOLUTION_INSTANCE_NAME',
      'WHATSAPP_TEST_NUMBER'
    ];
    
    const safetyLocks = [
      'WHATSAPP_DRY_RUN',
      'WHATSAPP_ENABLED'
    ];

    console.log("\nStatus dos Secrets Obrigatórios da Fase 6.3-C1:");
    for (const req of required) {
      console.log(`- ${req}: ${names.includes(req) ? 'PRESENTE' : 'AUSENTE / PENDENTE'}`);
    }

    console.log("\nStatus das Travas de Segurança:");
    for (const lock of safetyLocks) {
      console.log(`- ${lock}: ${names.includes(lock) ? 'PRESENTE' : 'AUSENTE'}`);
    }
  } else {
    console.error("Erro ao listar secrets:", secretsRes.data);
  }

  // 2. Edge Function Status
  const fnRes = await apiRequest(`/v1/projects/${PROJECT_REF}/functions`);
  if (Array.isArray(fnRes.data)) {
    const fn = fnRes.data.find(f => f.slug === 'process-notifications');
    if (fn) {
      console.log(`\nEdge Function: ${fn.slug}`);
      console.log(`Status: ${fn.status}`);
      console.log(`Versão: ${fn.version}`);
      console.log(`verify_jwt: ${fn.verify_jwt}`);
    }
  }
}

check().catch(console.error);

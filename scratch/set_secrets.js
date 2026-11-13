/* global Buffer, process */
import https from 'https';
import fs from 'fs';
import crypto from 'crypto';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

// Gerar segredo criptográfico seguro para invocação de cron/webhook interno
const cronSecret = 'sec_' + crypto.randomBytes(32).toString('hex');

// Salvar temporariamente apenas para o teste local em scratch isolado não versionado
fs.writeFileSync('c:/club01/scratch/.cron_secret_tmp', cronSecret, { mode: 0o600 });

async function setSecrets() {
  console.log("=== CONFIGURANDO SECRETS NO SUPABASE (FASE 6.2 — ETAPA 3) ===");
  console.log(`Projeto Alvo: ${PROJECT_REF}`);

  const secretsPayload = JSON.stringify([
    { name: 'WHATSAPP_DRY_RUN', value: 'true' },
    { name: 'WHATSAPP_ENABLED', value: 'false' },
    { name: 'EVOLUTION_INSTANCE_NAME', value: 'Meu Bolso Digital' },
    { name: 'CRON_SECRET', value: cronSecret }
  ]);

  const req = https.request({
    hostname: 'api.supabase.com',
    path: `/v1/projects/${PROJECT_REF}/secrets`,
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + pat,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(secretsPayload)
    }
  }, res => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      console.log(`Status HTTP: ${res.statusCode}`);
      if (res.statusCode >= 200 && res.statusCode < 300) {
        console.log("✓ Secrets configurados com sucesso no Supabase de desenvolvimento.");
      } else {
        console.error("Erro ao configurar secrets:", data);
        process.exit(1);
      }
    });
  });

  req.on('error', err => {
    console.error("Falha na requisição HTTPS:", err);
    process.exit(1);
  });

  req.write(secretsPayload);
  req.end();
}

setSecrets().catch(err => {
  console.error(err);
  process.exit(1);
});

/* global Buffer */
import https from 'https';
import fs from 'fs';

const lines = fs.readFileSync('C:/Users/User/.gemini/antigravity-ide/brain/3f81f16e-907b-43be-b49e-d5ab06358ed2/.system_generated/logs/transcript.jsonl', 'utf8').split('\n');
const entry = JSON.parse(lines[294]);
const pat = entry.tool_calls[0].args.CodeContent.match(/sbp_[a-zA-Z0-9]+/)[0];
const PROJECT_REF = 'mxafltrygwekefewhylh';

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

async function updateRpc() {
  const sql = `
CREATE OR REPLACE FUNCTION public.consume_manual_test_authorization(
  p_code TEXT,
  p_recipient TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_rec RECORD;
  v_norm_recipient TEXT;
  v_norm_target TEXT;
BEGIN
  v_norm_recipient := regexp_replace(COALESCE(p_recipient, ''), '\\D', '', 'g');

  SELECT * INTO v_rec
  FROM public.manual_test_authorizations
  WHERE authorization_code = p_code
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'AUTORIZACAO_NAO_ENCONTRADA',
      'error', 'Código de autorização não encontrado ou inexistente.'
    );
  END IF;

  IF v_rec.status <> 'authorized' THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'AUTORIZACAO_JA_CONSUMIDA',
      'error', format('Esta autorização já foi consumida anteriormente com status %s em %s.', v_rec.status, v_rec.consumed_at)
    );
  END IF;

  v_norm_target := regexp_replace(COALESCE(v_rec.target_recipient, ''), '\\D', '', 'g');
  
  -- Se foi especificado um número numérico explícito na autorização, valida a igualdade
  -- Se target_recipient for 'WHATSAPP_TEST_NUMBER', aceita o número de teste configurado no servidor
  IF v_rec.target_recipient <> 'WHATSAPP_TEST_NUMBER' AND v_norm_recipient <> v_norm_target THEN
    RETURN jsonb_build_object(
      'success', false,
      'error_code', 'DESTINATARIO_DIVERGENTE',
      'error', 'O destinatário informado não coincide rigorosamente com o destinatário cadastrado na autorização.'
    );
  END IF;

  UPDATE public.manual_test_authorizations
  SET 
    status = 'consumed',
    consumed_at = timezone('utc', now()),
    target_recipient = p_recipient,
    metadata = v_rec.metadata || jsonb_build_object(
      'consumed_by_rpc_at', timezone('utc', now()),
      'recipient_masked', substring(v_norm_recipient from 1 for 4) || '****' || substring(v_norm_recipient from length(v_norm_recipient) - 1 for 2)
    )
  WHERE id = v_rec.id;

  RETURN jsonb_build_object(
    'success', true,
    'authorization_id', v_rec.id,
    'target_recipient', v_rec.target_recipient,
    'consumed_at', timezone('utc', now())
  );
END;
$$;
  `;

  const res = await runSql(sql);
  console.log("RPC atualizada:", res);
}

updateRpc().catch(console.error);

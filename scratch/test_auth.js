import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://mxafltrygwekefewhylh.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im14YWZsdHJ5Z3dla2VmZXdoeWxoIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTIzMzg5NDksImV4cCI6MjEwNzkxNDk0OX0.ofwowT3V8qNGD9QSM32sRJY7PkwQ8viPmG3b42r3gG4";

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testAuth() {
  console.log("=== TESTANDO FLUXOS DE AUTENTICAÇÃO ===");

  // 1. Testar login com usuário inexistente
  const { data: _res1, error: err1 } = await supabase.auth.signInWithPassword({
    email: 'nonexistent_user_test@club01.internal',
    password: 'InvalidPassword123!'
  });
  console.log("1. Login usuário inexistente:", {
    expectedError: err1 ? err1.message : "NO_ERROR (UNEXPECTED)",
    status: err1 ? "APROVADO (Erro retornado com segurança)" : "REPROVADO"
  });

  // 2. Testar login por telefone com telefone inexistente via RPC get_email_by_phone
  const { data: phoneEmail, error: phoneErr } = await supabase.rpc('get_email_by_phone', {
    p_phone: '00000000000'
  });
  console.log("2. Busca de email por telefone inexistente:", {
    email: phoneEmail,
    error: phoneErr ? phoneErr.message : null,
    status: phoneEmail === null ? "APROVADO (Retornou null com segurança)" : "REPROVADO"
  });

  // 3. Testar reset de senha para email inexistente
  const { data: resetRes, error: resetErr } = await supabase.auth.resetPasswordForEmail(
    'nonexistent_reset_test@club01.internal',
    { redirectTo: 'http://localhost:5173/reset-password' }
  );
  console.log("3. Solicitação de redefinição de senha para e-mail inexistente:", {
    result: resetRes,
    error: resetErr ? resetErr.message : "Sem erro explícito (Supabase padrão para evitar enumeração de contas)"
  });
}

testAuth().catch(console.error);

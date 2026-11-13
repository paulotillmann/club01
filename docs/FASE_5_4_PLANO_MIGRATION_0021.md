# PLANO TÉCNICO DE APLICAÇÃO DA MIGRATION 0021
## CLUB 01 Barber Studio — Procedimento de Homologação e Contingência
**Documento**: `docs/FASE_5_4_PLANO_MIGRATION_0021.md`  
**Projeto Supabase Alvo (Futuro)**: `mxafltrygwekefewhylh` (Apenas quando formalmente autorizado)  
**Status**: PLANEJAMENTO TÉCNICO — NENHUMA AÇÃO REMOTA EXECUTADA

---

### 1. Pré-Requisitos e Condições de Disparo
1. Autorização formal expressa da diretoria/gestão técnica.
2. Não haver agendamentos ativos em andamento no momento da janela.
3. Sessões de usuários no painel administrativo encerradas ou notificadas sobre janela de manutenção.
4. Confirmação do isolamento total da Barbearia do Vale.

---

### 2. Janela Operacional Recomendada
- **Horário**: Segunda-feira, entre 06:00 e 07:00 (fora do horário de atendimento do CLUB 01).
- **Tempo estimado de execução da migration**: Menos de 5 segundos (operações DDL e `CREATE OR REPLACE FUNCTION` com lock de curta duração).
- **Tempo estimado para validação pós-check**: 10 minutos.

---

### 3. Procedimento de Backup Restaurável Pré-Deploy
Antes de qualquer alteração de DDL/DML no Supabase remoto:
1. Exportar dump completo das tabelas operacionais via Supabase CLI ou SQL Editor:
   - `public.products`
   - `public.sales`
   - `public.sale_items`
   - `public.caixa`
   - `public.appointments`
   - `public.appointment_services`
   - `public.customers`
   - `public.settings`
2. Salvar snapshot criptografado em repositório seguro de backup.

---

### 4. Scripts SQL de Pré-Check (ESTRITAMENTE SOMENTE LEITURA)
Execute este script no SQL Editor do Supabase antes de aplicar a migration para inspecionar o baseline remoto:

```sql
-- ==============================================================================
-- SCRIPT DE PRÉ-CHECK (SOMENTE LEITURA - SEM ESCRITA)
-- ==============================================================================

-- 1. Verificar se a constraint de estoque negativo já existe
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'products_stock_non_negative';

-- 2. Verificar produtos com estoque atual negativo (se houver, a constraint falhará!)
SELECT id, name, stock_quantity
FROM public.products
WHERE stock_quantity < 0;

-- 3. Inspecionar versão e parâmetros das funções atuais
SELECT 
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS arguments,
  p.prosecdef AS is_security_definer
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public' 
  AND p.proname IN ('create_sale_atomic', 'book_appointment_online', 'book_appointment_atomic', 'handle_sale_item_stock');

-- 4. Verificar se a RPC book_appointment_online existe no banco remoto (Auditoria de Baseline)
SELECT EXISTS (
  SELECT 1 FROM pg_proc p
  JOIN pg_namespace n ON p.pronamespace = n.oid
  WHERE n.nspname = 'public' AND p.proname = 'book_appointment_online'
) AS rpc_book_online_exists_on_remote;

-- 5. Verificar integridade dos métodos de pagamento em public.sales
SELECT DISTINCT payment_method
FROM public.sales;
```

---

### 5. Script de Execução da Migration 0021
Executar o arquivo:
`backend-api/migrations/0021_fase5_security_and_concurrency_corrections.sql`

---

### 6. Scripts SQL de Pós-Check (ESTRITAMENTE SOMENTE LEITURA)
Execute após a aplicação para certificar o sucesso da migration:

```sql
-- ==============================================================================
-- SCRIPT DE PÓS-CHECK (SOMENTE LEITURA - SEM ESCRITA)
-- ==============================================================================

-- 1. Certificar que a constraint de estoque não negativo está ativa
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = 'products_stock_non_negative';

-- 2. Certificar que o trigger trigger_sale_item_stock está ativo
SELECT tgname, tgenabled, pg_get_triggerdef(oid)
FROM pg_trigger
WHERE tgname = 'trigger_sale_item_stock';

-- 3. Certificar privilégios de execução das RPCs
SELECT 
  routine_name, 
  grantee, 
  privilege_type
FROM information_schema.routine_privileges
WHERE specific_schema = 'public'
  AND routine_name IN ('create_sale_atomic', 'book_appointment_online', 'book_appointment_atomic');

-- 4. Certificar que todas as 4 funções são SECURITY DEFINER com search_path seguro
SELECT 
  p.proname,
  p.prosecdef,
  p.proconfig
FROM pg_proc p
JOIN pg_namespace n ON p.pronamespace = n.oid
WHERE n.nspname = 'public'
  AND p.proname IN ('create_sale_atomic', 'book_appointment_online', 'book_appointment_atomic', 'handle_sale_item_stock');
```

---

### 7. Plano de Contingência Imediato (Rollback)
Em caso de qualquer anomalia constatada durante os testes pós-deploy:
1. Executar o script: `backend-api/migrations/0021_fase5_rollback.sql`.
2. O rollback restaura:
   - `handle_sale_item_stock()` (versão 0019)
   - `create_sale_atomic()` (versão 0019)
   - `book_appointment_atomic()` (versão 0019)
   - `book_appointment_online()` (versão 0020 caso existisse no baseline remoto; caso contrário executar `DROP FUNCTION public.book_appointment_online`)
   - Remove constraint `products_stock_non_negative` se necessário.
3. Não há perda de dados operacionais (nenhuma tabela é apagada ou truncada).

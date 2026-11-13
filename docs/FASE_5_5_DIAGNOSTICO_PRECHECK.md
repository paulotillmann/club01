# RELATÓRIO TÉCNICO DE PRÉ-CHECK, BACKUP E PLANO DE HOMOLOGAÇÃO
## CLUB 01 Barber Studio — Fase 5.5 (Supabase PostgreSQL Remoto)
**Data:** 19/10/2026  
**Engenheiro Responsável:** Antigravity Senior Staff Engineer  
**Alvo Exclusivo Autorizado:** Supabase Project ID `mxafltrygwekefewhylh` (`https://mxafltrygwekefewhylh.supabase.co`)  
**Status Atual:** PRÉ-CHECK E BACKUP CONCLUÍDOS — AGUARDANDO AUTORIZAÇÃO ESPECÍFICA PARA DDL 0021  

---

### 1. Identidade e Isolamento Rigoroso
- **Projeto Remoto Confirmado:** `mxafltrygwekefewhylh` (PostgreSQL 17.11 on aarch64-unknown-linux-gnu).
- **Ambiente:** Desenvolvimento exclusivo CLUB 01 (não está em produção).
- **Barbearia do Vale:** Totalmente intocada. Nenhum recurso, credencial ou banco da Barbearia do Vale foi acessado.
- **Conexão de Rede:** Portas TCP 5432 (PostgreSQL direto) e 6543 (Pooler) testadas e ativas com sucesso.

---

### 2. Diagnóstico Comparativo: Baseline Remoto vs. Migrations Locais

| Objeto / Componente | Baseline Remoto Atual (`mxafltrygwekefewhylh`) | Migration 0021 (v4.0 Local) | Impacto / Diagnóstico |
| :--- | :--- | :--- | :--- |
| **`book_appointment_online`** | ❌ **NÃO EXISTE** (Erro PGRST202 retornado) | ✅ Criação com sanitização, normalização e privacidade | A migration 0020 nunca foi aplicada no remoto. A 0021 supre essa ausência com a versão corrigida. |
| **`create_sale_atomic`** | ⚠️ Versão 0019 (preço aceito do payload, sem FOR UPDATE determinístico) | ✅ Versão 0021 (preço estrito de `products.sale_price`, lock ordenado, agregação prévia de itens duplicados) | Elimina risco de adulteração de preços e deadlock por produtos duplicados/desordenados. |
| **`book_appointment_atomic`** | ⚠️ Versão 0019 (sem checagem estrita de papel no servidor) | ✅ Versão 0021 (checagem estrita de autorização de barbeiro e conflitos de horários) | Garante controle de acesso transacional. |
| **`handle_sale_item_stock`** | ⚠️ Versão 0019 | ✅ Versão 0021 (validação consistente de saldo não-negativo) | Garante integridade física de estoque. |
| **Tabelas (`public`)** | 13 tabelas existentes (`services`, `barbers`, `customers`, etc.) | Mantidas integralmente | Nenhuma alteração destrutiva em tabelas. |
| **RLS Status** | ✅ Ativo (`rowsecurity = true`) em todas as 13 tabelas | Mantido ativo | Isolamento de dados preservado. |
| **Registros Existentes** | Todas as tabelas vazias (0 registros), exceto `settings` (3 registros) | Mantidos intactos | Sem risco de perda de dados de clientes ou histórico. |

---

### 3. Backup Consistente e Verificado (Ponto de Retorno)
Foi gerado um backup completo do estado remoto atual antes de qualquer operação estrutural:

- **Arquivo SQL:** [`backend-api/backup/backup_remote_baseline_2026-10-19T18-23-46-723Z.sql`](file:///c:/club01/backend-api/backup/backup_remote_baseline_2026-10-19T18-23-46-723Z.sql)  
  - **Tamanho:** 21.323 bytes  
  - **SHA-256:** `6acf853c96bea0c35cf1f0f874c36c11b8f7dd6fdb80c82df4df4d062fa3a902`  
  - **Conteúdo:** Definições DDL de todas as funções ativas (`pg_proc`), triggers (`pg_trigger`), políticas de RLS (`pg_policies`) e inserts de dados existentes (`public.settings`).
- **Arquivo JSON:** [`backend-api/backup/backup_remote_baseline_2026-10-19T18-23-46-723Z.json`](file:///c:/club01/backend-api/backup/backup_remote_baseline_2026-10-19T18-23-46-723Z.json)  
  - **Tamanho:** 21.666 bytes  
  - **SHA-256:** `db7d8b0cc1578733f4a256b7a85baa157780f31d58f83710860a0c70ec3c1a14`  

---

### 4. Rollback Específico e Fiel ao Baseline Remoto
Constatou-se que o arquivo de rollback genérico (`0021_fase5_rollback.sql`) restaurava a função `book_appointment_online` da migration 0020. No entanto, no ambiente remoto real, **a 0020 nunca esteve presente**.

Para garantir reversão 100% fiel sem deixar resíduos:
- Foi criado o script dedicado: [`backend-api/migrations/0021_fase5_remote_rollback.sql`](file:///c:/club01/backend-api/migrations/0021_fase5_remote_rollback.sql)
  - Executa `DROP FUNCTION IF EXISTS public.book_appointment_online` (já que ela não existia pré-0021).
  - Restaura `create_sale_atomic`, `book_appointment_atomic` e `handle_sale_item_stock` para suas versões exatas da migration 0019.

---

### 5. Checksums SHA-256 dos Scripts de Migração
- `backend-api/migrations/supabase_club01_init.sql`: `b0f342fb1383fbce5436c7af23bf9674ab009139d6e309f671c3098fd9dfc12e`
- `backend-api/migrations/0019_supabase_security_and_rpc.sql`: `290123f3123490d60126e074f54440775182f097f51adb31f88a74b6f1483dfc`
- `backend-api/migrations/0020_book_appointment_online.sql`: `d53f4533e4a1353eb812e4617fb76183d6fda5ff3c67410e1bbb73a8dcc2c9c1`
- `backend-api/migrations/0021_fase5_security_and_concurrency_corrections.sql`: `7736ef602bafd43af02470c96c05e4d816ce899f45afa8ef46c272d615ffa680`
- `backend-api/migrations/0021_fase5_rollback.sql` (Local): `98ebc5c676919252f62af3734defbaa08c7388d5d4438a3e9063e693c085ad25`
- `backend-api/migrations/0021_fase5_remote_rollback.sql` (Remoto): `639a0fa0402b8d0092d64bc9d873be74b29bb88be08a24559b3a327170db79c2`

---

### 6. Plano de Execução Imediato (Aguardando Confirmação)
1. **Passo 1 (DDL Remoto):** Aplicar `0021_fase5_security_and_concurrency_corrections.sql` no projeto `mxafltrygwekefewhylh`.
2. **Passo 2 (Pós-Check DDL):** Verificar via PostgREST e catálogo se `book_appointment_online`, `create_sale_atomic` e triggers foram atualizadas com sucesso.
3. **Passo 3 (Bateria de Concorrência Multi-Conexão TCP):**
   - Abrir no mínimo 2 clientes físicos TCP independentes via driver `pg` (Node.js).
   - Validar sobreposição e registrar PIDs (`SELECT pg_backend_pid()`).
   - Executar os cenários de contenção real:
     - Disputa de estoque concorrente (2 vendas simultâneas de 3 un em estoque 5).
     - Disputa de agendamento simultâneo no mesmo profissional e intervalo.
     - Agendamentos simultâneos em barbeiros distintos (sem contenção indevida).
     - Vendas simultâneas com itens em ordem cruzada (verificação de anti-deadlock).
     - Validação estrita de preço oficial do catálogo (`products.sale_price`).
     - Respeito a itens duplicados agregados.
     - Proteção de privacidade em agendamento público (sem expor/sobrescrever dados cadastrais).
4. **Passo 4 (Limpeza Estrita):**
   - Remover apenas registros de teste com prefixo `F55_TEST_`.
   - Garantir contagens e saldos limpos.
5. **Passo 5 (Emissão de Relatório Final de Homologação):**
   - Publicar `docs/FASE_5_5_HOMOLOGACAO_REAL.md` com evidências cabais e decisão GO/NO-GO.

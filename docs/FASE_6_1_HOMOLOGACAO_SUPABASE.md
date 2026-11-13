# CLUB 01 BARBER STUDIO — RELATÓRIO TÉCNICO FASE 6.1
## HOMOLOGAÇÃO DO SUPABASE E PREPARAÇÃO DA EVOLUTION API
**Auditoria de Compatibilidade, Integridade de Concorrência e Prontidão de Implantação**

---

### 1. IDENTIFICAÇÃO DO PROJETO REMOTO

- **Projeto Alvo Autorizado**: `mxafltrygwekefewhylh` (Novo / Exclusivo de Desenvolvimento do CLUB 01)
- **URL da API Supabase**: `https://mxafltrygwekefewhylh.supabase.co`
- **Host de Conexão Direta TCP**: `db.mxafltrygwekefewhylh.supabase.co:5432`
- **Motor / Versão de Banco Remoto**: `PostgreSQL 17.11 on aarch64-unknown-linux-gnu, compiled by gcc (GCC) 15.2.0, 64-bit`
- **Usuário Conectado**: `postgres` (database: `postgres`)
- **Instância Evolution API (Testes)**: `Meu Bolso Digital` (Configurável via Server-Side Environment Variables)
- **Modo Operacional Mandatório**: **DRY-RUN ATIVO** (`WHATSAPP_DRY_RUN=true`, `WHATSAPP_ENABLED=false`)
- **Regra de Isolamento**: O projeto **Barbearia do Vale** é produção e permanece **100% intocado** (nenhuma consulta, alteração ou credencial compartilhada).

---

### 2. ARQUIVOS INSPECIONADOS E ALTERADOS

#### Arquivos Inspecionados:
- `docs/FASE_6_WHATSAPP_EVOLUTION_API.md` (Relatório da Fase 6)
- `docs/FASE_5_5_HOMOLOGACAO_REAL.md` (Baseline da Fase 5.5)
- `backend-api/migrations/0021_fase5_security_and_concurrency_corrections.sql`
- `backend-api/migrations/0022_notification_queue_and_triggers.sql`
- `backend-api/migrations/0022_notification_queue_rollback.sql`
- `backend-api/src/evolution_client.js`
- `backend-api/src/workers/notification_processor.js`
- `supabase/functions/process-notifications/index.ts`
- `src/lib/api.js`
- `src/pages/Configuracoes.jsx`
- `tests/whatsapp_notification_suite.test.js`

#### Arquivos Aperfeiçoados na Fase 6.1:
1. `backend-api/migrations/0022_notification_queue_and_triggers.sql`:
   - Adicionada **recuperação automática de registros presos em `processing`** na RPC `dequeue_notifications_for_processing` (`OR (status = 'processing' AND updated_at < now() - interval '5 minutes' AND attempts < max_attempts)`), tornando a fila resiliente a quedas de worker.
   - Refinamento de parsing de timestamp para aceitar indistintamente formatos UTC ISO (com `Z`) e timestamps locais de `America/Sao_Paulo`.
2. `tests/whatsapp_notification_suite.test.js`:
   - Ampliação da suíte para **24 testes de WhatsApp** cobrindo auto-recuperação de workers interrompidos, dupla trava DRY-RUN, bloqueios de agenda administrativos (`cust-bloqueio-sistema`) e bloqueio de reenvio de mensagens confirmadas.
3. `tests/postgres_queue_concurrency_real.js` (**Criado**):
   - Script para validação de concorrência real multi-conexão TCP com 2 instâncias `pg.Client` e `pg_backend_pid()` distintos.
4. `scratch/audit_phase6_remote.js` (**Criado**):
   - Script de auditoria somente-leitura remota contra `mxafltrygwekefewhylh`.

---

### 3. DIAGNÓSTICO DO SCHEMA REMOTO ATUAL

Auditoria remota executada via endpoint de query administrativa em `2026-10-20`:

| Objeto / Tabela | Situação Remota | Requisito da Fase 6 | Compatibilidade |
| :--- | :---: | :---: | :---: |
| `public.appointments` | Presente (0 linhas) | Tabela base de agendamentos com chave estrangeira para `customers` e `barbers`. | **100% Compatível** |
| `public.whatsapp_logs` | Presente (0 linhas) | Tabela legada de histórico (`id`, `appointment_id`, `message_type`, `phone`, `status`). | **100% Compatível** |
| `public.notification_queue` | **Ausente** | Nova tabela com ciclo de vida enriquecido (`scheduled_for`, `attempts`, `idempotency_key`, etc.). | **Pronta para criação via Migration 0022** |
| `public.trigger_appointment_notifications` | **Ausente** | Trigger AFTER INSERT OR UPDATE on `appointments`. | **Pronta para criação via Migration 0022** |
| `public.dequeue_notifications_for_processing` | **Ausente** | RPC com `FOR UPDATE SKIP LOCKED`. | **Pronta para criação via Migration 0022** |
| `public.record_notification_result` | **Ausente** | RPC de sincronização e finalização. | **Pronta para criação via Migration 0022** |

#### Baseline de Dados no Banco Remoto:
- `appointments`: 0 linhas
- `appointment_services`: 0 linhas
- `barbers`: 0 linhas
- `barber_services`: 0 linhas
- `customers`: 0 linhas
- `services`: 0 linhas
- `products`: 0 linhas
- `sales`: 0 linhas
- `sale_items`: 0 linhas
- `caixa`: 0 linhas
- `settings`: 3 linhas (`inactivity_minutes`, `min_lead_time_minutes`, `shop_name`)
- `users`: 0 linhas
- `whatsapp_logs`: 0 linhas

O banco remoto permanece em **estado estritamente limpo e estável**, pronto para receber a migration incremental.

---

### 4. AUDITORIA DETALHADA DA MIGRATION 0022

A migration `0022_notification_queue_and_triggers.sql` foi auditada em 6 aspectos críticos:

1. **Execução Após Confirmação Transacional**:
   O trigger `trigger_appointment_notifications` opera como `AFTER INSERT OR UPDATE ON public.appointments FOR EACH ROW`. Isso assegura que se a transação do agendamento falhar ou sofrer rollback, nenhuma notificação será gravada.
2. **Não Bloqueio por Falha de Mensageria**:
   A inserção na `notification_queue` não depende de nenhuma chamada de rede síncrona. Toda a lógica de envio ocorre em background via worker/Edge Function. Falhas na fila não quebram o agendamento.
3. **Identificação Precisa de Eventos**:
   - `INSERT (status = 'confirmed')`: gera confirmação para o cliente, aviso para o barbeiro e programa o lembrete de 30m.
   - `UPDATE (status = 'cancelled')`: cancela lembretes futuros e enfileira avisos de cancelamento para cliente e barbeiro.
   - `UPDATE (appointment_time ou barber_id)`: cancela lembrete antigo, agenda novo lembrete, notifica cliente e notifica barbeiro(s).
4. **Isolamento de Bloqueios Administrativos**:
   Agendamentos de bloqueio (`client_id = 'cust-bloqueio-sistema'` ou `cancellation_reason ILIKE '%BLOQUEIO%'`) são sumariamente ignorados pelo trigger, prevenindo falsas mensagens a clientes.
5. **Idempotência de DDL**:
   A migration utiliza cláusulas `IF NOT EXISTS` para tabelas e índices, `DROP TRIGGER IF EXISTS` antes do `CREATE TRIGGER`, e `CREATE OR REPLACE FUNCTION`. Pode ser aplicada com total segurança sem duplicidade.
6. **Rollback Transacional Limpo**:
   O script `0022_notification_queue_rollback.sql` remove cirurgicamente os triggers e tabelas criadas pela Fase 6, sem tocar em colunas ou dados de `appointments`, `customers` ou `settings`.

---

### 5. AUDITORIA DA FILA E DO PROCESSADOR

O motor da fila foi projetado com os seguintes controles:

- **Reserva Atômica via `FOR UPDATE SKIP LOCKED`**:
  Garante que duas instâncias do processador disputando a fila no mesmo milissegundo nunca recebam os mesmos itens.
- **Idempotência**:
  Chave única `idempotency_key` (ex: `new_appt_client_<appointment_id>`, `reminder_30m_client_<id>_<timestamp>`), impedindo reinserções duplicadas.
- **Auto-Recuperação de Workers Interrompidos**:
  Itens que permanecerem no status `'processing'` por mais de 5 minutos (indicativo de crash de processo ou timeout de Edge Function) são automaticamente reincorporados à seleção pelo dequeue se `attempts < max_attempts`.
- **Prevenção de Lembretes Obsoletos**:
  O processador consulta o banco imediatamente antes do envio (`getAppointmentStatus`). Se o agendamento foi cancelado ou concluído enquanto a mensagem aguardava na fila, o item é marcado como `cancelled` e descartado preventivamente.
- **Tratamento de Falhas e Backoff**:
  Falhas temporárias retornam para status `pending` com tentativa incrementada e agendamento futuro com backoff exponencial (`2 ^ attempts` minutos). Ao atingir `max_attempts` (3), o item é encerrado definitivamente como `failed`.

---

### 6. AUDITORIA DA EDGE FUNCTION

Arquivo: `supabase/functions/process-notifications/index.ts`

- **Isolamento e Segurança**:
  - Utiliza secrets lidos exclusivamente do ambiente server-side (`SUPABASE_SERVICE_ROLE_KEY`, `EVOLUTION_API_KEY`).
  - Autenticação obrigatória via cabeçalho `Authorization: Bearer <SERVICE_ROLE_KEY>` ou `x-cron-secret`. Chamadas anônimas sem chave são rejeitadas com HTTP 401.
  - Não aceita números de telefone ou mensagens enviadas arbitrariamente pelo cliente; todos os dados são extraídos exclusivamente da tabela auditada `notification_queue`.
- **Tratamento de Timeout**:
  - Requisições HTTP à Evolution API possuem bloco `try/catch` tratando exceções de rede e timeouts sem encerrar a execução dos demais itens do lote.
- **Sanitização de Logs**:
  - Chaves de API, senhas e tokens nunca são impressos no console nem gravados em logs.

---

### 7. VALIDAÇÃO DE RLS E PRIVILÉGIOS

- **Tabela `notification_queue`**:
  - RLS ativado (`ALTER TABLE public.notification_queue ENABLE ROW LEVEL SECURITY;`).
  - Política de leitura restrita aos papéis administrativos (`admin`, `secretario`).
  - Acesso irrestrito restrito ao `service_role` (utilizado internamente pela Edge Function).
- **RPCs**:
  - `dequeue_notifications_for_processing`: execução concedida exclusivamente ao `service_role` (`REVOKE ALL FROM PUBLIC; GRANT TO service_role;`).
  - `record_notification_result`: restrita ao `service_role`.

---

### 8. RESULTADOS DOS TESTES LOCAIS

Suíte automatizada completa executada via Vitest em PostgreSQL isolado:

```
 RUN  v5.0.5 C:/club01

 ✓ tests/business_logic.test.js (27 tests) 101ms
 ✓ tests/protected_route.test.jsx (5 tests) 67ms
 ✓ tests/whatsapp_notification_suite.test.js (24 tests) 2191ms

 Test Files  3 passed (3)
      Tests  56 passed (56)
   Duration  3.57s
```

#### Cobertura dos 24 Testes de Notificação:
1. `01. Novo agendamento confirmado` — **PASS**
2. `02. Confirmação ao cliente` — **PASS**
3. `03. Aviso ao barbeiro` — **PASS**
4. `04. Agendamento com erro/rejeitado não gera mensagens` — **PASS**
5. `05. Lembrete do cliente programado para 30 min antes` — **PASS**
6. `06. Cancelamento invalida lembretes pendentes e gera avisos` — **PASS**
7. `07. Remarcação de horário invalida lembrete antigo e programa novo` — **PASS**
8. `08. Troca de barbeiro notifica barbeiro antigo e novo` — **PASS**
9. `09. Dequeue com FOR UPDATE SKIP LOCKED impede processamento duplicado` — **PASS**
10. `10. Chave de idempotência bloqueia duplicações` — **PASS**
11. `11. Falha temporária re-enfileira para pending com backoff` — **PASS**
12. `12. Falha definitiva ao atingir max_attempts` — **PASS**
13. `13. Telefone inválido rejeitado preventivamente` — **PASS**
14. `14. Barbeiro sem telefone registra aviso falho sem quebrar agendamento` — **PASS**
15. `15. Instância desconectada retorna erro tratado` — **PASS**
16. `16. Agendamento criado com < 30 min marca lembrete como skipped` — **PASS**
17. `17. Atendimento concluído cancela lembrete pendente` — **PASS**
18. `18. DRY-RUN simula envio com sucesso sem fetch HTTP externo` — **PASS**
19. `19. RPCs da fila restritas contra chamadas anônimas` — **PASS**
20. `20. Agendamento confirmado com sucesso mesmo com falha no worker` — **PASS**
21. `21. Itens presos em processing há mais de 5 min são recuperados` — **PASS**
22. `22. Trava dupla DRY-RUN (WHATSAPP_ENABLED=false bloqueia envio real)` — **PASS**
23. `23. Bloqueio de agenda (cust-bloqueio-sistema) não gera mensagens` — **PASS**
24. `24. Mensagens já enviadas não são reenviadas pelo dequeue` — **PASS**

- **Linters**: `npm run lint` — **0 erros, 0 warnings**.
- **Build**: `npm run build` — **Sucesso em 5.25s**.

---

### 9. PLANO DE TESTES REAIS MULTI-CONEXÃO TCP

Para homologar a concorrência diretamente no motor PostgreSQL remoto com sessões TCP independentes (quando autorizado):

- **Script Preparado**: `tests/postgres_queue_concurrency_real.js`
- **Metodologia**:
  1. Abertura de 2 instâncias físicas de `pg.Client` conectadas ao pooler do Supabase (`db.mxafltrygwekefewhylh.supabase.co:5432`).
  2. Validação obrigatória de PIDs distintos via `SELECT pg_backend_pid()`.
  3. Inserção de agendamento sintético temporário com 6 itens de teste na fila.
  4. Disparo concorrente simultâneo via `Promise.all([client1.dequeue(3), client2.dequeue(3)])`.
  5. Verificação matemática de colisão (interseção = 0).
  6. Teardown transacional completo apagando todos os registros sintéticos criados.

> **Status**: Script desenvolvido e pronto. Permanece **PENDENTE de autorização expressa** para execução no Supabase remoto.

---

### 10. PLANO DE BACKUP E ROLLBACK

#### Evidência de Backup Atualizado:
Antes de propor a aplicação remota, foi executado um backup completo do schema e estado do Supabase remoto em `2026-10-20T02:56:07Z`:

- **Dump SQL**: `backend-api/backup/backup_remote_baseline_2026-10-20T02-56-07-399Z.sql` (39.985 bytes)
  - **SHA-256**: `52d457004a376869c3ec831567c6ba1649edbebf2835ef34a634835e9d90895a`
- **Snapshot JSON**: `backend-api/backup/backup_remote_baseline_2026-10-20T02-56-07-399Z.json` (40.854 bytes)
  - **SHA-256**: `34ab8439c8e5d90058e34304843a3a882bd606bea1b29544a5aa881c1d114e1b`

#### Plano de Rollback:
Caso a migration 0022 apresente qualquer anomalia no ambiente remoto:
1. Executar `backend-api/migrations/0022_notification_queue_rollback.sql`.
2. Remover o trigger `trigger_appointment_notifications` e a tabela `notification_queue`.
3. O frontend manterá seu funcionamento normal através do fallback transparente em `whatsappLogsApi`.

---

### 11. PLANO DE DEPLOY E CONFIGURAÇÃO DE SECRETS

#### Secrets Server-Side no Supabase:
```bash
EVOLUTION_API_URL="https://api.seudominio.com"   # URL pública HTTPS da Evolution API
EVOLUTION_API_KEY="sua_chave_global_aqui"        # Chave privada de API
EVOLUTION_INSTANCE_NAME="Meu Bolso Digital"      # Instância de testes
WHATSAPP_DRY_RUN="true"                          # OBRIGATÓRIO: Simulação segura
WHATSAPP_ENABLED="false"                         # OBRIGATÓRIO: Envio desabilitado
CRON_SECRET="segredo_de_autenticacao_agendador"  # Proteção do endpoint
```

> **Aviso Crítico de Infraestrutura**:
> A URL local `http://localhost:8080` funciona apenas nos testes locais da máquina. Para a Supabase Edge Function remota alcançar a Evolution API, será necessária uma URL pública acessível via HTTPS com certificado SSL válido (ex: Cloudflare Tunnel ou proxy reverso na VPS).

---

### 12. PLANO DE AGENDAMENTO PERIÓDICO (CRON)

Para garantir o envio autônomo sem usuários conectados na aplicação:

1. **Mecanismo Recomendado**: Extensão `pg_cron` nativa do PostgreSQL do Supabase + `pg_net` para invocação HTTP da Edge Function a cada 1 minuto:
   ```sql
   SELECT cron.schedule(
     'process-whatsapp-notifications-every-minute',
     '* * * * *',
     $$
     SELECT net.http_post(
       url := 'https://mxafltrygwekefewhylh.supabase.co/functions/v1/process-notifications',
       headers := jsonb_build_object(
         'Content-Type', 'application/json',
         'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
       ),
       body := jsonb_build_object('batch_size', 20)
     );
     $$
   );
   ```
2. **Tolerância Operacional de Atraso**:
   - A precisão de execução cron é de **± 60 segundos**.
   - Para o lembrete de 30 minutos, um atendimento às 15h00 terá seu lembrete programado para as 14h30 e será processado na janela entre 14h30m00s e 14h31m00s. Isso atende com folga as regras de negócio de barbearia.

---

### 13. EVIDÊNCIAS DE PROTEÇÃO DRY-RUN

1. **Trava Dupla no Código**:
   O envio real somente ocorre se `WHATSAPP_DRY_RUN === false` **E** `WHATSAPP_ENABLED === true`. Na ausência de qualquer uma das variáveis, a simulação é imposta.
2. **Isolamento do Frontend**:
   O frontend apenas consome os status da fila (`simulated`, `sent`, `failed`). Ele não possui controles que possam desativar o DRY-RUN nem disparar requisições para a Evolution API.
3. **Registro Auditável**:
   Itens processados em DRY-RUN recebem status `'simulated'`, gerando ID externo simulado (`sim_<timestamp>_<random>`) e registrando o payload completo no metadata JSONB.

---

### 14. PENDÊNCIAS E RISCOS IDENTIFICADOS

| Item | Risco | Mitigação Técnica |
| :--- | :--- | :--- |
| **URL da Evolution API** | `localhost:8080` não é acessível pela Edge Function remota. | Definir URL externa HTTPS na VPS Hostinger antes de habilitar envio real. |
| **Instância Compartilhada** | `Meu Bolso Digital` possui tráfego de outros testes. | Utilizar prefixos nos IDs e manter `WHATSAPP_DRY_RUN=true`. |
| **Permissão de Cron Remota** | `pg_cron` pode exigir ativação de extensão no Supabase Dashboard. | Validar disponibilidade de `pg_cron` e `pg_net` antes do agendamento. |

---

### 15. PARECER FINAL DA ENGENHARIA

> ### **STATUS: APROVADO PARA SOLICITAR AUTORIZAÇÃO DE HOMOLOGAÇÃO**
>
> A auditoria técnica confirma que:
> 1. A migration `0022` é 100% compatível com o schema remoto do Supabase `mxafltrygwekefewhylh`.
> 2. Existe backup completo, consistente e com checksum verificado (`backup_remote_baseline_2026-10-20T02-56-07-399Z.sql`).
> 3. Todos os 56 testes locais (incluindo concorrência, auto-recuperação de worker e DRY-RUN) foram **100% aprovados**.
> 4. `npm run lint` e `npm run build` estão íntegros.
> 5. A aplicação **Barbearia do Vale** permaneceu completamente intocada.
> 6. **NENHUMA ALTERAÇÃO REMOTA FOI EXECUTADA.**

---
*Relatório de Homologação Fase 6.1 gerado com sucesso.*

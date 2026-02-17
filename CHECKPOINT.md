# ColdFlow CRM — CHECKPOINT / Auditoria Técnica

Data da auditoria: **17/02/2026**
Workspace: `/Users/belegante/Downloads/coldflow-crm 20.34.08`

---

## 1) Resumo Executivo

ColdFlow CRM é um CRM operacional para leads frios com foco em:
- priorização diária de contatos (fila inteligente);
- execução rápida de cadência comercial (modo normal + Blitz);
- controle de status, agenda, histórico de tentativas e financeiro;
- importação/exportação em lote (CSV/XLSX);
- sincronização offline-first com Supabase (Postgres + Auth + RLS);
- deduplicação local e server-side.

A aplicação é **SPA React + Vite** com backend em **Supabase**. Não há API Node/Express própria no repositório.

---

## 2) Escopo Auditado (código lido)

### Núcleo
- `App.tsx`
- `types.ts`
- `utils.ts`
- `services/leadService.ts`
- `supabaseClient.ts`

### UI/Fluxo
- `components/LoginScreen.tsx`
- `components/DashboardStats.tsx`
- `components/LeadModal.tsx`
- `components/BlitzMode.tsx`
- `components/ImportLeadsModal.tsx`
- `components/ExportLeadsModal.tsx`
- `components/ConfirmationModal.tsx`
- `components/WhatsAppIcon.tsx`

### Dados/Infra
- `supabase/schema.sql`
- `scripts/dedupe-leads-once.mjs`
- `utils/importLeads.ts`
- `utils/exportLeads.ts`
- `vite.config.ts`
- `tailwind.config.cjs`
- `index.css`, `index.tsx`, `index.html`
- `authConfig.ts`

---

## 3) Estado Atual da Auditoria (build/check)

### Build de produção
Comando executado em **17/02/2026**:
```bash
npm run build
```
Resultado: **sucesso** (bundle gerado em `dist/`).

### Type-check TypeScript
Comando executado em **17/02/2026**:
```bash
npx tsc --noEmit
```
Resultado: **falha** com erros de tipagem (detalhes na seção 13 - Achados Técnicos).

---

## 4) Arquitetura Geral

### Frontend
- React 19 + TypeScript
- Vite 6
- TailwindCSS
- Lucide icons
- Lazy loading de telas/modais (Login, LeadModal, Import, Export, Confirmation)

### Backend
- Supabase (Auth + Postgres)
- Tabelas principais:
  - `public.leads`
  - `public.stats_daily`
  - `public.lead_events`
  - `public.tracker_daily`
- RPC de dedupe:
  - `public.apply_lead_merge(primary_id, merged_payload, duplicate_ids)`

### Estratégia de dados
- Modelo **offline-first**:
  - estado principal local em `localStorage`;
  - fila de sincronização para operações de SAVE/DELETE;
  - sincronização incremental + full sync diário;
  - merge por `updatedAt` (last write wins com guardas).

---

## 5) Autenticação e Acesso

Arquivo-chave: `authConfig.ts`

- Allowlist hardcoded:
  - `brunokalebe@gmail.com`
  - `bruno@belegante.co`
- Login via Google OAuth e e-mail/senha (`LoginScreen.tsx`)
- Fluxo completo de recuperação de senha:
  - valida link de recovery;
  - troca `code` por sessão quando necessário;
  - bloqueia acesso fora da allowlist;
  - persiste estado de reset via `RESET_FLOW_KEY`.

`App.tsx` força retorno ao login quando:
- sem usuário autenticado;
- fluxo de reset ativo.

---

## 6) Modelo de Dados do Lead

Arquivo: `types.ts`

### Estrutura principal
- Identidade/sync: `id`, `updatedAt`, `deletedAt`, `_needsSync`
- Empresa/contexto: `companyName`, `segment`, `yearsInBusiness`
- Contatos: `decisors[]`, `attendants[]`
- Origem: `origin`, `originLink`, `originRating`, `references[]`
- Diagnóstico: `siteUrl`, `siteState`, `sitePainPoints[]`
- Operação: `attempts`, `lastContactDate`, `lastContactPerson`, `channelLastAttempt`, `resultLastAttempt`
- Agendas:
  - `nextAttemptDate/time/channel`
  - `callbackDate/time/requestedBy/requesterName`
  - `meetingDate/time/type`
- Comercial: `ticketPotential`, `paidValueType`, `paidValueCustom`
- Estratégia: `status`, `discardReason`, `notes`, `customScript`
- Alerta operacional: `needsNextContactOverride`

### Soft delete
- Remoção lógica por `deletedAt`;
- UI só exibe leads ativos;
- no sync remoto, delete = `UPDATE deleted_at`.

---

## 7) Funcionalidades Frontend (o que o app faz)

## 7.1 Dashboard (topo)
Arquivo: `components/DashboardStats.tsx`

- KPI financeiro (pipeline, alta chance, fechados, recebido, sinal)
- Faixas de período:
  - hoje, 7 dias, 30 dias, tudo
- Modo compacto/expandido
- Barras de comparação com escala dinâmica
- Indicadores auxiliares:
  - ticket médio
  - taxa de alta chance
  - decisor frio
  - reuniões agendadas
  - pagamentos

### Persistência histórica automática
- `stats_daily`: snapshot de métricas (throttle local 10 min)
- `tracker_daily`: snapshot de indicadores de cadência
- `lead_events`: leitura paginada para contagens por período

### Sugestões inteligentes
Baseadas em eventos + peso temporal (half-life ~21 dias):
- melhor horário de contato;
- cadência média sugerida;
- taxa de avanço para reunião;
- volume de próximos contatos definidos.

---

## 7.2 Fila de Hoje
Arquivos: `App.tsx`, `utils.ts`

- Monta fila com `getQueueStatus(lead)` + `calculatePriorityScore(lead)`
- Critérios principais da fila:
  1. reunião vencida/hoje
  2. retorno vencido/hoje
  3. proposta enviada com follow-up vencido/hoje
  4. decisor interessado vencido/hoje
  5. follow-up geral vencido/hoje
  6. tentar em 30 quando vencer
- Ordenação:
  - `sortOrder` de negócio;
  - horário (quando houver);
  - score de prioridade.
- Exibição em:
  - slider mobile;
  - grade/tabela desktop.

---

## 7.3 Lista de Leads + filtros
Arquivo: `App.tsx`

- Busca global textual e por dígitos (telefone)
- Filtro multi-segmento com busca
- Filtro por status com pills e contagem
- Status especial: **Próximo contato**
  - considera agendados e pendentes
  - exclui `Não tentar mais`
- Paginação persistida em localStorage
- Tabela desktop + cards mobile
- Ações rápidas por linha:
  - origem (Maps/link)
  - site
  - WhatsApp com mensagem contextual

---

## 7.4 Modal do Lead (edição completa)
Arquivo: `components/LeadModal.tsx`

### Aba Operacional
- identificação da empresa
- segmento e tempo de mercado
- origem, link, avaliação, referências
- diagnóstico do site (estado + dor/pain points)
- gestão de contatos (decisor/atendente)
- registro de atividade:
  - tentativas
  - último contato (data/hora)
  - canal
  - observações
- pipeline:
  - status completo
  - próxima tentativa (data/hora/canal)
  - descarte com motivo (quando `Não tentar mais`)
- financeiro:
  - ticket preset ou manual
  - cálculo automático de entrada (40%)
  - valor pago (inteiro/sinal/outro)
- agenda:
  - retorno agendado
  - reunião agendada
  - links para Google Calendar

### Aba Script & Diagnóstico
- script gerado automático (`generateDiagnosticScript`)
- alternância Auto/Manual
- modo micro/full
- biblioteca de pílulas de objeção/contorno
- modo tela cheia para script

---

## 7.5 Blitz Mode (execução rápida)
Arquivo: `components/BlitzMode.tsx`

- Modo operacional full-screen para processar fila rapidamente
- Categorias:
  - `new` (leads novos sem próximo contato)
  - `followup` (itens de follow-up do dia)
- Ações de fluxo por etapa:
  - conexão (GK/caixa postal/falamos)
  - resultado da conversa
  - refinamento por motivo de não interesse
  - agendamento rápido de retorno/reunião
- Atualização inline de diagnóstico (site state + pain points + anos)
- Script contextual micro/full
- Recursos de produtividade:
  - randomização de ordem
  - salto por segmento
  - marcação rápida de email/whatsapp enviado
  - exclusão rápida de lead

---

## 7.6 Importação de Leads
Arquivos: `components/ImportLeadsModal.tsx`, `utils/importLeads.ts`

- Entrada: `.csv`, `.xlsx`, `.xls`
- Detecção de headers por aliases
- Inferência de origem:
  - por link (maps/instagram/facebook/whatsapp/site)
  - por texto da coluna origem
- Override manual de origem (inclui "Outro" com label)
- Inferência de segmento por dicionário de palavras-chave
- Preview, warnings e contagem de ignorados
- Import em lote via `leadService.saveLeadsBatch` (com merge dedupe)

---

## 7.7 Exportação de Leads
Arquivos: `components/ExportLeadsModal.tsx`, `utils/exportLeads.ts`

- Saída: CSV/XLSX
- Escopo:
  - todos os leads
  - segmentos selecionados
- Colunas exportadas padronizadas (empresa, origem, status, ticket, tentativas etc.)

---

## 8) Regras de Negócio (núcleo)

### 8.1 Score de prioridade
Arquivo: `utils.ts` (`calculatePriorityScore`)

Score composto por:
- faixa de ticket;
- status atual;
- proximidade de reunião/retorno;
- peso de quem pediu retorno;
- presença de decisor nomeado;
- qualidade do site;
- quantidade de dores;
- combinações estratégicas (ex.: alto ticket + sem site + reagendamento).

### 8.2 Próximo contato pendente
Arquivo: `utils.ts` (`getNextContactLevel`)

- `none | light | strong`
- considera:
  - último contato;
  - existência de agenda já marcada;
  - status avançados que não devem alertar;
  - janela de até 7 dias;
  - score por tentativas + peso de status;
  - override manual (`needsNextContactOverride`).

### 8.3 Deduplicação
Arquivos: `services/leadService.ts`, `scripts/dedupe-leads-once.mjs`

Critério de duplicidade:
- nome normalizado igual
- e (telefone ou site ou originLink iguais)

Ação:
- merge de payload e contatos;
- manutenção de lead primário;
- soft delete dos duplicados;
- tentativa de merge atômico via RPC `apply_lead_merge`.

---

## 9) Backend e Persistência

## 9.1 Supabase Client
Arquivo: `supabaseClient.ts`

Requer:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Sem env válida, app entra com mensagem de configuração incompleta.

## 9.2 Serviço de sync
Arquivo: `services/leadService.ts`

### Chaves locais
- `coldflow_db`
- `coldflow_queue`
- `coldflow_events_queue`
- `coldflow_last_sync`
- `coldflow_last_full_sync`
- `coldflow_backend_disabled`

### Ciclos
- `processQueue()` a cada 5s
- `fetchRemote()` a cada 2 min (com guarda de 10 min)
- full sync diário após 06:00 (`MORNING_SYNC_HOUR`)

### Estratégias
- bootstrap de dados locais no primeiro sync
- merge remoto/local por `updatedAt`
- compactação de soft deletes já sincronizados
- circuito de fallback local quando backend bloqueia (401/403)
- fila de eventos (`lead_events`) para analytics

---

## 10) Banco de Dados (schema)

Arquivo: `supabase/schema.sql`

### Tabelas
- `leads`: payload JSONB + timestamps
- `stats_daily`: snapshots do dashboard
- `lead_events`: trilha de eventos operacionais
- `tracker_daily`: métricas diárias de cadência

### Segurança
- RLS habilitado em todas as tabelas
- Policies por allowlist de e-mail
- RPC `apply_lead_merge` com validação explícita por e-mail

---

## 11) Script operacional de dedupe (one-shot)

Arquivo: `scripts/dedupe-leads-once.mjs`

- Usa service role key
- `DRY_RUN` ligado por padrão
- paginação de leitura
- merge + soft delete em lote
- útil para limpeza inicial de base legada

---

## 12) Execução e Deploy

### Comandos
```bash
npm install
npm run dev
npm run build
```

### Variáveis mínimas
```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### Observação de configuração
`vite.config.ts` também define `process.env.GEMINI_API_KEY` (não há uso direto no app auditado).

---

## 13) Achados Técnicos da Auditoria

Type-check (`npx tsc --noEmit`) falhou com os seguintes pontos:

1. `App.tsx:1491`
- `setStatusDropdownOpen` não existe no escopo.
- risco: erro em runtime ao clicar no botão de filtro de segmento.

2. `services/leadService.ts:220`
- atribuição de `string` para `paidValueType` tipado como união restrita.

3. `services/leadService.ts:277`
- objeto parcial sendo tratado como `Lead` completo.

4. `supabaseClient.ts:3-4`
- `import.meta.env` sem tipagem reconhecida (`vite/client` faltando na configuração de tipos).

5. `utils/importLeads.ts:37`
- `Record<Segmento, string[]>` sem chave `Segmento.GENERICO` declarada no literal.

6. `utils/importLeads.ts:203`
7. `utils/importLeads.ts:205`
- atribuições de `string` para campo tipado como `OriginType`.

### Impacto
- build de produção passa, mas há inconsistências de tipagem e risco funcional.
- recomenda-se corrigir esses 7 pontos antes de próxima release.

---

## 14) Segurança e Governança

- App usa `anon key` no frontend (correto para Supabase Client).
- Controle real de acesso depende de:
  - allowlist no frontend;
  - RLS/policies no banco.
- Não há service role key no frontend.
- Script de dedupe usa service role apenas em ambiente controlado.

---

## 15) Checklist funcional (estado atual)

- [x] Login Google + email/senha + reset de senha
- [x] Sync offline-first com fila local
- [x] Dashboard com histórico/sugestões
- [x] Fila de hoje com priorização avançada
- [x] Lista com busca, filtros e paginação
- [x] Edição completa de lead (modal)
- [x] Modo Blitz para operação rápida
- [x] Importação CSV/XLSX
- [x] Exportação CSV/XLSX
- [x] Deduplicação local + RPC
- [x] Soft delete
- [x] RLS + allowlist no Supabase
- [ ] Type-check TS limpo (pendente; ver seção 13)

---

## 16) Próximas ações recomendadas

1. Corrigir os erros de TypeScript listados na seção 13.
2. Adicionar script de CI para bloquear merge com `tsc --noEmit` quebrado.
3. Externalizar allowlist para configuração segura (evitar hardcode duplicado em múltiplos arquivos).
4. Revisar uso de `process.env.GEMINI_API_KEY` em `vite.config.ts` (aparentemente legado).
5. Escrever testes mínimos para:
   - regras de `getQueueStatus`;
   - `getNextContactLevel`;
   - merge/dedupe em `leadService`.


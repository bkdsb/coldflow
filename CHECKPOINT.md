# ColdFlow CRM — Checkpoint (Ultra específico)

Este documento é um checkpoint completo para manutenção, instalação e continuidade do projeto por qualquer pessoa/IA.

---

## 1) Resumo do que o app faz

ColdFlow é um CRM focado em **leads frios** com fluxo contínuo:
- **Fila diária inteligente** (priorização por data/status/valor).
- **Cadastro e edição detalhada** do lead (contatos, origem, segmentação, diagnóstico do site).
- **Importação em massa** (CSV/XLSX) com reconhecimento automático de **origem**, **segmento**, **nota** e **links**.
- **Exportação** (CSV/XLSX) com seleção de segmentos.
- **Sync automático** com Supabase + modo offline/local.
- **Deduplicação** de leads e contatos (merge seguro + botão no app).
- **Dashboard financeiro** com histórico, barras, visão compacta e sugestões inteligentes (helper).
- **Links rápidos** por lead (Maps / Site / WhatsApp).

---

## 2) Stack e arquitetura

### Frontend
- React + Vite + TypeScript
- TailwindCSS
- Lucide icons

### Backend
- **Supabase** (Postgres + Auth + RLS)
- Banco principal: `public.leads` (payload JSONB)
- Histórico: `stats_daily`, `lead_events`, `tracker_daily`
- RPC: `apply_lead_merge` (dedupe server‑side)

---

## 3) Estrutura de pastas (principais)

- `App.tsx`
  Tela principal (login, navbar, fila, lista, filtros, modais, toast).

- `components/DashboardStats.tsx`
  Dashboard com histórico, filtros por período, barras e sugestões.

- `components/LoginScreen.tsx`
  Login Google + Email/Senha + fluxo “Esqueci minha senha”.

- `authConfig.ts`
  Allowlist compartilhada e flags do fluxo de reset.

- `components/LeadModal.tsx`
  Modal completo de edição do lead.

- `components/ImportLeadsModal.tsx`
  Upload CSV/XLSX + preview + regras de importação.

- `components/ExportLeadsModal.tsx`
  Exportação CSV/XLSX com seleção de segmentos.

- `components/WhatsAppIcon.tsx`
  Ícone custom do WhatsApp usado nos botões rápidos.

- `services/leadService.ts`
  **Coração do sync** (local storage + fila + Supabase) + dedupe.

- `utils/importLeads.ts`
  **Lógica de importação** (mapa de colunas, origem, segmento, avaliação).

- `utils/exportLeads.ts`
  **Lógica de exportação** (CSV/XLSX + headers padrão).

- `scripts/dedupe-leads-once.mjs`
  Script de dedupe server‑side (service role) para rodar 1 vez.

- `supabase/schema.sql`
  Schema, políticas RLS, tabelas de histórico e RPC.

- `.env.example`
  Variáveis de ambiente para Supabase.

---

## 4) Auth (Supabase)

### Variáveis obrigatórias
Crie `.env.local` com:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

### OAuth Google
No Supabase:
1) **Auth → Providers → Google**: habilitar.
2) No Google Cloud: adicionar callback  
   `https://<PROJECT>.supabase.co/auth/v1/callback`
3) **Auth → URL Configuration**
   - Site URL: `https://seu-dominio.com`
   - Redirect URLs: adicione domínio prod + `http://localhost:3000`

### Allowlist por e‑mail
Definido em:
- `authConfig.ts` (front)
- `supabase/schema.sql` (RLS)
- `services/leadService.ts` aplica o mesmo allowlist no sync remoto

E‑mails atuais:
- `brunokalebe@gmail.com`
- `bruno@belegante.co`

**IMPORTANTE:** nunca usar `sb_secret` no front‑end.

### Recuperação de senha
- Tela de login tem “Esqueci minha senha”.
- Link de reset é validado (expiração/estado) e o fluxo persiste após refresh.
- Se o link for inválido/expirado, o app mostra aviso e retorna ao login.
- Após redefinir, o usuário é deslogado e precisa entrar novamente.

---

## 5) Banco / Schema (Supabase)

Arquivo: `supabase/schema.sql`

### Extensão
```
create extension if not exists pgcrypto;
```

### Tabela principal
```
public.leads
  id          text (pk)
  updated_at  bigint
  deleted_at  bigint (soft delete)
  payload     jsonb (dados completos do lead)
  created_at  timestamptz default now()
```

### Histórico do dashboard
```
public.stats_daily
  day                    date (pk)
  total_pipeline         double precision
  forecast_hot           double precision
  revenue_realized       double precision
  paid_entry             double precision
  paid_full              double precision
  total_ticket_value     double precision
  total_ticket_count     int
  total_leads            int
  hot_leads              int
  decisor_frio           int
  propostas_enviadas     int
  reunioes_agendadas     int
  pagamentos_feitos      int
  updated_at             timestamptz default now()
```

### Eventos (ações)
```
public.lead_events
  id           uuid (pk)
  lead_id      text
  event_type   text
  occurred_at  timestamptz
  old_status   text
  new_status   text
  meta         jsonb
  created_at   timestamptz
```

### Tracker diário (sugestões)
```
public.tracker_daily
  day                   date (pk)
  contacts_count        int
  callbacks_count       int
  meetings_count        int
  proposals_count       int
  payments_count        int
  next_contacts_count   int
  best_contact_hour     int
  best_contact_count    double precision
  avg_followup_gap_days double precision
  followup_gap_samples  int
  updated_at            timestamptz
```

### RPC (dedupe server‑side)
```
public.apply_lead_merge(primary_id, merged_payload, duplicate_ids)
```

### RLS
Todas as tabelas estão com RLS e allowlist por e‑mail.

---

## 6) Modelo de dados (Lead)

Arquivo: `types.ts`

Campos principais:
- `id`, `updatedAt`, `deletedAt`
- `companyName`
- `decisors[]`, `attendants[]`
- `origin`, `originLink`, `originRating`
- `segment`
- `siteUrl`, `siteState`, `sitePainPoints`
- `status`, `attempts`
- `lastContactDate` (ISO com data+hora), `lastContactPerson`, `channelLastAttempt`
- `nextAttemptDate`, `nextAttemptTime`, `nextAttemptChannel`
- `callbackDate`, `callbackTime`, `callbackRequestedBy`
- `meetingDate`, `meetingTime`, `meetingType`
- `ticketPotential`, `paidValueType`, `paidValueCustom`
- `needsNextContactOverride` (alerta manual)

**Soft delete:**
- Lead removido recebe `deletedAt`.
- UI oculta leads deletados.

**SiteState (normalizado):**
- Não tem site
- Site quebrado
- Site feio/amador
- Site ok
- Site bonito

---

## 7) Sync / Offline (LeadService)

Arquivo: `services/leadService.ts`

### Storage local
Chaves:
- `coldflow_db` (leads)
- `coldflow_queue` (fila de sync)
- `coldflow_events_queue` (fila de eventos)
- `coldflow_last_sync`
- `coldflow_last_full_sync`
- `coldflow_backend_disabled`

### Fluxo
1) UI salva local → fila de sync (`SAVE`/`DELETE`)
2) `processQueue()` envia para Supabase (upsert)
3) Sync incremental:
   - Só executa se passou `MIN_SYNC_INTERVAL_MS`
   - Busca rows com `updated_at > lastSync`
4) Full sync:
   - 1x por dia após `MORNING_SYNC_HOUR`

### Eventos e histórico
- `lead_events` registra mudanças (status, contato, reunião, retorno, etc.)
- `stats_daily` salva snapshot diário (dashboard)
- `tracker_daily` salva métricas diárias para sugestões
- **Delete remoto** usa `update` com `deleted_at` (não sobrescreve `payload`).

### Deduplicação
- Merge automático no save/import
- Botão “Deduplicar” no app
- RPC `apply_lead_merge` quando disponível (fallback local)

---

## 8) Importação CSV/XLSX

Arquivos: `components/ImportLeadsModal.tsx`, `utils/importLeads.ts`

### Formatos aceitos
- `.csv`
- `.xlsx` / `.xls`

### Colunas reconhecidas (auto)
Aliases em `utils/importLeads.ts → HEADER_ALIASES`

### Origem
Por padrão: **Google Maps**
No modal:
- Google Maps, Instagram, Facebook, WhatsApp, Site, Indicação, Outro
- `Outro` permite texto manual

### Segmentação automática
Inferida por palavras‑chave (`SEGMENT_KEYWORDS`).

### Deduplicação durante import
Leads duplicados são **mesclados** no momento da importação.
**Importação não gera histórico** (`lead_events`), pois é tratada como lead novo.

---

## 9) Exportação CSV/XLSX

Arquivos: `components/ExportLeadsModal.tsx`, `utils/exportLeads.ts`

### Formatos
- CSV
- XLSX

### Seleção de segmentos
- “Todos” ou “Selecionar” (multi‑select)

### Colunas exportadas
GOOGLEMAPS, EMPRESA, AVALIAÇÃO, PROFISSÃO, TELEFONE, SITE, ORIGEM, DECISOR, STATUS,  
TICKET, TENTATIVAS, ÚLTIMO CONTATO, PRÓXIMA TENTATIVA, OBSERVAÇÕES

---

## 10) Filtros e lista

Arquivo: `App.tsx`

- Busca global (“Encontrar algo específico”): varre empresa, segmento, decisores/atendentes, telefones, site, origem, status, notas, datas e links. Com texto ativo, **ignora** filtros de status/segmento.
- **Filtro de segmento** (dropdown com checkboxes + busca).
- **Filtro de status** (pills com contagem). Clicar novamente no mesmo status volta para **Novo Lead**.
- Leads com **Próximo contato agendado** saem de **Novo Lead** e entram no filtro **Próximo contato**, mesmo sem mudar o status.
- Se o lead for **Novo Lead** mas tiver **Próximo contato agendado**, o badge de status “Novo Lead” não aparece — fica **apenas** o badge de Próximo contato.
- Status padrão: **Novo Lead**.
- “Tentar em 30 dias” aparece em “Todos”, mas fica **no final**.
- “Não tentar mais” fica **no final**.
- Leads com status **Não tentar mais** não aparecem em **Próximo contato** (mesmo se agendado) e só entram em “Todos” (no final) ou no próprio filtro.
- Lista paginada (padrão 10, opções 10/20/30 com persistência local).
- Colunas da tabela incluem **Último Contato** e **Próximo Contato**.
- Filtro “Próximo contato” mostra **pendentes** e **agendados**.
- No filtro “Próximo contato”, a lista é ordenada por **data/hora mais próxima primeiro**: agendados primeiro (data/hora do retorno/reunião/tentativa), depois pendentes usando `lastContactDate`.
- **Próximo Contato (coluna)**: prioridade visual **Reunião agendada > Retorno agendado > Próxima tentativa** (badge + data/hora).
- **Badges de Próximo contato**:
  - **Agendado**: `nextAttemptDate` definido (próxima tentativa) → badge “Próximo contato agendado” (azul).
  - **Pendente**: sem `nextAttemptDate`/`callbackDate`/`meetingDate` → badge “Próximo contato pendente” (âmbar).
  - Pendente só aparece quando `lastContactDate` existe, status não é avançado (reunião/proposta enviada/aceita/não tentar mais) e o contato foi nos **últimos 7 dias**.
  - Intensidade: 0–2 dias = leve (a menos que o score ≥ limiar), 3–7 dias = forte.
  - `needsNextContactOverride` força badge forte.
  - Score do alerta = `attempts` (máx 4) + peso do status (decisor interessado = +2; decisor frio/decisor não atendeu = +1).
  - Limiar padrão: **4** (arquivo `utils.ts`).

---

## 11) UI / Seções

### Navbar
- ColdFlow sempre visível + sync minimalista.

### Fila do dia
- `getQueueStatus()` + `calculatePriorityScore()`.
- Ordem de prioridade (Queue):
  1) **Reunião** (`meetingDate`) — passada → urgente; hoje → prioridade máxima
  2) **Retorno** (`callbackDate`) — atrasado → urgente; hoje → prioridade; se hora vencida → urgente
  3) **Proposta enviada** — **apenas** se `nextAttemptDate` existir e for hoje/atrasado
  4) **Decisor interessado** — entra quando `nextAttemptDate` <= hoje
  5) **Follow‑up geral** — `nextAttemptDate` <= hoje (exceto Não tentar mais / Tentar em 30 / Proposta aceita)
  6) **Tentar em 30 dias** — só quando a data chega (hoje/atrasado)
- Fila é ordenada por `sortOrder` + **score de prioridade**.
- Quando há horário definido **hoje**, ordena por hora (com hora primeiro; sem hora depois).
- Cards da fila exibem **badge de horário** quando há `meetingTime`, `callbackTime` ou `nextAttemptTime` (follow‑up/proposta/interessado/tentar em 30).
- “Não tentar mais” fica sempre no fim (fora da fila).

### Mecanismo inteligente (priorização)
- `getQueueStatus()` classifica o lead em reunião/retorno/proposta/interessado/follow‑up/tentar em 30 com base nas datas.
- `calculatePriorityScore()` soma pesos (ticket, status, datas, qualidade do site e dores) para ordenar dentro do mesmo grupo.
- Ordenação final: `sortOrder` → horário (se hoje) → score.
- Ajustes de pesos e limiares ficam em `utils.ts`.

### Prioridade (score)
Arquivo: `utils.ts`
- **Ticket**: ≥ 4500 (+25), ≥ 2500 (+15), ≥ 1600 (+8), >0 (+4)
- **Status**:
  - Reunião marcada (+35)
  - Proposta enviada (+25)
  - Decisor interessado (+20)
  - Decisor frio (+6)
  - Decisor não atendeu (+2)
  - Proposta aceita (+5)
  - Tentar em 30 dias (−8)
  - Não tentar mais (−50)
- **Reunião (data)**: passada (+30), hoje (+35), amanhã (+28), ≤3 dias (+20), ≤7 dias (+12), >7 dias (+6)
- **Retorno (data)**: passado (+18), hoje (+16), amanhã (+12), ≤3 dias (+8), ≤7 dias (+4)
- **Qualidade do site**: sem site (+20), quebrado (+14), ruim (+8), ok (+2)
- **Dores do site**: +3 por dor (máx 4 dores)
- **Extras**:
  - Retorno pedido pelo decisor (+10)
  - Nome do decisor preenchido (+6)
  - Ticket alto + interessado + retorno (+20)
  - Ticket alto + retorno após 2+ tentativas (+15)
  - Sem site + ticket alto + retorno após 2+ tentativas (+25)
  - Sem site + ticket alto + reunião → score mínimo 110
- Score mínimo é 0.

### Ordenação na lista (prioridade visual)
- Grupo 0: status normais (topo)
- Grupo 1: **Tentar em 30 dias** (ordenado por `nextAttemptDate`)
- Grupo 2: **Não tentar mais**
- Dentro do mesmo grupo: **score desc**, depois `updatedAt` desc.

### Lista completa
- Tabela desktop + cards mobile.
- Header sticky.
- Botões rápidos por lead: Maps / Site / WhatsApp.
- Botão **Deduplicar** (topo da lista).
- **Próximo Contato** na lista sempre mostra **Reunião** / **Retorno** / **Próxima tentativa** (nesta ordem). 

### Modais
- LeadModal (edição)
- ConfirmationModal (exclusão/logout/dedupe)
- ImportLeadsModal
- ExportLeadsModal

### Script & Diagnóstico (LeadModal)
- Aba **Script & Diag.** com script auto + manual.
- **Auto (completo)** é gerado em `utils.ts → generateDiagnosticScript` com fluxo **ABERTURA → PERMISSÃO → CONTEXTO + ANÁLISE (consultor) → DOR/Oportunidade → PROPOSTA → BENEFÍCIOS → CTA**.
- **Manual (micro)** é a versão curta editável; alternar entre modos não apaga o rascunho.
- Auto usa: empresa, segmento, tempo de empresa, rating, estado/URL do site e **incrementador de dor** (pain points + estado do site).
- Regra do tempo de empresa:
  - **10+ anos**: legado/autoridade + digital à altura da história.
  - **<10 anos**: crescimento/escala + competição com quem já tem presença forte.
- CTA com horários sugeridos fixos (hoje 15h30 / amanhã 08h30).

### Notificações
- Sem `alert` nativo; feedback via **toast discreto**.

---

## 12) Dashboard & Sugestor

Arquivo: `components/DashboardStats.tsx`

- Barras financeiras: **Em negociação / Alta chance / Fechados / Recebido / Sinal**
- Toggle de visão: geral ↔ receita estimada
- Filtros de período: Hoje / 7 dias / 30 dias / Tudo
- Eventos contam: propostas, reuniões, pagamentos, follow‑ups
- “Pagamentos feitos” só conta quando há valor pago (> 0).
- Para 7d/30d/Tudo, se `lead_events` estiver vazio/incompleto, o dashboard faz **fallback** para dados atuais (não zera).
- **Propostas enviadas** contam **somente** status `Proposta enviada` (Proposta aceita não entra).

### Sugestões inteligentes (helper)
Baseadas em `lead_events` + `tracker_daily`:
- Melhor horário histórico
- Cadência sugerida (média de follow‑up)
- Taxa de avanço para reunião
- Próximos contatos definidos
- **Peso temporal**: eventos recentes têm mais peso (half‑life ≈ 21 dias).
- **Confiança**: baixa/média/alta conforme volume de amostras.
- Só exibe sugestões quando há dados mínimos (ex: ≥6 contatos para taxa de avanço).
- Máx de 3 sugestões na visão geral (2 na compacta).
- **Melhor horário** usa apenas contatos com hora definida no operacional (`lastContactDate` com hora). Se não houver hora, não influencia no melhor horário.
- Cada sugestão exibe **quantos eventos** foram usados + tooltip com a base (ex.: contacted / next_attempt_set).

Se não houver dados suficientes:
- “Ainda não há dados suficientes.”

---

## 13) Deduplicação (detalhes)

### Critério atual
Lead duplicado se:
- **Nome normalizado igual** +
- **Telefone OU site OU link de origem iguais**

### Botão no app
- “Deduplicar” → analisa grupos → confirma
- Merge + soft delete duplicados

### RPC (server‑side)
- `apply_lead_merge` garante merge atômico no Supabase

### Script único
- `scripts/dedupe-leads-once.mjs`
- Útil para limpeza inicial com service role

---

## 14) Como instalar e rodar

1) `npm install`
2) Criar `.env.local` com:
```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```
3) Executar `supabase/schema.sql` no Supabase SQL Editor
4) `npm run dev`

---

## 15) Segurança

- **Nunca** usar `sb_secret` no frontend.
- RLS + allowlist são a proteção real.
- RPC verifica e‑mail antes de executar merge.

---

## 16) Ajustes comuns

- Horário do full sync: `MORNING_SYNC_HOUR` em `services/leadService.ts`
- Intervalo incremental: `MIN_SYNC_INTERVAL_MS`
- Segmentos (import): `SEGMENT_KEYWORDS`
- Origens (import): `detectOriginFromLink` / `detectOriginFromText`
- Tamanho da página: `PAGE_SIZE_OPTIONS` em `App.tsx`
- Colunas exportadas: `utils/exportLeads.ts`
- Allowlist e auth flags: `authConfig.ts`
- Regras do **Próximo contato** (pendente): `utils.ts → getNextContactLevel`
- Labels/cores de badge de próximo contato: `App.tsx → getNextContactBadgeInfo`
- Lógica da fila e horários: `utils.ts → getQueueStatus`
- Busca global: `App.tsx → buildSearchableText` / `leadMatchesSearch`
- Script (auto/micro): `utils.ts → generateDiagnosticScript`

---

## 17) Status atual

- ✅ Migração Supabase + RLS
- ✅ Soft delete + sync automático
- ✅ Importação CSV/XLSX
- ✅ Exportação CSV/XLSX
- ✅ Origem + avaliação detectadas
- ✅ Filtro multi‑segmento + status em pills com contagem
- ✅ Campo “Link do Site” no Diagnóstico
- ✅ Lista paginada + header sticky
- ✅ SiteState enxuto + normalização
- ✅ Modal operacional reorganizado
- ✅ Dashboard com toggle + termos BR
- ✅ Eventos + histórico (`lead_events`, `stats_daily`)
- ✅ Deduplicação local + RPC (`apply_lead_merge`)
- ✅ Tracker diário (`tracker_daily`) + sugestões inteligentes
- ✅ Toasts (sem alert)
- ✅ Busca global que ignora filtros quando há texto
- ✅ Badges “Próximo contato” (agendado x pendente)
- ✅ Recuperação de senha com validação de link
- ✅ Script consultivo auto/micro com tempo de empresa

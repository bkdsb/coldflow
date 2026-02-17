import { Lead, LeadStatus, Priority, QueueItem, Segmento, SiteState, TicketValue, SitePainPoint, ContactPersonType } from './types';

// --- GOOGLE CALENDAR HELPER ---
export const getGoogleCalendarLink = (title: string, details: string, date: string | null, time: string | null) => {
  if (!date || !time) return '#';
  
  const startDateTime = new Date(`${date}T${time}`);
  const endDateTime = new Date(startDateTime.getTime() + 60 * 60 * 1000); 

  const formatDate = (d: Date) => d.toISOString().replace(/-|:|\.\d\d\d/g, "");

  const baseUrl = "https://calendar.google.com/calendar/render?action=TEMPLATE";
  const text = `&text=${encodeURIComponent(title)}`;
  const dates = `&dates=${formatDate(startDateTime)}/${formatDate(endDateTime)}`;
  const desc = `&details=${encodeURIComponent(details)}`;
  
  return `${baseUrl}${text}${dates}${desc}`;
};

// --- FINANCIAL HELPERS ---
export const getTicketNumericValue = (ticketString: string | undefined): number => {
  if (!ticketString) return 0;
  const match = ticketString.match(/R\$\s?([\d\.]+)/);
  if (match) {
    return parseInt(match[1].replace(/\./g, ''));
  }
  const fallbackDigits = ticketString.replace(/[^\d]/g, '');
  if (!fallbackDigits) return 0;
  return parseInt(fallbackDigits, 10);
};

export const formatCurrency = (value: number) => {
  return value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
};

const normalizeText = (value: string) => (
  value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
);

export const normalizeSiteState = (state?: string | SiteState): SiteState | '' => {
  if (!state) return '';
  if (Object.values(SiteState).includes(state as SiteState)) return state as SiteState;
  const normalized = normalizeText(String(state));
  if (!normalized) return '';
  if (normalized.includes('offline') || normalized.includes('nao tem')) return SiteState.NAO_TEM;
  if (normalized.includes('nao funcional') || normalized.includes('quebrado')) return SiteState.QUEBRADO;
  if (normalized.includes('horrivel') || normalized.includes('feio') || normalized.includes('amador')) return SiteState.RUIM;
  if (normalized.includes('ok')) return SiteState.OK;
  if (normalized.includes('bom') || normalized.includes('bonito')) return SiteState.BOM;
  return state as SiteState;
};

export const calculateDownPayment = (ticketString: string | undefined): string | null => {
  const val = getTicketNumericValue(ticketString);
  if (val === 0) return null;
  const downPayment = val * 0.40;
  return formatCurrency(downPayment);
};

export const getPaidAmount = (lead: Lead): number => {
  const ticket = getTicketNumericValue(lead.ticketPotential);
  const type = lead.paidValueType;
  if (!type) return 0;
  if (type === 'Inteiro') return ticket;
  if (type === 'Sinal') return ticket * 0.40;
  if (type === 'Outro') return lead.paidValueCustom ? Number(lead.paidValueCustom) : 0;
  return 0;
};

// --- PRIORITY ENGINE ---
export const calculatePriority = (lead: Lead): Priority => {
  const status = lead.status;
  const siteState = normalizeSiteState(lead.siteState);
  
  if (
    status === LeadStatus.REUNIAO_MARCADA ||
    status === LeadStatus.PROPOSTA_ENVIADA ||
    status === LeadStatus.PROPOSTA_ACEITA
  ) {
    return Priority.ALTA;
  }

  if (status === LeadStatus.DECISOR_INTERESSADO) {
    return Priority.MEDIA;
  }

  const ticketValue = getTicketNumericValue(lead.ticketPotential);
  
  // High Pain Points increase priority
  const hasManyPainPoints = lead.sitePainPoints && lead.sitePainPoints.length >= 2;
  const isBadSite = siteState === SiteState.QUEBRADO || siteState === SiteState.NAO_TEM || siteState === SiteState.RUIM;

  if (
    status === LeadStatus.DECISOR_FRIO ||
    status === LeadStatus.DECISOR_NAO_ATENDEU ||
    status === LeadStatus.TENTAR_EM_30
  ) {
    if ((isBadSite || hasManyPainPoints) && ticketValue >= 3000 && lead.attempts <= 3) {
      return Priority.MEDIA;
    }
    return Priority.BAIXA;
  }

  if (ticketValue >= 3000 || isBadSite) {
    return Priority.MEDIA;
  }

  return Priority.MEDIA;
};

const getDaysUntil = (dateStr: string | null) => {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return null;
  const target = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
};

export const calculatePriorityScore = (lead: Lead): number => {
  let score = 0;
  const ticket = getTicketNumericValue(lead.ticketPotential);
  const highTicket = ticket >= 4500;
  const hasMeeting = !!lead.meetingDate;
  const hasCallback = !!lead.callbackDate;
  const decisorInterested = lead.status === LeadStatus.DECISOR_INTERESSADO;
  // Assume re-agendamento when a callback exists and there was more than 1 attempt.
  const decisorRescheduled = hasCallback && lead.attempts >= 2;
  const siteState = normalizeSiteState(lead.siteState);
  const noSite = siteState === SiteState.NAO_TEM;

  if (ticket >= 4500) score += 25;
  else if (ticket >= 2500) score += 15;
  else if (ticket >= 1600) score += 8;
  else if (ticket > 0) score += 4;

  switch (lead.status) {
    case LeadStatus.REUNIAO_MARCADA:
      score += 35;
      break;
    case LeadStatus.PROPOSTA_ENVIADA:
      score += 25;
      break;
    case LeadStatus.DECISOR_INTERESSADO:
      score += 20;
      break;
    case LeadStatus.DECISOR_FRIO:
      score += 6;
      break;
    case LeadStatus.DECISOR_NAO_ATENDEU:
      score += 2;
      break;
    case LeadStatus.TENTAR_EM_30:
      score -= 8;
      break;
    case LeadStatus.NAO_TENTAR_MAIS:
      score -= 50;
      break;
    case LeadStatus.PROPOSTA_ACEITA:
      score += 5;
      break;
    default:
      break;
  }

  const meetingDays = getDaysUntil(lead.meetingDate);
  if (meetingDays !== null) {
    if (meetingDays < 0) score += 30;
    else if (meetingDays === 0) score += 35;
    else if (meetingDays === 1) score += 28;
    else if (meetingDays <= 3) score += 20;
    else if (meetingDays <= 7) score += 12;
    else score += 6;
  }

  const callbackDays = getDaysUntil(lead.callbackDate);
  if (callbackDays !== null) {
    if (callbackDays < 0) score += 18;
    else if (callbackDays === 0) score += 16;
    else if (callbackDays === 1) score += 12;
    else if (callbackDays <= 3) score += 8;
    else if (callbackDays <= 7) score += 4;
  }

  if (lead.callbackRequestedBy === ContactPersonType.DECISOR) score += 10;
  if (lead.decisors?.[0]?.name) score += 6;

  if (noSite) score += 20;
  else if (siteState === SiteState.QUEBRADO) score += 14;
  else if (siteState === SiteState.RUIM) score += 8;
  else if (siteState === SiteState.OK) score += 2;

  const painCount = lead.sitePainPoints?.length || 0;
  score += Math.min(painCount, 4) * 3;

  if (highTicket && decisorInterested && hasCallback) score += 20;
  if (highTicket && decisorRescheduled) score += 15;
  if (noSite && highTicket && decisorRescheduled) score += 25;
  if (noSite && highTicket && hasMeeting) score = Math.max(score, 110);

  return Math.max(score, 0);
};

// --- PAIN POINT TRANSLATOR (The Expert Logic) ---
const getPainPointImplication = (pain: SitePainPoint): string => {
  switch (pain) {
    case SitePainPoint.LENTO:
      return "Lentidão gera abandono (cliente decide em 3 segundos).";
    case SitePainPoint.BOTOES_QUEBRADOS:
      return "Botões não funcionam (frustração imediata no usuário).";
    case SitePainPoint.NAO_RESPONSIVO:
      return "Não abre bem no celular (onde está a maioria das buscas).";
    case SitePainPoint.TEMPLATE_GENERICO:
      return "Visual genérico não transmite a autoridade real da empresa.";
    case SitePainPoint.CORES_AMADORAS:
      return "Identidade visual amadora diminui a percepção de valor.";
    case SitePainPoint.LAYOUT_QUEBRADO:
      return "Desorganização visual passa imagem de descuido.";
    case SitePainPoint.DESORGANIZACAO:
      return "Informação bagunçada confunde e reduz a taxa de contato.";
    case SitePainPoint.SEM_CTA:
      return "Sem CTA claro, o visitante não sabe o próximo passo.";
    case SitePainPoint.SEM_SSL:
      return "Site sem SSL mostra “não seguro”, derruba confiança e reduz contatos.";
    case SitePainPoint.BLOG_PARADO:
      return "Blog parado transmite impressão de abandono; se não houver rotina de atualização, é melhor remover e focar em páginas essenciais.";
    default:
      return "";
  }
}

const getSiteStateImplication = (state?: string | SiteState): string => {
  const normalized = normalizeSiteState(state);
  switch (normalized) {
    case SiteState.NAO_TEM:
      return "Sem site você perde buscas locais e fica invisível para quem pesquisa agora.";
    case SiteState.QUEBRADO:
      return "Quando o site falha, o cliente desiste na primeira tentativa.";
    case SiteState.RUIM:
      return "Visual amador passa insegurança e derruba a taxa de contato.";
    case SiteState.OK:
      return "O site está ok, mas falta conversão clara para virar contato.";
    case SiteState.BOM:
      return "O visual é bom, mas pequenos ajustes aumentam conversão.";
    default:
      return "";
  }
};

// --- DIAGNOSTIC ENGINE ---
export const generateDiagnosticScript = (lead: Lead, variant: 'full' | 'micro' = 'full'): string => {
  const { segment, companyName, siteState, sitePainPoints, siteUrl, originRating, yearsInBusiness } = lead;

  if (!segment || !companyName) {
    return "Preencha Segmento e Empresa para gerar o diagnóstico.";
  }

  const n = "\n";
  const normalizedSiteState = normalizeSiteState(siteState);
  const inferredNoSite = normalizedSiteState === SiteState.NAO_TEM || (!siteUrl && !normalizedSiteState);
  const effectiveSiteState = inferredNoSite ? SiteState.NAO_TEM : normalizedSiteState;

  const years = Number(yearsInBusiness || 0);
  const validYears = Number.isFinite(years) && years > 0;
  const yearsLine = validYears ? `Há ${years} ano${years === 1 ? '' : 's'} no mercado.` : '';
  const yearsInsightLine = validYears
    ? years > 5
      ? `Esse tempo de mercado já traz legado, confiança e estrutura; o digital precisa refletir essa autoridade e converter melhor quem ainda não conhece o nome de vocês.`
      : `Esse tempo de mercado pede crescimento e reconhecimento, e o digital ajuda a competir com quem já é “macaco velho” no online.`
    : '';

  const getSegmentMeta = (current: Segmento | string) => {
    switch (current) {
      case Segmento.ADVOGADOS:
        return {
          sectorLabel: 'jurídico',
          searchTerm: 'advogado ou serviços jurídicos na sua região',
          businessLabel: 'escritório',
          businessArticle: 'o',
          authorityTail: ' — especialmente jurídico'
        };
      case Segmento.CONTABILIDADE:
        return {
          sectorLabel: 'contábil',
          searchTerm: 'contabilidade ou contador na sua região',
          businessLabel: 'escritório',
          businessArticle: 'o',
          authorityTail: ' — especialmente contábil'
        };
      case Segmento.MEDICOS:
      case Segmento.ODONTO:
      case Segmento.CLINICAS:
      case Segmento.ESTETICA:
        return {
          sectorLabel: 'saúde',
          searchTerm: 'clínica ou profissional de saúde na sua região',
          businessLabel: 'clínica',
          businessArticle: 'a',
          authorityTail: ' — especialmente saúde'
        };
      case Segmento.IMOBILIARIA:
        return {
          sectorLabel: 'imobiliário',
          searchTerm: 'imobiliária ou imóveis na sua região',
          businessLabel: 'imobiliária',
          businessArticle: 'a',
          authorityTail: ''
        };
      case Segmento.TECNOLOGIA:
        return {
          sectorLabel: 'tecnologia',
          searchTerm: 'solução de software na sua região',
          businessLabel: 'empresa',
          businessArticle: 'a',
          authorityTail: ''
        };
      case Segmento.ENGENHARIA:
      case Segmento.INDUSTRIA:
      case Segmento.LOGISTICA:
      case Segmento.SERVICOS_B2B:
        return {
          sectorLabel: 'B2B',
          searchTerm: 'fornecedor ou serviço B2B na sua região',
          businessLabel: 'empresa',
          businessArticle: 'a',
          authorityTail: ''
        };
      case Segmento.AGRICOLA:
      case Segmento.AGRONEGOCIO:
      case Segmento.PECUARIA:
        return {
          sectorLabel: 'agro',
          searchTerm: 'fornecedores do agro na sua região',
          businessLabel: 'empresa',
          businessArticle: 'a',
          authorityTail: ''
        };
      case Segmento.RESTAURANTE:
        return {
          sectorLabel: 'alimentação',
          searchTerm: 'restaurante na sua região',
          businessLabel: 'restaurante',
          businessArticle: 'o',
          authorityTail: ''
        };
      case Segmento.HOTELARIA:
        return {
          sectorLabel: 'hotelaria',
          searchTerm: 'hotel ou hospedagem na sua região',
          businessLabel: 'hotel',
          businessArticle: 'o',
          authorityTail: ''
        };
      case Segmento.ACADEMIA:
        return {
          sectorLabel: 'fitness',
          searchTerm: 'academia na sua região',
          businessLabel: 'academia',
          businessArticle: 'a',
          authorityTail: ''
        };
      case Segmento.ESCOLA:
        return {
          sectorLabel: 'educação',
          searchTerm: 'escola ou curso na sua região',
          businessLabel: 'escola',
          businessArticle: 'a',
          authorityTail: ''
        };
      case Segmento.JARDIM:
        return {
          sectorLabel: 'jardinagem',
          searchTerm: 'paisagismo ou jardinagem na sua região',
          businessLabel: 'empresa',
          businessArticle: 'a',
          authorityTail: ''
        };
      case Segmento.GENERICO:
        return {
          sectorLabel: 'seu segmento',
          searchTerm: 'serviço na sua região',
          businessLabel: 'empresa',
          businessArticle: 'a',
          authorityTail: ''
        };
      default: {
        const label = String(current || 'seu segmento');
        return {
          sectorLabel: label,
          searchTerm: `${label} na sua região`,
          businessLabel: 'empresa',
          businessArticle: 'a',
          authorityTail: ''
        };
      }
    }
  };

  const segmentMeta = getSegmentMeta(segment);
  const businessRef = `${segmentMeta.businessArticle} ${segmentMeta.businessLabel}`;

  const siteObservation = (() => {
    if (inferredNoSite) return "não encontrei o site ativo";
    switch (effectiveSiteState) {
      case SiteState.QUEBRADO:
        return "o site abre com erro ou não carrega bem";
      case SiteState.RUIM:
        return "o site parece desatualizado e não transmite confiança";
      case SiteState.OK:
        return "o site existe, mas não deixa claro o próximo passo";
      case SiteState.BOM:
        return "o visual é bom, mas ainda dá para converter mais";
      default:
        return siteUrl ? "o site existe, mas a presença ainda está pouco clara" : "a presença digital está discreta";
    }
  })();

  const ratingLine = (() => {
    if (typeof originRating !== 'number') return '';
    const prefix = validYears ? 'Além disso, ' : '';
    const subject = prefix ? 'vocês' : 'Vocês';
    if (originRating >= 4.7) {
      return `${prefix}${subject} têm excelentes avaliações, nota ${originRating.toFixed(1).replace('.', ',')} no Google! Parabéns mesmo, isso mostra que o trabalho é muito bem-feito.`;
    }
    if (originRating >= 4) {
      return `${prefix}${subject} têm boas avaliações no Google. Parabéns, isso mostra que o trabalho é consistente.`;
    }
    return '';
  })();

  const painImplications = (sitePainPoints || [])
    .map((p) => getPainPointImplication(p))
    .filter(Boolean);
  const fallbackPain = getSiteStateImplication(effectiveSiteState);
  const finalPainPoints = [...painImplications];
  if (fallbackPain && !finalPainPoints.includes(fallbackPain)) {
    finalPainPoints.push(fallbackPain);
  }
  if (finalPainPoints.length === 0 && siteObservation) {
    finalPainPoints.push(`Presença digital: ${siteObservation}.`);
  }
  const painBlock = finalPainPoints.length > 0
    ? `ANÁLISE RÁPIDA (CONSULTOR):${n}${finalPainPoints.slice(0, 3).map((text) => `• ${text}`).join(n)}`
    : "";

  const opening = `1. ABERTURA (personalizada e simpática):${n}"Oi [Nome], tudo bem? Aqui é o Bruno da BELEGANTE_. Trabalho ajudando empresas do setor ${segmentMeta.sectorLabel} a fortalecer a presença digital e atrair mais clientes pelo Google."${n}${n}`;
  const permission = `2. QUEBRA DE OBJEÇÃO INICIAL (permissão):${n}"Peguei você num momento tranquilo pra falar por 2 minutinhos ou prefere que eu ligue em outro horário?"${n}${n}`;
  const contextLines = [
    `Estava analisando a ${companyName}.`,
    yearsLine,
    yearsInsightLine,
    ratingLine,
    `Só que notei uma coisa: ${siteObservation}.`,
    `E hoje, segundo a pesquisa mais recente da Hedgehog + OpinionBox, 7 em cada 10 pessoas pesquisam no Google antes de contratar qualquer serviço${segmentMeta.authorityTail}.`
  ].filter(Boolean).join(n);
  const context = `3. GATILHO DE CONTEXTO E AUTORIDADE:${n}${contextLines}${n}${painBlock ? `${n}${painBlock}` : ''}${n}${n}`;
  const painOpportunity = `4. DOR E OPORTUNIDADE (sem parecer crítica):${n}` +
    `Então, na prática, quem pesquisa "${segmentMeta.searchTerm}" no Google provavelmente acaba encontrando concorrentes que têm site e conteúdo ativo.` +
    ` E quando isso acontece, mesmo quem ouviu sobre vocês pode ter dificuldade de achar informações confiáveis ou entrar em contato.${n}${n}`;
  const value = `5. POSICIONAMENTO PESSOAL E PROPOSTA DE VALOR:${n}` +
    `Eu ajudo empresas como a de vocês a aparecerem bem posicionadas e transmitirem autoridade, deixando a parte digital alinhada com a força que vocês já têm presencialmente — sem contrato longo e sem prometer milagre.${n}${n}`;
  const benefits = `6. BENEFÍCIOS RÁPIDOS (econômicos e visuais):${n}` +
    `• Mais pessoas encontrando ${businessRef} pelo nome e pelo serviço${n}` +
    `• Um canal direto de contato via WhatsApp${n}` +
    `• Uma imagem profissional que transmite credibilidade imediata no Google${n}${n}`;
  const cta = `7. FECHAMENTO COM MICROCOMPROMISSO (CTA):${n}` +
    `"Não quero vender nada por telefone — posso te mostrar em 15 minutos o diagnóstico do que já vi do Google de vocês e duas ou três melhorias possíveis. Se fizer sentido, a gente conversa sobre os próximos passos.` +
    ` Pode ser hoje às 15h30 ou amanhã às 08h30, qual horário te encaixa melhor?"`;

  const primaryPain = finalPainPoints[0] || siteObservation;
  const microContext = [
    `Estava analisando a ${companyName}.`,
    yearsLine,
    yearsInsightLine,
    ratingLine
  ].filter(Boolean).join(n);

  const microHeading = inferredNoSite ? "ABORDAGEM (SEM SITE - MICRO)" : "ABORDAGEM (MICRO)";
  const microScript = `${microHeading}:${n}------------------------------${n}` +
    `ABERTURA:${n}"Oi [Nome], tudo bem? Aqui é o Bruno da BELEGANTE_. Trabalho com empresas do setor ${segmentMeta.sectorLabel}."${n}` +
    `PERMISSÃO:${n}"Posso ser direto em 30 segundos?"${n}${n}` +
    `ANÁLISE:${n}• ${primaryPain}${n}${n}` +
    `CONTEXTO:${n}${microContext}${n}${n}` +
    `PROPOSTA:${n}"Eu alinho o digital para gerar mais contato e confiança, sem contrato longo, sem marketing digital, sem tráfego pago, apenas reposicionamento de autoridade e confiança online através do site."${n}${n}` +
    `CTA:${n}"Posso te mostrar em 10 a 15 minutos o diagnóstico do que já vi? Pode ser hoje às 15h30 ou amanhã às 08h30?"`;

  const heading = inferredNoSite ? "ABORDAGEM (SEM SITE)" : "ABORDAGEM (CONSULTIVA)";
  const fullScript = `${heading}:${n}------------------------------${n}${opening}${permission}${context}${painOpportunity}${value}${benefits}${cta}`;

  return variant === 'micro' ? microScript : fullScript;
};

// --- NEXT CONTACT ALERT ---
const NEXT_CONTACT_ADVANCED_STATUSES = new Set<LeadStatus>([
  LeadStatus.REUNIAO_MARCADA,
  LeadStatus.PROPOSTA_ENVIADA,
  LeadStatus.PROPOSTA_ACEITA,
  LeadStatus.NAO_TENTAR_MAIS
]);
const DEFAULT_NEXT_CONTACT_THRESHOLD = 4;

export const getNextContactLevel = (
  lead: Lead,
  options?: { threshold?: number }
): 'none' | 'light' | 'strong' => {
  if (lead.needsNextContactOverride) return 'strong';
  if (!lead.lastContactDate) return 'none';
  if (lead.nextAttemptDate || lead.callbackDate || lead.meetingDate) return 'none';
  if (NEXT_CONTACT_ADVANCED_STATUSES.has(lead.status as LeadStatus)) return 'none';

  const dateStr = lead.lastContactDate.includes('T')
    ? lead.lastContactDate.split('T')[0]
    : lead.lastContactDate;
  const [year, month, day] = dateStr.split('-').map(Number);
  if (!year || !month || !day) return 'none';
  const lastContact = new Date(year, month - 1, day);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  lastContact.setHours(0, 0, 0, 0);
  const diffMs = today.getTime() - lastContact.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0 || diffDays > 7) return 'none';

  const threshold = options?.threshold ?? DEFAULT_NEXT_CONTACT_THRESHOLD;
  const statusWeight =
    lead.status === LeadStatus.DECISOR_INTERESSADO
      ? 2
      : lead.status === LeadStatus.DECISOR_FRIO || lead.status === LeadStatus.DECISOR_NAO_ATENDEU
        ? 1
        : 0;
  const attemptsWeight = Math.min(lead.attempts || 0, 4);
  const score = attemptsWeight + statusWeight;
  if (score >= threshold) return 'strong';
  if (diffDays <= 2) return 'light';
  return 'strong';
};

// --- QUEUE LOGIC (Fila Hoje) ---
export const getQueueStatus = (lead: Lead): QueueItem | null => {
  if (lead.status === LeadStatus.NAO_TENTAR_MAIS) return null;
  // Use local browser date string matching the <input type="date"> format (YYYY-MM-DD)
  const getTodayStr = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const normalizeDateKey = (value?: string | null) => {
    if (!value) return '';
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    if (trimmed.includes('T')) {
      const [datePart] = trimmed.split('T');
      if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) return datePart;
    }
    const slashMatch = trimmed.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (slashMatch) return `${slashMatch[3]}-${slashMatch[2]}-${slashMatch[1]}`;
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return '';
    const year = parsed.getFullYear();
    const month = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const todayStr = getTodayStr(); 
  const now = new Date();
  const getTimeMeta = (date?: string | null, time?: string | null) => {
    if (!date || date !== todayStr) return { timeSort: undefined, hasTime: false };
    if (!time) return { timeSort: 9999, hasTime: false };
    const [h, m] = time.split(':').map(Number);
    if (!Number.isFinite(h) || !Number.isFinite(m)) return { timeSort: 9999, hasTime: false };
    return { timeSort: h * 60 + m, hasTime: true };
  };

  const meetingDate = normalizeDateKey(lead.meetingDate);
  const callbackDate = normalizeDateKey(lead.callbackDate);
  const nextAttemptDate = normalizeDateKey(lead.nextAttemptDate);

  // 1. MEETINGS (CRITICAL)
  if (meetingDate) {
    if (meetingDate < todayStr) {
      return { leadId: lead.id, message: "⚠️ REUNIÃO PASSADA – VERIFICAR", type: 'urgent', sortOrder: 0, kind: 'meeting' };
    }
    if (meetingDate === todayStr) {
      const timeMeta = getTimeMeta(meetingDate, lead.meetingTime);
      return { leadId: lead.id, message: "🔴 REUNIÃO HOJE – PRIORIDADE", type: 'urgent', sortOrder: 1, kind: 'meeting', ...timeMeta };
    }
  }

  // 2. CALLBACKS (HIGH PRIORITY)
  if (callbackDate) {
    // 2a. Date is explicitly in the past
    if (callbackDate < todayStr) {
       return { leadId: lead.id, message: "RETORNO ATRASADO – PRIORIDADE", type: 'urgent', sortOrder: 1.5, kind: 'callback' };
    }
    
    // 2b. Date is Today
    if (callbackDate === todayStr) {
       if (lead.callbackTime) {
          const [h, m] = lead.callbackTime.split(':').map(Number);
          const cbTime = new Date();
          cbTime.setHours(h, m, 0); // Set today's date with callback time
          
          // Strict check: if current time > scheduled time, it is OVERDUE
          if (cbTime < now) {
             const timeMeta = getTimeMeta(callbackDate, lead.callbackTime);
             return { leadId: lead.id, message: `🛑 RETORNO ATRASADO (${lead.callbackTime})`, type: 'urgent', sortOrder: 1.6, kind: 'callback', ...timeMeta };
          }
          
          // Future today
          const timeMeta = getTimeMeta(callbackDate, lead.callbackTime);
          return { leadId: lead.id, message: `RETORNO HOJE ÀS ${lead.callbackTime}`, type: 'warning', sortOrder: 2.1, kind: 'callback', ...timeMeta };
       }
       // No time, just today
       const timeMeta = getTimeMeta(callbackDate, lead.callbackTime);
       return { leadId: lead.id, message: "RETORNO HOJE – PRIORIDADE MÁXIMA", type: 'warning', sortOrder: 2, kind: 'callback', ...timeMeta };
    }
  }

  // 3. PROPOSALS (FOLLOW-UP)
  if (lead.status === LeadStatus.PROPOSTA_ENVIADA && nextAttemptDate) {
    if (nextAttemptDate < todayStr) {
      return { leadId: lead.id, message: "PROPOSTA – ATRASADO", type: 'warning', sortOrder: 2.9, kind: 'proposal' };
    }
    if (nextAttemptDate === todayStr) {
      const timeMeta = getTimeMeta(nextAttemptDate, lead.nextAttemptTime);
      return { leadId: lead.id, message: "PROPOSTA – FOLLOW-UP HOJE", type: 'info', sortOrder: 3, kind: 'proposal', ...timeMeta };
    }
  }

  // 4. INTERESTED (HOT)
  if (lead.status === LeadStatus.DECISOR_INTERESSADO && nextAttemptDate) {
    if (nextAttemptDate <= todayStr) {
       const timeMeta = getTimeMeta(nextAttemptDate, lead.nextAttemptTime);
       return { leadId: lead.id, message: "INTERESSADO – LIGAR", type: 'info', sortOrder: 4, kind: 'interested', ...timeMeta };
    }
  }

  // 5. GENERAL FOLLOW-UP (The "Treadmill")
  if (nextAttemptDate && nextAttemptDate <= todayStr) {
    if (lead.status !== LeadStatus.NAO_TENTAR_MAIS && lead.status !== LeadStatus.TENTAR_EM_30 && lead.status !== LeadStatus.PROPOSTA_ACEITA) {
       if (nextAttemptDate < todayStr) {
          return { leadId: lead.id, message: "FOLLOW-UP (ATRASADO)", type: 'neutral', sortOrder: 5, kind: 'followup' };
       }
       const timeMeta = getTimeMeta(nextAttemptDate, lead.nextAttemptTime);
       return { leadId: lead.id, message: "FOLLOW-UP HOJE", type: 'neutral', sortOrder: 5.1, kind: 'followup', ...timeMeta };
    }
  }

  // 6. TRY AGAIN IN 30 DAYS (ONLY WHEN DUE)
  if (lead.status === LeadStatus.TENTAR_EM_30 && nextAttemptDate) {
    if (nextAttemptDate < todayStr) {
      return { leadId: lead.id, message: "TENTAR EM 30 – ATRASADO", type: 'neutral', sortOrder: 9.8, kind: 'try30' };
    }
    if (nextAttemptDate === todayStr) {
      const timeMeta = getTimeMeta(nextAttemptDate, lead.nextAttemptTime);
      return { leadId: lead.id, message: "TENTAR EM 30 – HOJE", type: 'neutral', sortOrder: 9.9, kind: 'try30', ...timeMeta };
    }
  }

  return null;
};

// --- COLOR HELPERS ---
export const getStatusColor = (status: string) => {
    switch (status) {
        case LeadStatus.NAO_TENTAR_MAIS: return "bg-red-100 border-red-500 text-red-900";
        case LeadStatus.TENTAR_EM_30: return "bg-orange-100 border-orange-500 text-orange-900";
        case LeadStatus.PROPOSTA_ACEITA: return "bg-green-100 border-green-600 text-green-900";
        case LeadStatus.REUNIAO_MARCADA: return "bg-emerald-100 border-emerald-500 text-emerald-900";
        case LeadStatus.PROPOSTA_ENVIADA: return "bg-amber-100 border-amber-500 text-amber-900";
        case LeadStatus.DECISOR_INTERESSADO: return "bg-yellow-100 border-yellow-500 text-yellow-900";
        case LeadStatus.DECISOR_FRIO: return "bg-blue-100 border-blue-500 text-blue-900";
        case LeadStatus.DECISOR_NAO_ATENDEU: return "bg-gray-100 border-gray-400 text-gray-700";
        default: return "bg-white border-gray-200 text-gray-800";
    }
};

export const getTicketTextClass = (ticket: TicketValue | string) => {
  const numeric = getTicketNumericValue(ticket);

  if (numeric > 0) {
    if (numeric < 1200) return "text-red-600";
    if (numeric > 4500) return "text-[#ff4d00]";
    if (numeric === 4500) return "text-purple-600";
    if (numeric >= 2500) return "text-green-700";
    if (numeric >= 1600) return "text-blue-700";
    return "text-gray-700";
  }

  switch (ticket) {
    case TicketValue.OTIMO: return "text-purple-600";
    case TicketValue.BOM: return "text-green-700";
    case TicketValue.COMUM: return "text-blue-700";
    case TicketValue.BAIXO: return "text-gray-700";
    default: return "text-gray-500";
  }
};

export const getTicketBadgeClass = (ticket: TicketValue | string) => {
  const numeric = getTicketNumericValue(ticket);

  if (numeric > 4500) {
    return "bg-[#0c0c0c] text-[#ff4d00] border border-[#ff4d00] relative overflow-hidden shadow-[0_10px_22px_rgba(0,0,0,0.45)] before:content-[''] before:absolute before:inset-y-0 before:-left-1/2 before:w-[200%] before:bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.6),transparent)] before:opacity-60 before:animate-luxury-shine animate-luxury-glow";
  }

  if (numeric === 4500) {
    return "bg-purple-100 text-purple-800 border border-purple-200 relative overflow-hidden shadow-[0_6px_16px_rgba(88,70,255,0.18)] before:content-[''] before:absolute before:inset-y-0 before:-left-1/2 before:w-[200%] before:bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.35),transparent)] before:opacity-35 before:animate-luxury-shine-soft animate-luxury-glow-soft";
  }

  if (numeric > 0) {
    if (numeric < 1200) return "bg-red-50 text-red-700 border border-red-200";
    if (numeric >= 2500) return "bg-green-100 text-green-800 border border-green-200";
    if (numeric >= 1600) return "bg-blue-100 text-blue-800 border border-blue-200";
    return "bg-gray-100 text-gray-800 border border-gray-200";
  }

  switch (ticket) {
    case TicketValue.OTIMO: return "bg-purple-100 text-purple-800 border border-purple-200";
    case TicketValue.BOM: return "bg-green-100 text-green-800 border border-green-200";
    case TicketValue.COMUM: return "bg-blue-100 text-blue-800 border border-blue-200";
    case TicketValue.BAIXO: return "bg-gray-100 text-gray-800 border border-gray-200";
    default: return "bg-gray-50 text-gray-500 border border-gray-200";
  }
};

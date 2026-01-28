
export enum LeadStatus {
  NAO_TENTAR_MAIS = "Não tentar mais",
  TENTAR_EM_30 = "Tentar em 30 dias",
  PROPOSTA_ACEITA = "Proposta aceita – pagamento feito",
  REUNIAO_MARCADA = "Reunião marcada",
  PROPOSTA_ENVIADA = "Proposta enviada",
  DECISOR_INTERESSADO = "Decisor interessado",
  DECISOR_FRIO = "Decisor frio",
  DECISOR_NAO_ATENDEU = "Decisor não atendeu",
  NOVO = "Novo Lead"
}

export enum Segmento {
  AGRICOLA = "Agrícola",
  AGRONEGOCIO = "Agronegócio",
  PECUARIA = "Pecuária",
  ODONTO = "Clínica Odontológica",
  MEDICOS = "Médicos",
  ESTETICA = "Clínicas Estéticas",
  CLINICAS = "Clínicas no geral",
  ADVOGADOS = "Advogados",
  IMOBILIARIA = "Imobiliária",
  ENGENHARIA = "Engenharia / Construção",
  INDUSTRIA = "Indústria",
  TECNOLOGIA = "Tecnologia / SaaS",
  LOGISTICA = "Logística / Transporte",
  ACADEMIA = "Academia",
  RESTAURANTE = "Restaurante",
  HOTELARIA = "Hotelaria / Turismo",
  SERVICOS_B2B = "Serviços B2B",
  ESCOLA = "Escola / Curso",
  CONTABILIDADE = "Contabilidade",
  JARDIM = "Jardim | Plantas",
  GENERICO = "Outros"
}

export enum SiteState {
  NAO_TEM = "Não tem site",
  QUEBRADO = "Site quebrado (não funciona)",
  RUIM = "Site feio / amador",
  OK = "Site ok",
  BOM = "Site bonito"
}

export enum SitePainPoint {
  BOTOES_QUEBRADOS = "Botões não funcionam",
  LAYOUT_QUEBRADO = "Desalinhamento/Layout quebrado",
  LENTO = "Carregamento lento",
  CORES_AMADORAS = "Cores não passam profissionalismo",
  TEMPLATE_GENERICO = "Template genérico",
  DESORGANIZACAO = "Desorganização de informações",
  SEM_CTA = "Sem chamadas para ação claras",
  NAO_RESPONSIVO = "Não abre bem no celular",
  SEM_SSL = "Sem SSL (site inseguro)",
  BLOG_PARADO = "Blog parado (desatualizado)"
}

export enum Priority {
  ALTA = "Alta",
  MEDIA = "Média",
  BAIXA = "Baixa"
}

export enum TicketValue {
  BAIXO = "Baixo - R$ 1.200",
  COMUM = "Comum - R$ 1.600",
  BOM = "Bom - R$ 2.500",
  OTIMO = "Ótimo - R$ 4.500"
}

export enum OriginType {
  GOOGLE_MAPS = "Google Maps",
  SITE = "Site",
  INSTAGRAM = "Instagram",
  FACEBOOK = "Facebook",
  WHATSAPP = "WhatsApp",
  INDICACAO = "Indicação",
  OUTRO = "Outro"
}

export enum ContactPersonType {
  NAO_ATRIBUIDO = "Não atribuído",
  EMPRESA = "Empresa / Recepção",
  DECISOR = "Decisor"
}

export interface Contact {
  name: string;
  role?: string;
  phone: string;
}

export interface Reference {
  type: 'Pessoal' | 'Cliente';
  platform: 'Instagram' | 'Site' | 'Google Maps' | 'Facebook' | 'LinkedIn' | 'Outro';
  link: string;
}

export interface Lead {
  id: string;
  updatedAt: number; // TIMESTAMP FOR SYNC (CRITICAL)
  deletedAt?: number | null; // Soft delete timestamp (null/undefined = active)

  // Basic Info
  companyName: string;
  
  // Dynamic Contacts
  decisors: Contact[];
  attendants: Contact[];
  
  origin: OriginType | string;
  originLink: string; 
  originRating?: number | null;
  
  references: Reference[]; 

  siteUrl: string;
  segment: Segmento | string;
  yearsInBusiness: number;
  ticketPotential: TicketValue | string; 
  siteState: SiteState | string;
  sitePainPoints: SitePainPoint[];
  
  // Operational
  attempts: number;
  lastContactDate: string | null; 
  lastContactPerson: ContactPersonType | string; 
  channelLastAttempt: string;
  resultLastAttempt: string;
  needsNextContactOverride?: boolean;
  
  // Scheduling
  callbackDate: string | null; 
  callbackTime: string | null; 
  callbackRequestedBy: ContactPersonType | string; 
  
  meetingDate: string | null;
  meetingTime: string | null;
  meetingType: string;
  
  nextAttemptDate: string | null;
  nextAttemptTime: string | null;
  nextAttemptChannel: string;

  // Payment Tracking
  paidValueType?: 'Inteiro' | 'Sinal' | 'Outro' | '';
  paidValueCustom?: number | null;
  
  // Strategy
  status: LeadStatus | string;
  discardReason: string;
  notes: string;
  
  // Script Customization (Allow null)
  customScript?: string | null;

  // Computed
  priority?: Priority; 
  
  // Offline Sync Logic (Dirty Flag)
  _needsSync?: boolean;
}

export interface QueueItem {
  leadId: string;
  message: string;
  type: 'urgent' | 'warning' | 'info' | 'success' | 'neutral';
  sortOrder: number;
  timeSort?: number;
  hasTime?: boolean;
  kind?: 'meeting' | 'callback' | 'proposal' | 'interested' | 'followup' | 'try30';
}

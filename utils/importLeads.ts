import { Lead, LeadStatus, OriginType, Segmento } from "../types";

type RowValue = string | number | null | undefined;

export interface HeaderMap {
  companyName?: string;
  contactName?: string;
  phone?: string;
  site?: string;
  maps?: string;
  instagram?: string;
  facebook?: string;
  whatsapp?: string;
  rating?: string;
  profession?: string;
  segment?: string;
  origin?: string;
  originLink?: string;
}

const HEADER_ALIASES: Record<keyof HeaderMap, string[]> = {
  companyName: ["nome", "empresa", "estabelecimento", "razao", "razão", "fantasia", "negocio", "negócio"],
  contactName: ["responsavel", "responsável", "contato", "decisor", "proprietario", "proprietário", "dono"],
  phone: ["telefone", "tel", "celular", "fone", "whatsapp", "wpp", "contato"],
  site: ["site", "website", "web", "pagina", "página", "url"],
  maps: ["googlemaps", "google maps", "maps", "gmaps", "mapa"],
  instagram: ["instagram", "insta"],
  facebook: ["facebook", "fb"],
  whatsapp: ["whatsapp", "wpp", "wa.me"],
  rating: ["avaliacao", "avaliação", "rating", "nota", "review"],
  profession: ["profissao", "profissão", "categoria", "tipo", "ramo", "atividade"],
  segment: ["segmento"],
  origin: ["origem", "fonte"],
  originLink: ["link", "url", "origem link"]
};

const SEGMENT_KEYWORDS: Record<Segmento, string[]> = {
  [Segmento.ADVOGADOS]: ["advogado", "advocacia", "juridico", "jurídico", "direito", "escritorio de advocacia", "escritório de advocacia"],
  [Segmento.TECNOLOGIA]: ["tecnologia", "software", "saas", "startup", "ti", "sistemas", "digital", "app", "aplicativo"],
  [Segmento.CONTABILIDADE]: ["contabil", "contabilidade", "contador", "contadora", "escritorio contabil"],
  [Segmento.MEDICOS]: ["medico", "médico", "hospital", "clinica medica", "clínica médica", "saude", "saúde"],
  [Segmento.ODONTO]: ["odont", "dentista", "odonto", "odontologia"],
  [Segmento.ESTETICA]: ["estetica", "estética", "dermatologia", "harmonizacao", "harmonização", "beauty", "spa"],
  [Segmento.CLINICAS]: ["clinica", "clínica", "terapia", "psicologia", "fisioterapia", "fono", "nutri"],
  [Segmento.AGRICOLA]: ["agro", "agricola", "agricultura", "agronegocio", "agronegócio", "fazenda"],
  [Segmento.AGRONEGOCIO]: ["agronegocio", "agronegócio", "agro", "agritech", "cooperativa", "silo", "insumos agricolas"],
  [Segmento.PECUARIA]: ["pecuaria", "pecuária", "gado", "boi", "leite", "bovino"],
  [Segmento.IMOBILIARIA]: ["imobiliaria", "imobiliária", "corretor", "corretora", "imovel", "imóvel"],
  [Segmento.ENGENHARIA]: ["engenharia", "construcao", "construção", "obra", "arquiteto", "arquitetura", "empreiteira"],
  [Segmento.INDUSTRIA]: ["industria", "indústria", "fabrica", "fábrica", "manufatura", "produção", "metalurgica", "metalúrgica"],
  [Segmento.LOGISTICA]: ["logistica", "logística", "transporte", "frete", "cargas", "entregas", "transportadora"],
  [Segmento.ACADEMIA]: ["academia", "fitness", "crossfit", "musculacao", "musculação", "pilates"],
  [Segmento.RESTAURANTE]: ["restaurante", "lanchonete", "pizzaria", "hamburgueria", "bar", "cafeteria", "padaria"],
  [Segmento.HOTELARIA]: ["hotel", "hotelaria", "pousada", "turismo", "hostel", "resort"],
  [Segmento.SERVICOS_B2B]: ["consultoria", "agencia", "agência", "marketing", "publicidade", "b2b", "servicos empresariais", "serviços empresariais"],
  [Segmento.ESCOLA]: ["escola", "curso", "educacao", "educação", "idioma", "colegio", "colégio", "faculdade"],
  [Segmento.JARDIM]: ["jardinagem", "paisagismo", "plantas", "jardim", "floricultura"]
};

const normalizeText = (value: string) =>
  value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();

const getFirstValue = (row: Record<string, RowValue>, key?: string): string => {
  if (!key) return "";
  const raw = row[key];
  return raw === null || raw === undefined ? "" : String(raw).trim();
};

const detectHeaderMap = (headers: string[]): HeaderMap => {
  const normalized = headers.map((h) => ({ raw: h, norm: normalizeText(h) }));
  const map: HeaderMap = {};

  (Object.keys(HEADER_ALIASES) as (keyof HeaderMap)[]).forEach((field) => {
    const aliases = HEADER_ALIASES[field];
    const found = normalized.find((h) =>
      aliases.some((alias) => h.norm.includes(normalizeText(alias)))
    );
    if (found) map[field] = found.raw;
  });

  return map;
};

const parseRating = (value: string): number | null => {
  if (!value) return null;
  const normalized = value.replace(",", ".").match(/[\d.]+/);
  if (!normalized) return null;
  const rating = Number.parseFloat(normalized[0]);
  return Number.isNaN(rating) ? null : rating;
};

const extractUrls = (row: Record<string, RowValue>): string[] => {
  const urls: string[] = [];
  Object.values(row).forEach((val) => {
    if (!val) return;
    const text = String(val);
    const matches = text.match(/https?:\/\/[^\s]+/gi) || [];
    const wwwMatches = text.match(/www\.[^\s]+/gi) || [];
    matches.forEach((m) => urls.push(m));
    wwwMatches.forEach((m) => urls.push(m));
  });
  return urls;
};

const detectOriginFromLink = (link?: string) => {
  if (!link) return null;
  const lower = link.toLowerCase();
  if (lower.includes("google.com/maps") || lower.includes("goo.gl/maps") || lower.includes("maps.app.goo.gl")) {
    return OriginType.GOOGLE_MAPS;
  }
  if (lower.includes("instagram.com")) return OriginType.INSTAGRAM;
  if (lower.includes("facebook.com") || lower.includes("fb.com")) return OriginType.FACEBOOK;
  if (lower.includes("wa.me") || lower.includes("whatsapp.com")) return OriginType.WHATSAPP;
  return OriginType.SITE;
};

const detectOriginFromText = (text?: string) => {
  if (!text) return null;
  const norm = normalizeText(text);
  if (norm.includes("google") || norm.includes("maps")) return OriginType.GOOGLE_MAPS;
  if (norm.includes("instagram")) return OriginType.INSTAGRAM;
  if (norm.includes("facebook")) return OriginType.FACEBOOK;
  if (norm.includes("whatsapp") || norm.includes("wpp")) return OriginType.WHATSAPP;
  if (norm.includes("indicacao") || norm.includes("indicação")) return OriginType.INDICACAO;
  if (norm.includes("site")) return OriginType.SITE;
  return null;
};

const inferSegment = (text: string): Segmento => {
  if (!text) return Segmento.GENERICO;
  const normalized = normalizeText(text);
  const directMatch = Object.values(Segmento).find(
    (segment) => normalizeText(segment) === normalized
  );
  if (directMatch) return directMatch as Segmento;

  for (const [segment, keywords] of Object.entries(SEGMENT_KEYWORDS)) {
    if (keywords.some((keyword) => normalized.includes(normalizeText(keyword)))) {
      return segment as Segmento;
    }
  }
  return Segmento.GENERICO;
};

const generateId = () => {
  return "lead_" + Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
};

export const mapRowsToLeads = (
  rows: Record<string, RowValue>[],
  options?: { originOverride?: string; originOtherLabel?: string }
) => {
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const headerMap = detectHeaderMap(headers);
  const warnings: string[] = [];
  const originOverride = options?.originOverride || "Auto";
  const originOtherLabel = options?.originOtherLabel || "";

  const leads: Lead[] = [];
  let skipped = 0;

  rows.forEach((row) => {
    const companyName = getFirstValue(row, headerMap.companyName) || getFirstValue(row, headerMap.contactName);
    if (!companyName) {
      skipped += 1;
      return;
    }

    const contactName = getFirstValue(row, headerMap.contactName) || "";
    const phone = getFirstValue(row, headerMap.phone);

    const siteUrl = getFirstValue(row, headerMap.site);
    const mapsUrl = getFirstValue(row, headerMap.maps);
    const instaUrl = getFirstValue(row, headerMap.instagram);
    const facebookUrl = getFirstValue(row, headerMap.facebook);
    const whatsappUrl = getFirstValue(row, headerMap.whatsapp);
    const originText = getFirstValue(row, headerMap.origin);
    const originLinkText = getFirstValue(row, headerMap.originLink);

    const detectedUrls = extractUrls(row);
    const prioritizedLinks = [
      mapsUrl,
      instaUrl,
      facebookUrl,
      whatsappUrl,
      siteUrl,
      originLinkText,
      ...detectedUrls
    ].filter(Boolean);

    const autoOriginLink = prioritizedLinks[0] || "";
    const originFromLink = detectOriginFromLink(autoOriginLink);
    const originFromText = detectOriginFromText(originText);
    let origin = originFromLink || originFromText || (autoOriginLink ? OriginType.SITE : OriginType.OUTRO);

    if (originOverride !== "Auto") {
      if (originOverride === "Outro") {
        origin = originOtherLabel.trim() ? originOtherLabel.trim() : OriginType.OUTRO;
      } else {
        origin = originOverride;
      }
    }

    const originLink = (() => {
      if (originOverride === OriginType.INSTAGRAM && instaUrl) return instaUrl;
      if (originOverride === OriginType.FACEBOOK && facebookUrl) return facebookUrl;
      if (originOverride === OriginType.WHATSAPP && whatsappUrl) return whatsappUrl;
      if (originOverride === OriginType.GOOGLE_MAPS && mapsUrl) return mapsUrl;
      if (originOverride === OriginType.SITE && siteUrl) return siteUrl;
      return autoOriginLink;
    })();

    const ratingValue = getFirstValue(row, headerMap.rating);
    const originRating = parseRating(ratingValue);

    const segmentRaw = getFirstValue(row, headerMap.segment) || getFirstValue(row, headerMap.profession);
    const segment = inferSegment(segmentRaw);

    const now = Date.now();
    leads.push({
      id: generateId(),
      updatedAt: now,
      deletedAt: null,
      companyName,
      decisors: [{ name: contactName, phone }],
      attendants: [],
      origin,
      originLink,
      originRating,
      references: [],
      siteUrl: siteUrl || "",
      segment,
      yearsInBusiness: 0,
      ticketPotential: "",
      siteState: "",
      sitePainPoints: [],
      attempts: 0,
      lastContactDate: null,
      lastContactPerson: "",
      channelLastAttempt: "",
      resultLastAttempt: "",
      callbackDate: null,
      callbackTime: null,
      callbackRequestedBy: "",
      meetingDate: null,
      meetingTime: null,
      meetingType: "",
      nextAttemptDate: null,
      nextAttemptTime: null,
      nextAttemptChannel: "",
      paidValueType: "",
      paidValueCustom: null,
      status: LeadStatus.NOVO,
      discardReason: "",
      notes: "",
      customScript: null
    });
  });

  if (!headerMap.companyName) warnings.push("Coluna de empresa/nome não identificada.");
  if (!headerMap.phone) warnings.push("Coluna de telefone não identificada.");
  if (!headerMap.profession && !headerMap.segment) warnings.push("Coluna de profissão/segmento não identificada.");

  return { leads, skipped, warnings, headerMap };
};

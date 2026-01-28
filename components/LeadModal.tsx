import React, { useState, useEffect, useRef } from 'react';
import { Lead, LeadStatus, Segmento, SiteState, QueueItem, TicketValue, OriginType, ContactPersonType, SitePainPoint, Contact, Reference } from '../types';
import { generateDiagnosticScript, getGoogleCalendarLink, getQueueStatus, getTicketNumericValue, getTicketTextClass, calculateDownPayment, formatCurrency, normalizeSiteState, getNextContactLevel } from '../utils';
import { ConfirmationModal } from './ConfirmationModal';
import { X, Calendar, Phone, Save, MessageSquare, AlertCircle, Copy, ExternalLink, Link as LinkIcon, Info, Plus, Trash2, User, Users, Maximize2, Minimize2, Loader2, ShieldAlert, ShieldCheck, Clock, ThumbsUp, UserX, MinusCircle, FileText, ChevronRight, ChevronDown, Lock, Globe, MapPin, DollarSign } from 'lucide-react';
import { WhatsAppIcon } from './WhatsAppIcon';

interface Props {
  lead: Lead;
  onClose: () => void;
  onSave: (lead: Lead) => void;
  onRequestDelete?: (lead: Lead) => void;
  isSaving?: boolean; // Prop kept for compatibility but not used for blocking
}

type ScriptPill = {
  id: string;
  label: string;
  content: string;
  type: 'gatekeeper' | 'objection';
  icon: React.ElementType;
};

const SCRIPT_PILLS: ScriptPill[] = [
  // GATEKEEPER BREAKERS
  {
    id: 'gk_help',
    label: 'Pedir Ajuda',
    type: 'gatekeeper',
    icon: ShieldCheck,
    content: '"Olá [Nome da Recepção], obrigado! O motivo da minha ligação: preciso falar com [Decisor] ou com o responsável pela imagem online da empresa. Você poderia me ajudar a falar com essa pessoa?"'
  },
  {
    id: 'gk_email',
    label: 'Pede E-mail',
    type: 'gatekeeper',
    icon: MessageSquare,
    content: '"Trata-se de uma ideia para melhorar [Pain Point do site] que notei e que pode aumentar clientes. Seria melhor conversar diretamente com [Decisor], pois envolve estratégia. Posso contar com sua ajuda para falar com ele rapidinho?"'
  },
  // OBJECTION HANDLING
  {
    id: 'obj_nephew',
    label: 'Sobrinho/Filho',
    type: 'objection',
    icon: User,
    content: '"Entendo e acho ótimo valorizar a família. Mas hoje o site é o coração comercial da empresa. Na BELEGANTE_, focamos em conversão. Posso fazer uma análise técnica pro seu sobrinho usar? Assim você garante que o trabalho dele traga dinheiro real pro caixa."'
  },
  {
    id: 'obj_already_have',
    label: 'Já tem gente',
    type: 'objection',
    icon: Users,
    content: '"Entendo. Mas esse parceiro tem sido proativo em sugerir melhorias? A ideia da BELEGANTE_ não é substituir ninguém agora, é somar onde há lacuna. Me dê 2 minutos para mostrar o que estamos fazendo diferente no mercado."'
  },
  {
    id: 'obj_works',
    label: 'Site funciona',
    type: 'objection',
    icon: ThumbsUp,
    content: '"Funciona ou vende? 75% das pessoas julgam a credibilidade pelo design. Se ele funciona mas parece antigo, você pode estar perdendo cliente para concorrente com site moderno sem saber. A BELEGANTE_ foca em não perder essa venda."'
  },
  {
    id: 'obj_no_time',
    label: 'Sem Tempo',
    type: 'objection',
    icon: Clock,
    content: '"Entendo, prometo ser breve. Atendi vários clientes ocupados que, após 2 minutos, viram valor. Posso garantir que em 2 minutos você saberá se vale a pena falarmos com calma. Podemos tentar?"'
  },
  {
    id: 'obj_not_needed',
    label: 'Não precisamos',
    type: 'objection',
    icon: MinusCircle,
    content: '"Entendo. O problema é que o mercado mudou. Hoje o cliente julga sua empresa pelo site antes mesmo de ligar. Se ele não vê profissionalismo, ele fecha a aba e vai pro concorrente em silêncio. A BELEGANTE_ atua justamente para recuperar esse cliente invisível."'
  }
];

const STATUS_FLOW: LeadStatus[] = [
  LeadStatus.NOVO,
  LeadStatus.DECISOR_NAO_ATENDEU,
  LeadStatus.DECISOR_FRIO,
  LeadStatus.DECISOR_INTERESSADO,
  LeadStatus.REUNIAO_MARCADA,
  LeadStatus.PROPOSTA_ENVIADA,
  LeadStatus.PROPOSTA_ACEITA,
  LeadStatus.TENTAR_EM_30,
  LeadStatus.NAO_TENTAR_MAIS
];

const LeadModal: React.FC<Props> = ({ lead: initialLead, onClose, onSave, onRequestDelete }) => {
  const [lead, setLead] = useState<Lead>(() => ({
    ...initialLead,
    siteState: normalizeSiteState(initialLead.siteState) || ''
  }));
  const [activeTab, setActiveTab] = useState<'workspace' | 'script'>('workspace');
  const [script, setScript] = useState('');
  const [queueStatus, setQueueStatus] = useState<QueueItem | null>(null);
  const [isScriptFullscreen, setIsScriptFullscreen] = useState(false);
  const [scriptMode, setScriptMode] = useState<'auto' | 'custom'>(initialLead.customScript ? 'custom' : 'auto');
  const [statusDropdownOpen, setStatusDropdownOpen] = useState(false);
  const [lastContactDraftTime, setLastContactDraftTime] = useState('');
  const statusDropdownRef = useRef<HTMLDivElement | null>(null);
  const ticketOptions = Object.values(TicketValue);
  const initialTicketIsPreset = ticketOptions.includes(initialLead.ticketPotential as TicketValue);
  const [ticketSelection, setTicketSelection] = useState<string>(initialTicketIsPreset ? initialLead.ticketPotential : '');
  const [manualTicket, setManualTicket] = useState<string>(() => {
    if (initialTicketIsPreset) return '';
    const numeric = getTicketNumericValue(initialLead.ticketPotential);
    return numeric ? String(numeric) : '';
  });
  
  // Objection Pill State
  const [activePill, setActivePill] = useState<ScriptPill | null>(null);

  // Modal States
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    type: 'callback' | 'meeting' | null;
  }>({ isOpen: false, type: null });
  const [pendingExternalLink, setPendingExternalLink] = useState<{ url: string; label: string } | null>(null);

  const normalizeUrl = (url: string) => {
    if (!url) return '';
    return url.startsWith('http') ? url : `https://${url}`;
  };

  const getLocalDateKey = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const normalizeName = (value: string) =>
    value
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const isPlaceholderName = (name?: string) => {
    if (!name) return true;
    const normalized = normalizeName(name);
    if (!normalized) return true;
    const placeholders = [
      'nao atribuido',
      'nao atribuida',
      'nao informado',
      'nao informada',
      'nao cadastrado',
      'nao cadastrada',
      'sem nome',
      'sem contato',
      'desconhecido',
      'desconhecida'
    ];
    return placeholders.some((placeholder) => normalized === placeholder || normalized.startsWith(`${placeholder} `));
  };

  type WhatsAppRole = 'decisor' | 'attendant' | 'unknown';

  const getGreetingPeriod = () => {
    const hour = new Date().getHours();
    return hour >= 18 ? 'boa noite' : hour >= 12 ? 'boa tarde' : 'bom dia';
  };

  const getWhatsAppGreeting = ({
    role,
    decisorName,
    companyName
  }: {
    role: WhatsAppRole;
    decisorName?: string;
    companyName?: string;
  }) => {
    const period = getGreetingPeriod();
    const company = (companyName || '').trim() || 'sua empresa';
    const decisorFullName =
      decisorName && !isPlaceholderName(decisorName) ? decisorName.trim() : '';
    if (role === 'decisor') {
      const greeting = decisorFullName ? `Olá, ${decisorFullName}, ${period}.` : `Olá, ${period}.`;
      return `${greeting} Gostaria de falar com você a respeito da imagem da ${company} online.`;
    }
    const responsible = decisorFullName ? `a pessoa responsável, ${decisorFullName}` : 'a pessoa responsável';
    return `Olá, ${period}. Gostaria de falar com ${responsible}, a respeito da imagem da ${company} online, poderia me ajudar a falar com essa pessoa?`;
  };

  const getWhatsAppLink = (
    phone: string,
    {
      role,
      decisorName,
      companyName
    }: { role: WhatsAppRole; decisorName?: string; companyName?: string }
  ) => {
    if (!phone) return '';
    const digits = phone.replace(/\D/g, '');
    if (!digits) return '';
    const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
    const message = encodeURIComponent(getWhatsAppGreeting({ role, decisorName, companyName }));
    return `https://wa.me/${normalized}?text=${message}`;
  };

  const requestOpenLink = (url: string, label: string) => {
    const normalized = normalizeUrl(url.trim());
    if (!normalized) return;
    setPendingExternalLink({ url: normalized, label });
  };

  const applyAutoScript = () => {
    const autoScript = generateDiagnosticScript(lead, 'full');
    setScriptMode('auto');
    setScript(autoScript);
    if (lead.customScript != null) {
      handleChange('customScript', null);
    }
  };

  const enableManualScript = () => {
    setScriptMode('custom');
    const manualScript = lead.customScript || generateDiagnosticScript(lead, 'micro');
    setScript(manualScript);
    if (lead.customScript !== manualScript) {
      handleChange('customScript', manualScript);
    }
  };

  useEffect(() => {
    if (scriptMode === 'auto') {
      const autoScript = generateDiagnosticScript(lead, 'full');
      if (script !== autoScript) {
        setScript(autoScript);
      }
    } else if (!script) {
      const manualScript = lead.customScript || generateDiagnosticScript(lead, 'micro');
      setScript(manualScript);
    }
    setQueueStatus(getQueueStatus(lead));
  }, [lead, scriptMode, script]);

  useEffect(() => {
    const isPreset = Object.values(TicketValue).includes(initialLead.ticketPotential as TicketValue);
    setTicketSelection(isPreset ? initialLead.ticketPotential : '');
    const numeric = !isPreset ? getTicketNumericValue(initialLead.ticketPotential) : 0;
    setManualTicket(numeric ? String(numeric) : '');
  }, [initialLead.id]);

  useEffect(() => {
    if (!statusDropdownOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (statusDropdownRef.current && !statusDropdownRef.current.contains(target)) {
        setStatusDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [statusDropdownOpen]);

  const handleChange = (field: keyof Lead, value: any) => {
    setLead(prev => ({ ...prev, [field]: value }));
  };

  const handlePaidTypeChange = (value: string) => {
    handleChange('paidValueType', value);
    if (value !== 'Outro') {
      handleChange('paidValueCustom', null);
    }
  };

  const handlePaidCustomChange = (value: string) => {
    const cleaned = value.replace(/[^\d]/g, '');
    handleChange('paidValueCustom', cleaned ? Number(cleaned) : null);
  };

  const handleTicketSelection = (value: string) => {
    setTicketSelection(value);
    if (!value) {
      if (!manualTicket) {
        handleChange('ticketPotential', '');
        if (lead.paidValueType && lead.paidValueType !== 'Outro') {
          handleChange('paidValueType', '');
          handleChange('paidValueCustom', null);
        }
      }
      return;
    }
    if (manualTicket) {
      setManualTicket('');
    }
    handleChange('ticketPotential', value);
  };

  const handleManualTicketChange = (value: string) => {
    const cleaned = value.replace(/[^\d]/g, '');
    setManualTicket(cleaned);
    const numeric = Number(cleaned);
    if (numeric > 0) {
      if (ticketSelection) {
        setTicketSelection('');
      }
      handleChange('ticketPotential', `Personalizado - ${formatCurrency(numeric)}`);
    } else {
      handleChange('ticketPotential', ticketSelection);
      if (!ticketSelection && lead.paidValueType && lead.paidValueType !== 'Outro') {
        handleChange('paidValueType', '');
        handleChange('paidValueCustom', null);
      }
    }
  };

  const handleScriptChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newVal = e.target.value;
    setScript(newVal);
    if (scriptMode !== 'custom') {
      setScriptMode('custom');
    }
    if (lead.customScript !== newVal) {
      handleChange('customScript', newVal);
    }
  };

  const getLastContactParts = () => {
    if (!lead.lastContactDate) return { date: '', time: lastContactDraftTime };
    const value = lead.lastContactDate;
    if (value.includes('T')) {
      const [date, time] = value.split('T');
      return { date: date || '', time: (time || '').slice(0, 5) };
    }
    return { date: value, time: '' };
  };

  const shouldHighlightNextContact = () => getNextContactLevel(lead) !== 'none';

  const getNextContactBadgeClass = () => {
    const level = getNextContactLevel(lead);
    if (level === 'strong') return 'border-yellow-400 bg-yellow-100 text-yellow-900';
    if (level === 'light') return 'border-yellow-200 bg-yellow-50 text-yellow-800';
    return '';
  };

  const setLastContact = (date: string, time: string) => {
    if (!date) {
      handleChange('lastContactDate', null);
      return;
    }
    if (time) {
      handleChange('lastContactDate', `${date}T${time}`);
      return;
    }
    handleChange('lastContactDate', date);
  };

  const handleLastContactDateChange = (date: string) => {
    if (!date) {
      handleChange('lastContactDate', null);
      return;
    }
    const time = lastContactDraftTime || getLastContactParts().time;
    setLastContact(date, time);
    if (lastContactDraftTime) setLastContactDraftTime('');
  };

  const handleLastContactTimeChange = (time: string) => {
    if (getLastContactParts().date) {
      setLastContact(getLastContactParts().date, time);
      return;
    }
    setLastContactDraftTime(time);
  };

  const setLastContactNow = () => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    setLastContactDraftTime('');
    setLastContact(`${year}-${month}-${day}`, `${hours}:${minutes}`);
  };

  const normalizeContactText = (value: string | null | undefined) => {
    if (!value) return '';
    return value
      .toString()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .trim();
  };

  const normalizeContactPhone = (value: string | null | undefined) => {
    if (!value) return '';
    return value.replace(/\D/g, '');
  };

  const hasDuplicateContacts = (contacts: Contact[]) => {
    const seen = new Set<string>();
    for (const contact of contacts || []) {
      const key = normalizeContactPhone(contact.phone) || normalizeContactText(contact.name);
      if (!key) continue;
      if (seen.has(key)) return true;
      seen.add(key);
    }
    return false;
  };

  const decisorHasDup = hasDuplicateContacts(lead.decisors || []);
  const attendantHasDup = hasDuplicateContacts(lead.attendants || []);

  const addDecisor = () => {
    setLead(prev => ({ ...prev, decisors: [...prev.decisors, { name: '', phone: '', role: '' }] }));
  }
  const removeDecisor = (idx: number) => {
    setLead(prev => ({ ...prev, decisors: prev.decisors.filter((_, i) => i !== idx) }));
  }
  const updateDecisor = (idx: number, field: keyof Contact, val: string) => {
    const newDecisors = [...lead.decisors];
    newDecisors[idx] = { ...newDecisors[idx], [field]: val };
    setLead(prev => ({ ...prev, decisors: newDecisors }));
  }

  const addAttendant = () => {
    setLead(prev => ({ ...prev, attendants: [...prev.attendants, { name: '', phone: '' }] }));
  }
  const removeAttendant = (idx: number) => {
    setLead(prev => ({ ...prev, attendants: prev.attendants.filter((_, i) => i !== idx) }));
  }
  const updateAttendant = (idx: number, field: keyof Contact, val: string) => {
    const newAttendants = [...lead.attendants];
    newAttendants[idx] = { ...newAttendants[idx], [field]: val };
    setLead(prev => ({ ...prev, attendants: newAttendants }));
  }

  const addPainPoint = (point: string) => {
    if (!point) return;
    const current = lead.sitePainPoints || [];
    if (!current.includes(point as SitePainPoint)) {
      handleChange('sitePainPoints', [...current, point]);
    }
  }
  
  const removePainPoint = (point: SitePainPoint) => {
    const current = lead.sitePainPoints || [];
    handleChange('sitePainPoints', current.filter(p => p !== point));
  }

  const addReference = () => {
    setLead(prev => ({ ...prev, references: [...(prev.references || []), { type: 'Pessoal', platform: 'Instagram', link: '' }] }));
  }
  const removeReference = (idx: number) => {
    setLead(prev => ({ ...prev, references: (prev.references || []).filter((_, i) => i !== idx) }));
  }
  const updateReference = (idx: number, field: keyof Reference, val: string) => {
    const newRefs = [...(lead.references || [])];
    newRefs[idx] = { ...newRefs[idx], [field]: val };
    setLead(prev => ({ ...prev, references: newRefs }));
  }

  // --- CONFIRMATION HANDLERS ---
  const requestClearCallback = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmModal({ isOpen: true, type: 'callback' });
  }

  const performClearCallback = () => {
    setLead(prev => ({ ...prev, callbackDate: null, callbackTime: null, callbackRequestedBy: '' }));
  }

  const requestClearMeeting = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setConfirmModal({ isOpen: true, type: 'meeting' });
  }

  const performClearMeeting = () => {
    setLead(prev => ({ ...prev, meetingDate: null, meetingTime: null, meetingType: '' }));
  }

  const handleConfirmAction = () => {
    if (confirmModal.type === 'callback') performClearCallback();
    if (confirmModal.type === 'meeting') performClearMeeting();
    setConfirmModal({ isOpen: false, type: null });
  }

  const initCallback = () => {
    setLead(prev => ({ ...prev, callbackDate: getLocalDateKey(), callbackTime: '10:00', callbackRequestedBy: ContactPersonType.DECISOR }));
  }

  const initMeeting = () => {
    setLead(prev => ({ ...prev, meetingDate: getLocalDateKey(), meetingTime: '15:00', meetingType: 'Primeira Reunião' }));
  }

  const copyScript = () => {
    navigator.clipboard.writeText(script);
  };

  const mainDecisor = lead.decisors[0] || { name: '', phone: '' };

  const meetingLink = getGoogleCalendarLink(
    `Reunião: ${lead.companyName}`, 
    `Reunião com ${mainDecisor.name}.\nTipo: ${lead.meetingType}\n\nObs: ${lead.notes}`, 
    lead.meetingDate, 
    lead.meetingTime
  );

  const callbackLink = getGoogleCalendarLink(
    `Ligar: ${lead.companyName}`, 
    `Retorno combinado com ${lead.callbackRequestedBy} (${mainDecisor.name}).\nTel: ${mainDecisor.phone}`, 
    lead.callbackDate, 
    lead.callbackTime
  );

  const isScriptMissingData = script.startsWith("Preencha");

  const inputClass = "w-full p-2.5 bg-white border border-gray-300 rounded-lg text-base md:text-sm text-gray-900 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all placeholder-gray-400";
  const selectClass = "w-full p-2.5 bg-white border border-gray-300 rounded-lg text-base md:text-sm text-gray-900 focus:ring-1 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all cursor-pointer";
  const labelClass = "block text-xs font-bold text-gray-600 mb-1.5 uppercase tracking-wide";

  const ticketNumeric = getTicketNumericValue(lead.ticketPotential);
  const hasTicketValue = ticketNumeric > 0;
  const manualNumeric = Number(manualTicket || 0);
  const downPayment = manualNumeric > 0
    ? formatCurrency(manualNumeric * 0.40)
    : calculateDownPayment(lead.ticketPotential);
  const paidAutoAmount = lead.paidValueType === 'Inteiro'
    ? ticketNumeric
    : lead.paidValueType === 'Sinal'
      ? ticketNumeric * 0.40
      : 0;
  const paidAmount = lead.paidValueType === 'Outro'
    ? (lead.paidValueCustom || 0)
    : paidAutoAmount;
  const paidAmountDisplay = paidAmount > 0 ? formatCurrency(paidAmount) : null;
  const ticketDisplay = lead.ticketPotential
    ? (lead.ticketPotential.includes('-') ? lead.ticketPotential.split('-')[1].trim() : lead.ticketPotential)
    : '';

  return (
    <div className={`fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 ${isScriptFullscreen ? 'p-0' : 'p-4'}`}>
      <div className={`bg-white shadow-2xl w-full flex flex-col overflow-hidden transition-all duration-300 ${isScriptFullscreen ? 'h-full rounded-none' : 'max-w-7xl h-[95vh] rounded-xl'}`}>
        
        {/* Header */}
        {!isScriptFullscreen && (
        <div className="flex justify-between items-center p-4 md:p-5 border-b border-gray-100 bg-gray-50 shrink-0">
          <div>
             <div className="flex items-center gap-3 flex-wrap">
               <h2 className="text-xl md:text-2xl font-bold text-gray-900">{lead.companyName || "Nova Empresa"}</h2>
               {queueStatus && (
                 <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold uppercase tracking-wider ${queueStatus.type === 'urgent' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'}`}>
                   {queueStatus.message}
                 </span>
               )}
             </div>
             <p className="text-sm text-gray-500 flex items-center gap-2 mt-1 flex-wrap">
               {lead.segment}
               {shouldHighlightNextContact() && (
                 <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[11px] font-semibold ${getNextContactBadgeClass()}`}>
                   <AlertCircle size={12} /> Próximo contato
                 </span>
               )}
               {lead.originLink && (
                  <a href={lead.originLink.startsWith('http') ? lead.originLink : `https://${lead.originLink}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline flex items-center gap-1 bg-blue-50 px-2 py-0.5 rounded-md">
                    <ExternalLink size={12} /> {lead.origin}: Abrir Link
                  </a>
               )}
             </p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full transition-colors">
            <X size={24} className="text-gray-500" />
          </button>
        </div>
        )}

        {/* Navigation */}
        {!isScriptFullscreen && (
        <div className="px-4 py-3 bg-white border-b border-gray-100 shrink-0">
          <div className="flex p-1 bg-gray-100 rounded-lg relative">
            <div 
              className={`absolute top-1 bottom-1 w-1/2 bg-white rounded-md shadow-sm transition-all duration-200 ease-in-out ${activeTab === 'script' ? 'translate-x-full' : 'translate-x-0'}`} 
            />
            <button 
              onClick={() => setActiveTab('workspace')}
              className={`flex-1 relative z-10 py-2 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'workspace' ? 'text-blue-600' : 'text-gray-500'}`}
            >
              <ExternalLink size={16} /> Operacional
            </button>
            <button 
              onClick={() => setActiveTab('script')}
              className={`flex-1 relative z-10 py-2 text-sm font-bold flex items-center justify-center gap-2 transition-colors ${activeTab === 'script' ? 'text-blue-600' : 'text-gray-500'}`}
            >
              <MessageSquare size={16} /> Script & Diag.
            </button>
          </div>
        </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto bg-gray-50/50">
          
          {activeTab === 'workspace' && !isScriptFullscreen && (
            <div className="p-4 md:p-6 grid grid-cols-12 gap-6">
              
              {/* COL 1: IDENTIFICAÇÃO & ORIGEM */}
              <div className="col-span-12 lg:col-span-4 space-y-5">
                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                   <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                     <AlertCircle size={16} className="text-orange-500" /> Identificação
                   </h3>
                   
                   <div className="space-y-4">
                      <div>
                        <label className={labelClass}>Nome da Empresa</label>
                        <input value={lead.companyName} onChange={(e) => handleChange('companyName', e.target.value)} className={inputClass} placeholder="Ex: Escritório Silva" />
                      </div>
                      <div>
                        <label className={labelClass}>Segmento</label>
                        <select value={lead.segment} onChange={(e) => handleChange('segment', e.target.value)} className={selectClass}>
                          <option value="">Selecione o segmento...</option>
                          {Object.values(Segmento).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Tempo (Anos)</label>
                        <input type="number" value={lead.yearsInBusiness} onChange={(e) => handleChange('yearsInBusiness', Number(e.target.value))} className={inputClass} min="1" placeholder="Ex: 5" />
                      </div>
                   </div>
                </div>

                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                   <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                      <LinkIcon size={16} className="text-blue-600" /> Origem & Referências
                   </h3>
                   <div className="mb-4 bg-gray-50 p-3 rounded-lg border border-gray-100">
                       <label className={labelClass}>Origem do Lead</label>
                       <div className="grid grid-cols-2 gap-2 mt-1">
                         <select value={lead.origin} onChange={(e) => handleChange('origin', e.target.value)} className={selectClass}>
                           <option value="">Selecione...</option>
                           {Object.values(OriginType).map(o => <option key={o} value={o}>{o}</option>)}
                         </select>
                         <div className="relative">
                           <input value={lead.originLink || ''} onChange={(e) => handleChange('originLink', e.target.value)} className={`${inputClass} pr-10`} placeholder="Cole o Link da Origem..." />
                           <button
                             type="button"
                             onClick={() => requestOpenLink(lead.originLink || '', 'Origem')}
                             disabled={!lead.originLink}
                             title="Abrir origem em nova aba"
                             className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent"
                           >
                             <MapPin size={16} />
                           </button>
                         </div>
                       </div>
                       <div className="mt-2">
                         <label className={labelClass}>Avaliação</label>
                         <input
                           type="number"
                           min="0"
                           max="5"
                           step="0.1"
                           value={lead.originRating ?? ''}
                           onChange={(e) => handleChange('originRating', e.target.value === '' ? null : Number(e.target.value))}
                           className={inputClass}
                           placeholder="Ex: 4.8"
                         />
                       </div>
                   </div>
                   <div>
                      <div className="flex justify-between items-center mb-2">
                        <label className={labelClass}>Referências Extras</label>
                        <button onClick={addReference} className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50"><Plus size={16} /></button>
                      </div>
                      <div className="space-y-2">
                        {lead.references?.map((ref, i) => (
                          <div key={i} className="flex gap-2 items-center">
                             <select value={ref.type} onChange={(e) => updateReference(i, 'type', e.target.value)} className="w-24 p-2 bg-white border border-gray-300 rounded-md text-xs">
                               <option>Pessoal</option><option>Cliente</option>
                             </select>
                             <select value={ref.platform} onChange={(e) => updateReference(i, 'platform', e.target.value)} className="w-28 p-2 bg-white border border-gray-300 rounded-md text-xs">
                               <option>Instagram</option><option>Site</option><option>Maps</option><option>LinkedIn</option><option>Outro</option>
                             </select>
                             <input value={ref.link} onChange={(e) => updateReference(i, 'link', e.target.value)} className={`${inputClass} text-xs`} placeholder="URL..." />
                             <button onClick={() => removeReference(i)} className="text-gray-400 hover:text-red-500"><X size={14} /></button>
                          </div>
                        ))}
                      </div>
                   </div>
                </div>

                <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                   <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                     <AlertCircle size={16} className="text-red-500" /> Diagnóstico Visual
                   </h3>
                   <div className="space-y-4">
                      <div>
                        <label className={labelClass}>Link do Site</label>
                        <div className="relative">
                          <input
                            value={lead.siteUrl || ''}
                            onChange={(e) => handleChange('siteUrl', e.target.value)}
                            className={`${inputClass} pr-10`}
                            placeholder="https://empresa.com.br"
                          />
                          <button
                            type="button"
                            onClick={() => requestOpenLink(lead.siteUrl || '', 'Site')}
                            disabled={!lead.siteUrl}
                            title="Abrir site em nova aba"
                            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-40 disabled:hover:bg-transparent"
                          >
                            <Globe size={16} />
                          </button>
                        </div>
                      </div>
                      <div>
                        <label className={labelClass}>Estado Geral do Site</label>
                        <select value={lead.siteState} onChange={(e) => handleChange('siteState', e.target.value)} className={selectClass}>
                           <option value="">Selecione o estado...</option>
                           {Object.values(SiteState).map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className={labelClass}>Incrementador de Dor (Tags)</label>
                        <select value="" onChange={(e) => addPainPoint(e.target.value)} className={`${selectClass} mb-2 border-dashed`}>
                           <option value="">+ Adicionar Problema Detectado</option>
                           {Object.values(SitePainPoint).map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                        <div className="flex flex-wrap gap-2">
                           {(lead.sitePainPoints || []).map(point => (
                              <span key={point} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-red-50 text-red-700 border border-red-200 text-xs font-bold shadow-sm">
                                {point}
                                <button onClick={() => removePainPoint(point)} className="text-red-400 hover:text-red-600"><X size={12} /></button>
                              </span>
                           ))}
                           {(!lead.sitePainPoints || lead.sitePainPoints.length === 0) && <span className="text-xs text-gray-400 italic pl-1">Nenhum problema técnico adicionado.</span>}
                        </div>
                      </div>
                   </div>
                </div>
              </div>

              {/* COL 2: CONTATOS & ATIVIDADE */}
              <div className="col-span-12 lg:col-span-4 space-y-5">
                 <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                    <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                      <Users size={16} className="text-green-600" /> Contatos
                    </h3>
                    <div className="mb-6">
                      <div className="flex justify-between items-center mb-2">
                         <label className={labelClass}>Decisores</label>
                         <button onClick={addDecisor} className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50"><Plus size={16} /></button>
                      </div>
                      <div className="space-y-2">
                        {lead.decisors.map((d, i) => (
                          <div key={i} className="flex gap-2">
                             <input value={d.name} onChange={(e) => updateDecisor(i, 'name', e.target.value)} className={`${inputClass} flex-1`} placeholder="Nome" />
                             <input value={d.phone} onChange={(e) => updateDecisor(i, 'phone', e.target.value)} className={`${inputClass} flex-1`} placeholder="Tel" />
                             <button
                               type="button"
                              onClick={() =>
                                requestOpenLink(
                                  getWhatsAppLink(d.phone, {
                                    role: 'decisor',
                                    decisorName: d.name,
                                    companyName: lead.companyName
                                  }),
                                  'WhatsApp'
                                )
                              }
                              disabled={!getWhatsAppLink(d.phone, { role: 'decisor', decisorName: d.name, companyName: lead.companyName })}
                               title="Abrir WhatsApp"
                               className="p-2 rounded-md hover:bg-emerald-50 disabled:opacity-40 disabled:hover:bg-transparent"
                             >
                               <WhatsAppIcon size={16} className="opacity-90" />
                             </button>
                             {i > 0 && <button onClick={() => removeDecisor(i)} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={16} /></button>}
                          </div>
                        ))}
                      </div>
                      {decisorHasDup && (
                        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-center gap-1.5">
                          <AlertCircle size={12} className="shrink-0" />
                          Existe contato duplicado nos decisores. Ao salvar, vamos mesclar automaticamente.
                        </div>
                      )}
                    </div>
                    <div>
                      <div className="flex justify-between items-center mb-2">
                         <label className={labelClass}>Atendentes / Recepção</label>
                         <button onClick={addAttendant} className="text-blue-600 hover:text-blue-800 p-1 rounded hover:bg-blue-50"><Plus size={16} /></button>
                      </div>
                      <div className="space-y-2">
                        {lead.attendants.map((a, i) => (
                          <div key={i} className="flex gap-2">
                             <input value={a.name} onChange={(e) => updateAttendant(i, 'name', e.target.value)} className={`${inputClass} flex-1`} placeholder="Nome" />
                             <input value={a.phone} onChange={(e) => updateAttendant(i, 'phone', e.target.value)} className={`${inputClass} flex-1`} placeholder="Tel" />
                             <button
                               type="button"
                              onClick={() =>
                                requestOpenLink(
                                  getWhatsAppLink(a.phone, {
                                    role: 'attendant',
                                    decisorName:
                                      lead.decisors?.find((c) => c.name && !isPlaceholderName(c.name))?.name || '',
                                    companyName: lead.companyName
                                  }),
                                  'WhatsApp'
                                )
                              }
                              disabled={
                                !getWhatsAppLink(a.phone, {
                                  role: 'attendant',
                                  decisorName:
                                    lead.decisors?.find((c) => c.name && !isPlaceholderName(c.name))?.name || '',
                                  companyName: lead.companyName
                                })
                              }
                               title="Abrir WhatsApp"
                               className="p-2 rounded-md hover:bg-emerald-50 disabled:opacity-40 disabled:hover:bg-transparent"
                             >
                               <WhatsAppIcon size={16} className="opacity-90" />
                             </button>
                             {i > 0 && <button onClick={() => removeAttendant(i)} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={16} /></button>}
                          </div>
                        ))}
                      </div>
                      {attendantHasDup && (
                        <div className="mt-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-2 py-1.5 flex items-center gap-1.5">
                          <AlertCircle size={12} className="shrink-0" />
                          Existe contato duplicado nos atendentes. Ao salvar, vamos mesclar automaticamente.
                        </div>
                      )}
                    </div>
                 </div>

                 <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                    <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                       <Phone size={16} className="text-gray-600" /> Registro de Atividade
                    </h3>
                    <div className="grid grid-cols-2 gap-4 mb-4">
                       <div>
                         <label className={labelClass}>Tentativa Nº</label>
                         <input type="number" value={lead.attempts} onChange={(e) => handleChange('attempts', Number(e.target.value))} className={inputClass} />
                       </div>
                       <div className="flex items-center gap-2 mt-6">
                         <input
                           id="next-contact-override"
                           type="checkbox"
                           checked={!!lead.needsNextContactOverride}
                           onChange={(e) => handleChange('needsNextContactOverride', e.target.checked ? true : null)}
                           className="h-4 w-4 rounded border-gray-300 text-yellow-500 focus:ring-yellow-200"
                         />
                         <label htmlFor="next-contact-override" className="text-xs font-semibold text-yellow-700">
                           Marcar como “Próximo contato”
                         </label>
                       </div>
                       <div>
                         <label className={labelClass}>Último contato (data)</label>
                         <input
                           type="date"
                           value={getLastContactParts().date}
                           onChange={(e) => handleLastContactDateChange(e.target.value)}
                           className={`${inputClass} date-input`}
                           style={{ colorScheme: 'light' }}
                         />
                       </div>
                       <div>
                         <label className={labelClass}>Último contato (hora)</label>
                         <input
                           type="time"
                           value={getLastContactParts().time}
                           onChange={(e) => handleLastContactTimeChange(e.target.value)}
                           className={`${inputClass} time-input`}
                         />
                       </div>
                       <div>
                         <label className={labelClass}>Com quem falou?</label>
                        <select
                          value={lead.lastContactPerson || ''}
                          onChange={(e) => {
                            const value = e.target.value;
                            handleChange('lastContactPerson', value);
                            if (value && !lead.lastContactDate) {
                              setLastContactNow();
                            }
                          }}
                          className={selectClass}
                        >
                          <option value="">Selecione...</option>
                          <option value={ContactPersonType.NAO_ATRIBUIDO}>{ContactPersonType.NAO_ATRIBUIDO}</option>
                          <option value={ContactPersonType.EMPRESA}>{ContactPersonType.EMPRESA}</option>
                          <option value={ContactPersonType.DECISOR}>{ContactPersonType.DECISOR}</option>
                        </select>
                       </div>
                       <div className="col-span-2">
                         <label className={labelClass}>Canal Utilizado</label>
                         <select value={lead.channelLastAttempt} onChange={(e) => handleChange('channelLastAttempt', e.target.value)} className={selectClass} disabled={!lead.lastContactPerson}>
                           <option value="">Selecione primeiro com quem falou...</option>
                           <option value="Ligação">Ligação</option><option value="WhatsApp Texto">WhatsApp Texto</option><option value="WhatsApp Áudio">WhatsApp Áudio</option><option value="Instagram">Instagram</option><option value="Email">Email</option>
                         </select>
                       </div>
                    </div>
                    <div>
                      <label className={labelClass}>Observações</label>
                      <textarea value={lead.notes} onChange={(e) => handleChange('notes', e.target.value)} placeholder="Detalhes importantes da conversa..." className="w-full p-3 bg-gray-50 border border-gray-300 rounded-lg text-sm text-gray-900 h-24 resize-none focus:ring-1 focus:ring-blue-500 outline-none" />
                    </div>
                 </div>
              </div>

              {/* COL 3: PIPELINE, AGENDA & FINANCEIRO */}
              <div className="col-span-12 lg:col-span-4 space-y-5">
                 <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                    <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                      <Save size={16} className="text-purple-600" /> Pipeline
                    </h3>
                    <div className="space-y-4">
                       <div>
                          <label className={labelClass}>Status Atual</label>
                          <div ref={statusDropdownRef} className="relative">
                            <button
                              type="button"
                              onClick={() => setStatusDropdownOpen((prev) => !prev)}
                              className={`${selectClass} flex items-center justify-between gap-2 font-semibold text-gray-800`}
                              aria-expanded={statusDropdownOpen}
                            >
                              <span>{lead.status || 'Selecione...'}</span>
                              <ChevronDown size={16} className={`text-gray-400 transition ${statusDropdownOpen ? 'rotate-180' : ''}`} />
                            </button>
                            {statusDropdownOpen && (
                              <div className="absolute z-30 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-lg p-2 max-h-56 overflow-auto">
                                {STATUS_FLOW.map((status) => (
                                  <button
                                    key={status}
                                    type="button"
                                    onClick={() => {
                                      handleChange('status', status);
                                      setStatusDropdownOpen(false);
                                    }}
                                    className={`w-full text-left px-3 py-2 rounded-lg text-sm font-semibold transition ${
                                      lead.status === status ? 'bg-gray-100 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                                    }`}
                                  >
                                    {status}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                       </div>
                       <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                         <div>
                          <label className={`${labelClass} min-h-[32px]`}>Próxima tentativa (gatilho)</label>
                           <div className="relative">
                             <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 pointer-events-none" size={16} />
                              <input 
                                type="date" 
                                value={lead.nextAttemptDate || ''} 
                                onChange={(e) => {
                                  const value = e.target.value;
                                  handleChange('nextAttemptDate', value);
                                  if (!value) {
                                    handleChange('nextAttemptTime', null);
                                    handleChange('nextAttemptChannel', '');
                                  }
                                }} 
                                className={`${inputClass} date-input pl-10 cursor-pointer`} 
                                style={{ colorScheme: 'light' }}
                              />
                           </div>
                         </div>
                         <div>
                          <label className={`${labelClass} min-h-[32px]`}>Horário</label>
                           <input
                             type="time"
                             value={lead.nextAttemptTime || ''}
                             onChange={(e) => handleChange('nextAttemptTime', e.target.value)}
                             className={`${inputClass} time-input`}
                             disabled={!lead.nextAttemptDate}
                           />
                         </div>
                       </div>
                       <div>
                         <label className={labelClass}>Canal da Próxima Tentativa</label>
                         <select
                           value={lead.nextAttemptChannel || ''}
                           onChange={(e) => handleChange('nextAttemptChannel', e.target.value)}
                           className={selectClass}
                           disabled={!lead.nextAttemptDate}
                         >
                           <option value="">Selecione...</option>
                           <option value="Ligação">Ligação</option>
                           <option value="WhatsApp Texto">WhatsApp Texto</option>
                           <option value="WhatsApp Áudio">WhatsApp Áudio</option>
                           <option value="Instagram">Instagram</option>
                           <option value="Email">Email</option>
                         </select>
                       </div>
                       {lead.status === LeadStatus.NAO_TENTAR_MAIS && (
                        <div className="animate-in fade-in slide-in-from-top-2">
                           <label className={`${labelClass} text-red-600`}>Motivo do Descarte (Obrigatório)</label>
                           <input value={lead.discardReason} onChange={(e) => handleChange('discardReason', e.target.value)} className="w-full p-2 bg-red-50 border border-red-300 rounded-md text-sm text-gray-900 focus:ring-1 focus:ring-red-500 outline-none" placeholder="Ex: Sem budget..." />
                        </div>
                       )}
                    </div>
                 </div>

                 <div className="bg-white p-5 rounded-lg border border-gray-200 shadow-sm">
                    <h3 className="font-bold text-gray-800 border-b border-gray-100 pb-2 mb-4 flex items-center gap-2">
                      <DollarSign size={16} className="text-emerald-600" /> Financeiro
                    </h3>
                    <div className="space-y-4">
                       <div>
                         <label className={labelClass}>Ticket Potencial</label>
                         <select value={ticketSelection} onChange={(e) => handleTicketSelection(e.target.value)} className={selectClass}>
                           <option value="">Selecione o ticket...</option>
                           {ticketOptions.map(opt => (
                             <option key={opt} value={opt}>{opt}</option>
                           ))}
                         </select>
                       </div>
                       <div>
                         <label className={labelClass}>Ticket Personalizado (R$)</label>
                         <input
                           value={manualTicket}
                           onChange={(e) => handleManualTicketChange(e.target.value)}
                           className={inputClass}
                           inputMode="numeric"
                           placeholder="Ex: 3200"
                         />
                       </div>
                       {(ticketDisplay || downPayment) && (
                         <div className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border border-gray-100 bg-gray-50">
                           <span className={`text-xs font-bold ${ticketDisplay ? getTicketTextClass(lead.ticketPotential) : 'text-gray-400'}`}>
                             {ticketDisplay || 'Ticket não definido'}
                           </span>
                           {downPayment && (
                             <span className="text-xs text-gray-500">
                               Entrada 40%: <strong className="text-gray-800">{downPayment}</strong>
                             </span>
                           )}
                         </div>
                       )}
                       <div>
                         <label className={labelClass}>Valor pago</label>
                         <select value={lead.paidValueType || ''} onChange={(e) => handlePaidTypeChange(e.target.value)} className={selectClass}>
                           <option value="">Selecione...</option>
                           <option value="Inteiro" disabled={!hasTicketValue}>Inteiro</option>
                           <option value="Sinal" disabled={!hasTicketValue}>Sinal (40%)</option>
                           <option value="Outro">Outro</option>
                         </select>
                         {!hasTicketValue && (
                           <div className="mt-2 text-xs text-amber-600">
                             Defina o ticket para habilitar Inteiro/Sinal.
                           </div>
                         )}
                         {lead.paidValueType === 'Outro' && (
                           <input
                             type="number"
                             min="0"
                             inputMode="numeric"
                             value={lead.paidValueCustom ?? ''}
                             onChange={(e) => handlePaidCustomChange(e.target.value)}
                             className={`${inputClass} mt-2`}
                             placeholder="Valor pago"
                           />
                         )}
                         {lead.paidValueType && lead.paidValueType !== 'Outro' && paidAmountDisplay && (
                           <div className="mt-2 text-sm text-gray-600">
                             Valor calculado: <strong className="text-gray-900">{paidAmountDisplay}</strong>
                           </div>
                         )}
                       </div>
                    </div>
                 </div>

                 {/* AGENDA - RETORNO */}
                 {lead.callbackDate !== null ? (
                   <div className="bg-yellow-50 p-5 rounded-lg border border-yellow-200 shadow-sm relative group animate-in zoom-in-95 duration-200">
                      <button type="button" onClick={requestClearCallback} className="absolute top-3 right-3 text-yellow-600 hover:text-red-600 transition-colors p-1 cursor-pointer z-10" title="Remover agendamento"><Trash2 size={16} /></button>
                      <h4 className="text-yellow-800 font-bold text-sm mb-4 uppercase tracking-wide flex items-center gap-2"><Calendar size={14} /> Retorno Agendado</h4>
                      <div className="space-y-3">
                         <div>
                            <label className="text-[10px] uppercase font-bold text-yellow-700">Quem pediu?</label>
                            <select value={lead.callbackRequestedBy || ''} onChange={(e) => handleChange('callbackRequestedBy', e.target.value)} className="w-full p-2 bg-white border border-yellow-300 rounded-md text-sm text-gray-800">
                               <option value="">Selecione...</option><option value={ContactPersonType.EMPRESA}>{ContactPersonType.EMPRESA}</option><option value={ContactPersonType.DECISOR}>{ContactPersonType.DECISOR}</option>
                            </select>
                         </div>
                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="relative">
                              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 text-yellow-600 pointer-events-none" size={16} />
                              <input 
                                type="date" 
                                value={lead.callbackDate || ''} 
                                onChange={(e) => handleChange('callbackDate', e.target.value)} 
                                className="w-full p-2 pl-9 bg-white border border-yellow-300 rounded-md text-sm text-gray-800 cursor-pointer date-input"
                                style={{ colorScheme: 'light' }}
                              />
                            </div>
                            <input
                              type="time"
                              value={lead.callbackTime || ''}
                              onChange={(e) => handleChange('callbackTime', e.target.value)}
                              className="w-full p-2 bg-white border border-yellow-300 rounded-md text-sm text-gray-800 time-input"
                            />
                         </div>
                         <a href={callbackLink} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full py-2 bg-yellow-500 hover:bg-yellow-600 text-white rounded-md text-sm font-bold shadow-sm transition-all">Add Calendar</a>
                      </div>
                   </div>
                 ) : (
                    <button type="button" onClick={initCallback} className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-yellow-400 hover:text-yellow-600 hover:bg-yellow-50 transition-all font-semibold flex items-center justify-center gap-2"><Plus size={16} /> Agendar Retorno</button>
                 )}

                 {/* AGENDA - REUNIÃO */}
                 {lead.meetingDate !== null ? (
                   <div className="bg-emerald-50 p-5 rounded-lg border border-emerald-200 shadow-sm relative animate-in zoom-in-95 duration-200">
                      <button type="button" onClick={requestClearMeeting} className="absolute top-3 right-3 text-emerald-600 hover:text-red-600 transition-colors p-1 cursor-pointer z-10" title="Remover agendamento"><Trash2 size={16} /></button>
                      <h4 className="text-emerald-800 font-bold text-sm mb-4 uppercase tracking-wide flex items-center gap-2"><Calendar size={14} /> Reunião Agendada</h4>
                      <div className="space-y-3">
                         <select value={lead.meetingType} onChange={(e) => handleChange('meetingType', e.target.value)} className="w-full p-2 bg-white border border-emerald-300 rounded-md text-sm text-gray-800">
                            <option value="">Selecione o Tipo...</option><option value="Primeira Reunião">Primeira Reunião</option><option value="Alinhamento">Alinhamento</option><option value="Fechamento">Fechamento</option>
                         </select>
                         <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div className="relative">
                              <Calendar className="absolute left-2.5 top-1/2 -translate-y-1/2 text-emerald-600 pointer-events-none" size={16} />
                              <input 
                                type="date" 
                                value={lead.meetingDate || ''} 
                                onChange={(e) => handleChange('meetingDate', e.target.value)} 
                                className="w-full p-2 pl-9 bg-white border border-emerald-300 rounded-md text-sm text-gray-800 cursor-pointer date-input"
                                style={{ colorScheme: 'light' }}
                              />
                            </div>
                            <input
                              type="time"
                              value={lead.meetingTime || ''}
                              onChange={(e) => handleChange('meetingTime', e.target.value)}
                              className="w-full p-2 bg-white border border-emerald-300 rounded-md text-sm text-gray-800 time-input"
                            />
                         </div>
                         <a href={meetingLink} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 w-full py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-md text-sm font-bold shadow-sm transition-all">Add Calendar</a>
                      </div>
                   </div>
                 ) : (
                    <button type="button" onClick={initMeeting} className="w-full py-3 border-2 border-dashed border-gray-300 text-gray-500 rounded-lg hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50 transition-all font-semibold flex items-center justify-center gap-2"><Plus size={16} /> Agendar Reunião</button>
                 )}
              </div>
            </div>
          )}

          {activeTab === 'script' && (
            <div className={`flex flex-col h-full bg-white ${isScriptFullscreen ? 'p-8' : 'p-4 md:p-6 space-y-4'}`}>
              
              {!isScriptFullscreen && (
                <div className="shrink-0 space-y-5">
                  {/* HELPER CARDS - OBJECTIONS - LOGICALLY GROUPED */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    
                    {/* GROUP 1: GATEKEEPER */}
                    <div className="bg-purple-50/50 rounded-xl p-3 border border-purple-100">
                       <h5 className="text-[10px] font-bold text-purple-800 uppercase tracking-widest mb-2 flex items-center gap-1">
                         <ShieldAlert size={12} /> Quebra de Barreira (Entrada)
                       </h5>
                       <div className="flex flex-wrap gap-2">
                          {SCRIPT_PILLS.filter(p => p.type === 'gatekeeper').map((pill) => (
                            <button
                              key={pill.id}
                              onClick={() => setActivePill(activePill?.id === pill.id ? null : pill)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-sm ${
                                 activePill?.id === pill.id 
                                 ? 'bg-purple-600 text-white border-purple-600 ring-2 ring-purple-200' 
                                 : 'bg-white text-gray-600 border-gray-200 hover:border-purple-300 hover:text-purple-600'
                              }`}
                            >
                               <pill.icon size={12} /> {pill.label}
                            </button>
                          ))}
                       </div>
                    </div>

                    {/* GROUP 2: OBJECTIONS */}
                    <div className="bg-gray-50/50 rounded-xl p-3 border border-gray-100">
                       <h5 className="text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 flex items-center gap-1">
                         <Lock size={12} /> Contorno de Objeções (Saída)
                       </h5>
                       <div className="flex flex-wrap gap-2">
                          {SCRIPT_PILLS.filter(p => p.type === 'objection').map((pill) => (
                            <button
                              key={pill.id}
                              onClick={() => setActivePill(activePill?.id === pill.id ? null : pill)}
                              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-bold transition-all border shadow-sm ${
                                 activePill?.id === pill.id 
                                 ? 'bg-gray-800 text-white border-gray-800 ring-2 ring-gray-200' 
                                 : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-900'
                              }`}
                            >
                               <pill.icon size={12} /> {pill.label}
                            </button>
                          ))}
                       </div>
                    </div>
                  </div>
                  
                  {/* ACTIVE PILL DISPLAY - CONTEXTUAL HELP */}
                  {activePill && (
                     <div className="animate-in fade-in slide-in-from-top-2 bg-gray-900 text-white p-4 rounded-xl shadow-xl relative border border-gray-800">
                        <button onClick={() => setActivePill(null)} className="absolute top-2 right-2 text-gray-500 hover:text-white p-1"><X size={14} /></button>
                        <div className="flex items-center gap-2 mb-2 text-blue-300 text-[10px] font-bold uppercase tracking-wide">
                           <MessageSquare size={12} /> Sugestão de Resposta
                        </div>
                        <p className="text-sm md:text-base font-medium leading-relaxed font-mono tracking-tight text-gray-100">
                           {activePill.content}
                        </p>
                     </div>
                  )}
                </div>
              )}

              {/* EDITOR AREA - PROFESSIONAL SAAS LOOK */}
              <div className={`flex-1 flex flex-col relative bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden transition-all focus-within:ring-2 focus-within:ring-blue-500/20 focus-within:border-blue-400 ${isScriptFullscreen ? 'fixed inset-0 z-50 rounded-none border-0' : ''}`}>
                
                {/* EDITOR TOOLBAR */}
                <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100 bg-gray-50/50">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-gray-400">
                      {scriptMode === 'auto' ? 'Gerado por IA' : 'Editado Manualmente'}
                    </span>
                    <div
                      className="flex items-center rounded-full border border-gray-200 bg-white p-0.5 text-[10px] font-semibold"
                      title="Alternar modo do script"
                    >
                      <button
                        type="button"
                        onClick={applyAutoScript}
                        className={`px-2 py-0.5 rounded-full transition ${
                          scriptMode === 'auto'
                            ? 'bg-gray-900 text-white'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Auto
                      </button>
                      <button
                        type="button"
                        onClick={enableManualScript}
                        className={`px-2 py-0.5 rounded-full transition ${
                          scriptMode === 'custom'
                            ? 'bg-gray-900 text-white'
                            : 'text-gray-500 hover:text-gray-700'
                        }`}
                      >
                        Manual
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                     <button onClick={copyScript} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-white rounded-md transition-all" title="Copiar"><Copy size={16} /></button>
                     <button onClick={() => setIsScriptFullscreen(!isScriptFullscreen)} className="p-1.5 text-gray-500 hover:text-gray-900 hover:bg-white rounded-md transition-all" title={isScriptFullscreen ? "Minimizar" : "Tela Cheia"}>
                        {isScriptFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                     </button>
                  </div>
                </div>

                {/* EDITOR CONTENT OR EMPTY STATE */}
                <div className="relative flex-1 bg-white">
                  {isScriptMissingData ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center p-8 text-center bg-gray-50/30">
                       <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center shadow-sm border border-dashed border-gray-300 mb-4">
                          <FileText className="text-gray-300" size={32} />
                       </div>
                       <h3 className="text-gray-900 font-bold text-lg mb-1">Dados Insuficientes</h3>
                       <p className="text-gray-500 text-sm max-w-xs leading-relaxed">
                         Preencha <strong>Segmento</strong> e <strong>Empresa</strong> na aba Operacional para gerar o diagnóstico.
                       </p>
                       <button onClick={() => setActiveTab('workspace')} className="mt-4 text-blue-600 font-bold text-sm hover:underline flex items-center gap-1">
                         Ir para dados <ChevronRight size={14} />
                       </button>
                    </div>
                  ) : (
                    <textarea 
                      className={`w-full h-full p-6 text-gray-800 text-base md:text-lg leading-relaxed resize-none outline-none font-sans bg-transparent script-scroll`} 
                      value={script} 
                      onChange={handleScriptChange} 
                      readOnly={scriptMode === 'auto'}
                      spellCheck={false} 
                      placeholder="O script aparecerá aqui..." 
                    />
                  )}
                </div>

              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {!isScriptFullscreen && (
        <div className="p-4 border-t border-gray-200 bg-white flex flex-col sm:flex-row sm:justify-end gap-3 shrink-0">
          <button onClick={onClose} className="w-full sm:w-auto px-6 py-2.5 rounded-lg text-gray-700 hover:bg-gray-100 font-medium transition-colors border border-transparent hover:border-gray-200">
            Cancelar
          </button>
          {onRequestDelete && (
            <button
              type="button"
              onClick={() => onRequestDelete(lead)}
              disabled={!lead.id}
              className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white font-medium flex items-center gap-2 justify-center transition-all shadow-md hover:shadow-lg active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
              title={lead.id ? "Excluir lead" : "Salve antes de excluir"}
            >
              <Trash2 size={18} /> Excluir
            </button>
          )}
          <button onClick={() => onSave(lead)} className="w-full sm:w-auto px-6 py-2.5 rounded-lg bg-gray-900 hover:bg-black text-white font-medium flex items-center gap-2 justify-center transition-all shadow-md hover:shadow-lg active:scale-95">
            <Save size={18} /> Salvar
          </button>
        </div>
        )}
      </div>

      {/* Reusable Confirm Modals */}
      <ConfirmationModal
        isOpen={confirmModal.isOpen && confirmModal.type === 'callback'}
        onClose={() => setConfirmModal({ isOpen: false, type: null })}
        onConfirm={handleConfirmAction}
        title="Remover Agendamento"
        message="Deseja remover o Retorno Agendado deste lead?"
        confirmText="Sim, Remover"
        type="warning"
      />
      
      <ConfirmationModal
        isOpen={confirmModal.isOpen && confirmModal.type === 'meeting'}
        onClose={() => setConfirmModal({ isOpen: false, type: null })}
        onConfirm={handleConfirmAction}
        title="Remover Agendamento"
        message="Deseja remover a Reunião Agendada deste lead?"
        confirmText="Sim, Remover"
        type="warning"
      />

      <ConfirmationModal
        isOpen={!!pendingExternalLink}
        onClose={() => setPendingExternalLink(null)}
        onConfirm={() => {
          if (pendingExternalLink?.url) {
            window.open(pendingExternalLink.url, '_blank', 'noopener,noreferrer');
          }
        }}
        title={`Abrir ${pendingExternalLink?.label || 'link'}?`}
        message="Isso vai abrir uma nova aba. Você continuará nesta tela."
        confirmText="Abrir"
        cancelText="Cancelar"
        type="info"
        icon={ExternalLink}
      />
    </div>
  );
};

export default LeadModal;

import React, { useState, useEffect, useRef } from 'react';
import { Lead, LeadStatus, ContactPersonType, SitePainPoint, SiteState } from '../types';
import { generateDiagnosticScript } from '../utils';
import { X, Phone, Clock, Calendar, ThumbsDown, ThumbsUp, ArrowRight, Zap, ShieldAlert, UserCheck, Timer, Shuffle } from 'lucide-react';

type BlitzCategory = 'new' | 'followup';

interface Props {
  queue: Lead[];
  topSegments: string[];
  category: BlitzCategory;
  categoryCounts: Record<BlitzCategory, number>;
  onCategoryChange: (category: BlitzCategory) => void;
  onClose: () => void;
  onProcess: (leadId: string, updates: Partial<Lead>) => void;
  onDelete: (leadId: string) => void;
}

type BlitzStep = 'CONNECT' | 'OUTCOME' | 'REFINE_NOT_INTERESTED' | 'REFINE_NO_TIME' | 'SCHEDULE';

const BlitzMode: React.FC<Props> = ({ queue, topSegments, category, categoryCounts, onCategoryChange, onClose, onProcess, onDelete }) => {
  const [currentLeadId, setCurrentLeadId] = useState<string | null>(() => queue[0]?.id ?? null);
  const [isRandomMode, setIsRandomMode] = useState(false);
  const [localQueue, setLocalQueue] = useState<Lead[]>(() => queue);
  const [scriptVariant, setScriptVariant] = useState<'micro' | 'full'>('micro');
  const [yearsDraft, setYearsDraft] = useState<number | ''>('');
  const [callbackDraftDate, setCallbackDraftDate] = useState('');
  const [callbackDraftTime, setCallbackDraftTime] = useState('09:00');
  const [callbackRequesterType, setCallbackRequesterType] = useState<ContactPersonType | ''>('');
  const [callbackRequesterName, setCallbackRequesterName] = useState('');
  const [gkName, setGkName] = useState('');
  const [gkConfirmStage, setGkConfirmStage] = useState(false);
  const [foundationHint, setFoundationHint] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState<
    | null
    | { type: 'gatekeeper' }
    | { type: 'meeting' }
    | { type: 'delete' }
    | { type: 'no_whatsapp'; nextDate: string; nextTime: string }
    | { type: 'whatsapp_sent'; nextDate: string; nextTime: string }
    | { type: 'email_sent'; nextDate: string; nextTime: string }
  >(null);
  const [step, setStep] = useState<BlitzStep>('CONNECT');
  const [sessionStart] = useState(new Date());
  const [leadsProcessed, setLeadsProcessed] = useState(0);
  const [elapsedTime, setElapsedTime] = useState('00:00');

  const lastKnownIndexRef = useRef(0);
  const handleCategoryChange = (nextCategory: BlitzCategory) => {
    if (nextCategory === category) return;
    setPendingConfirm(null);
    setStep('CONNECT');
    setIsRandomMode(false);
    lastKnownIndexRef.current = 0;
    setCurrentLeadId(null);
    onCategoryChange(nextCategory);
  };
  const currentIndex = currentLeadId ? localQueue.findIndex((lead) => lead.id === currentLeadId) : -1;
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  const currentLead = localQueue[safeIndex];
  const [localLead, setLocalLead] = useState<Lead | undefined>(currentLead);
  const quickPhone = localLead?.decisors[0]?.phone || localLead?.attendants[0]?.phone || '';
  const whatsappLink = quickPhone ? `https://wa.me/${quickPhone.replace(/\D/g, '')}` : '';
  const foundationQuery = localLead?.originLink
    ? `Tempo de fundacao da empresa ${localLead.companyName || ''} link do googlemaps ${localLead.originLink}`
    : `Tempo de fundacao da empresa ${localLead?.companyName || ''} link do googlemaps`;
  const withHttp = (link: string) => (link.startsWith('http') ? link : `https://${link}`);
  const mapsHref = localLead?.originLink ? withHttp(localLead.originLink) : '';

  const shuffleLeads = (items: Lead[]) => {
    const arr = [...items];
    for (let i = arr.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  useEffect(() => {
    setLocalQueue((prev) => {
      if (queue.length === 0) return [];
      if (!isRandomMode) return queue;
      const incomingMap = new Map(queue.map((lead) => [lead.id, lead]));
      const ordered = prev
        .filter((lead) => incomingMap.has(lead.id))
        .map((lead) => incomingMap.get(lead.id) as Lead);
      const orderedIds = new Set(ordered.map((lead) => lead.id));
      const newOnes = queue.filter((lead) => !orderedIds.has(lead.id));
      if (ordered.length === 0) {
        return shuffleLeads(queue);
      }
      if (newOnes.length === 0) {
        return ordered;
      }
      return [...ordered, ...shuffleLeads(newOnes)];
    });
  }, [queue, isRandomMode]);

  useEffect(() => {
    if (!localQueue.length) {
      setCurrentLeadId(null);
      return;
    }
    const idx = currentLeadId ? localQueue.findIndex((lead) => lead.id === currentLeadId) : -1;
    if (idx !== -1) {
      lastKnownIndexRef.current = idx;
      return;
    }
    const nextIndex = Math.min(lastKnownIndexRef.current, localQueue.length - 1);
    setCurrentLeadId(localQueue[nextIndex].id);
  }, [localQueue, currentLeadId]);

  useEffect(() => {
    if (currentLead) {
      setLocalLead(currentLead);
      setYearsDraft(currentLead.yearsInBusiness || '');
    }
  }, [currentLead?.id, currentLead?.updatedAt]);
  const scriptText = localLead?.customScript?.trim()
    ? localLead.customScript
    : localLead
      ? generateDiagnosticScript(localLead, scriptVariant)
      : '';

  // Timer da sessão
  useEffect(() => {
    const timer = setInterval(() => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - sessionStart.getTime()) / 1000);
      const m = Math.floor(diff / 60).toString().padStart(2, '0');
      const s = (diff % 60).toString().padStart(2, '0');
      setElapsedTime(`${m}:${s}`);
    }, 1000);
    return () => clearInterval(timer);
  }, [sessionStart]);

  if (!currentLead) {
    return (
      <div className="fixed inset-0 bg-gray-900 text-white flex flex-col items-center justify-center z-50">
        <h2 className="text-4xl font-bold mb-4">Blitz Finalizada! 🚀</h2>
        <p className="text-xl text-gray-400 mb-8">Você processou {leadsProcessed} leads em {elapsedTime}.</p>
        <button onClick={onClose} className="px-8 py-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-bold">
          Voltar ao Dashboard
        </button>
      </div>
    );
  }

  // --- HELPER: DATAS ---
  const getFutureDate = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().split('T')[0];
  };

  const getTodayTime = () => {
    const d = new Date();
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
  };

  const handleRandomize = () => {
    if (!localQueue.length) return;
    let shuffled = shuffleLeads(localQueue);
    if (shuffled.length > 1 && currentLeadId && shuffled[0]?.id === currentLeadId) {
      [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
    }
    setIsRandomMode(true);
    setPendingConfirm(null);
    setStep('CONNECT');
    setLocalQueue(shuffled);
    if (shuffled[0]) {
      lastKnownIndexRef.current = 0;
      setCurrentLeadId(shuffled[0].id);
    }
  };

  const handleSegmentJump = (segment: string) => {
    if (!segment) return;
    setPendingConfirm(null);
    setStep('CONNECT');
    if (isRandomMode) {
      setIsRandomMode(false);
    }
    const nextQueue = queue;
    const idx = nextQueue.findIndex((lead) => lead.segment === segment);
    if (idx === -1) return;
    lastKnownIndexRef.current = idx;
    setLocalQueue(nextQueue);
    setCurrentLeadId(nextQueue[idx].id);
  };

  useEffect(() => {
    if (step === 'REFINE_NO_TIME') {
      const autoDecisor = localLead?.decisors?.[0]?.name?.trim() || '';
      const autoAtendente = localLead?.attendants?.[0]?.name?.trim() || '';
      setCallbackDraftDate(getFutureDate(1));
      setCallbackDraftTime('09:00');
      if (autoDecisor) {
        setCallbackRequesterType(ContactPersonType.DECISOR);
        setCallbackRequesterName(autoDecisor);
      } else if (autoAtendente) {
        setCallbackRequesterType(ContactPersonType.EMPRESA);
        setCallbackRequesterName(autoAtendente);
      } else {
        setCallbackRequesterType('');
        setCallbackRequesterName('');
      }
    }
  }, [step, currentLead?.id]);

  // --- LOGICA CENTRAL DE PROCESSAMENTO ---

  const handleNext = () => {
    setPendingConfirm(null);
    setGkConfirmStage(false);
    setGkName('');
    setLeadsProcessed(prev => prev + 1);
    setStep('CONNECT');
    if (!localQueue.length) {
      onClose();
      return;
    }
    if (safeIndex < localQueue.length - 1) {
      const nextIndex = safeIndex + 1;
      lastKnownIndexRef.current = nextIndex;
      setCurrentLeadId(localQueue[nextIndex].id);
    } else {
      onClose(); // Ou mostrar tela de fim
    }
  };

  const applyUpdate = (updates: Partial<Lead>) => {
    if (!currentLead) return;
    onProcess(currentLead.id, {
      ...updates,
      lastContactDate: new Date().toISOString(), // Marca que tentou agora
    });
    handleNext();
  };

  const applyTalkUpdate = (updates: Partial<Lead>) => {
    applyUpdate({
      lastContactPerson: ContactPersonType.DECISOR,
      channelLastAttempt: 'Ligação',
      ...updates
    });
  };

  const applyQuickUpdate = (updates: Partial<Lead>) => {
    setLocalLead((prev) => (prev ? { ...prev, ...updates } : prev));
    onProcess(currentLead.id, updates);
  };

  const painPointOrder: SitePainPoint[] = [
    SitePainPoint.NAO_RESPONSIVO,
    SitePainPoint.SEM_SSL,
    SitePainPoint.LENTO,
    SitePainPoint.BOTOES_QUEBRADOS,
    SitePainPoint.LAYOUT_QUEBRADO,
    SitePainPoint.DESORGANIZACAO,
    SitePainPoint.SEM_CTA,
    SitePainPoint.CORES_AMADORAS,
    SitePainPoint.TEMPLATE_GENERICO,
    SitePainPoint.BLOG_PARADO,
  ];

  const togglePainPoint = (point: SitePainPoint) => {
    const next = localLead?.sitePainPoints?.includes(point)
      ? localLead.sitePainPoints.filter((item) => item !== point)
      : [...(localLead?.sitePainPoints || []), point];
    applyQuickUpdate({ sitePainPoints: next });
  };

  const handleFoundationSearch = () => {
    const win = window.open('about:blank', '_blank');
    if (win) {
      try {
        win.focus();
      } catch {
        // ignore focus errors
      }
    }
    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(foundationQuery);
    }
    setFoundationHint(true);
    window.setTimeout(() => setFoundationHint(false), 2200);
  };

  // 1. FALHA NA CONEXÃO (GK / Cx Postal)
  const applyGatekeeper = (name?: string) => {
    const trimmedName = (name || '').trim();
    applyUpdate({
      attempts: (currentLead.attempts || 0) + 1,
      status: currentLead.status === LeadStatus.NOVO ? LeadStatus.DECISOR_NAO_ATENDEU : currentLead.status,
      lastContactPerson: ContactPersonType.EMPRESA,
      channelLastAttempt: 'Ligação',
      nextAttemptDate: getFutureDate(1),
      nextAttemptTime: '09:00',
      nextAttemptChannel: 'Ligação',
      notes: (localLead?.notes || currentLead.notes || '') + `\n[BLITZ] GK Barrou${trimmedName ? ` (${trimmedName})` : ''}.`
    });
  };

  const handleConnectFail = (type: 'gatekeeper' | 'voicemail') => {
    const isGK = type === 'gatekeeper';
    if (isGK) {
      setGkName('');
      setGkConfirmStage(false);
      setPendingConfirm({ type: 'gatekeeper' });
      return;
    }
    applyUpdate({
      attempts: (currentLead.attempts || 0) + 1,
      status: currentLead.status === LeadStatus.NOVO ? LeadStatus.DECISOR_NAO_ATENDEU : currentLead.status,
      lastContactPerson: ContactPersonType.DECISOR,
      channelLastAttempt: 'Ligação',
      nextAttemptDate: getFutureDate(1), // Tenta amanhã
      nextAttemptTime: '15:00',
      nextAttemptChannel: 'Ligação',
      notes: (localLead?.notes || currentLead.notes || '') + '\n[BLITZ] Caixa Postal.'
    });
  };

  const handleNoWhatsapp = () => {
    if (!currentLead) return;
    const nextDate = getFutureDate(1);
    const nextTime = getTodayTime();
    setPendingConfirm({ type: 'no_whatsapp', nextDate, nextTime });
  };

  const handleWhatsappSent = () => {
    if (!currentLead) return;
    const nextDate = getFutureDate(1);
    const nextTime = getTodayTime();
    setPendingConfirm({ type: 'whatsapp_sent', nextDate, nextTime });
  };

  const handleEmailSent = () => {
    if (!currentLead) return;
    const nextDate = getFutureDate(1);
    const nextTime = getTodayTime();
    setPendingConfirm({ type: 'email_sent', nextDate, nextTime });
  };

  const handleDeleteLead = () => {
    if (!currentLead) return;
    setPendingConfirm({ type: 'delete' });
  };

  // 2. REFINAMENTO: NÃO TEM INTERESSE (REGRA CRÍTICA)
  const handleNotInterestedReason = (reason: 'rude' | 'provider' | 'relative' | 'blind' | 'timing') => {
    const baseNote = (localLead?.notes || currentLead.notes || '') + '\n[BLITZ] Não Interessado: ';
    const currentAttempts = (localLead?.attempts || currentLead.attempts || 0) + 1;

    switch (reason) {
      case 'rude': // Ignorante / Grosso
        applyTalkUpdate({
          status: LeadStatus.NAO_TENTAR_MAIS,
          attempts: currentAttempts,
          nextAttemptDate: null,
          discardReason: 'Ignorante/Grosso na call (Blitz)',
          notes: baseNote + 'Ignorante/Hard. Descartado.'
        });
        break;
      case 'provider': // Já tem quem cuida
        applyTalkUpdate({
          status: LeadStatus.DECISOR_INTERESSADO,
          attempts: currentAttempts,
          nextAttemptDate: getFutureDate(7),
          nextAttemptChannel: 'Ligação',
          notes: baseNote + 'Já tem fornecedor. Tentar deslocar concorrente.'
        });
        break;
      case 'relative': // Parente cuida
        applyTalkUpdate({
          status: LeadStatus.DECISOR_INTERESSADO,
          attempts: currentAttempts,
          nextAttemptDate: getFutureDate(5),
          nextAttemptChannel: 'Ligação',
          notes: baseNote + 'Parente faz. Tentar abordagem profissional.'
        });
        break;
      case 'blind': // Não entendeu importância
        applyTalkUpdate({
          status: LeadStatus.DECISOR_INTERESSADO,
          attempts: currentAttempts,
          nextAttemptDate: getFutureDate(3),
          nextAttemptChannel: 'Ligação',
          notes: baseNote + 'Não viu valor. Tentar nova abordagem educativa.'
        });
        break;
      case 'timing': // Sem prioridade agora
        applyTalkUpdate({
          status: LeadStatus.DECISOR_FRIO,
          attempts: currentAttempts,
          nextAttemptDate: getFutureDate(30),
          nextAttemptChannel: 'Ligação',
          notes: baseNote + 'Sem prioridade agora. (#objection_timing)'
        });
        break;
    }
  };

  // 3. REFINAMENTO: SEM TEMPO
  const handleScheduleCallback = () => {
    if (!callbackDraftDate) return;
    const trimmedName = callbackRequesterName.trim();
    applyTalkUpdate({
      status: localLead?.status || currentLead.status, // Não muda status
      attempts: (localLead?.attempts || currentLead.attempts || 0) + 1,
      callbackDate: callbackDraftDate,
      callbackTime: callbackDraftTime || undefined,
      callbackRequestedBy: callbackRequesterType || ContactPersonType.NAO_ATRIBUIDO,
      callbackRequesterName: trimmedName || null,
      notes: (localLead?.notes || currentLead.notes || '') +
        `\n[BLITZ] Pediu retorno${callbackRequesterType ? ` (${callbackRequesterType}${trimmedName ? ` - ${trimmedName}` : ''})` : ''}.`
    });
  };

  // 4. SUCESSOS DIRETOS
  const handleMeeting = () => {
    setPendingConfirm({ type: 'meeting' });
  };

  const handleGoodTalk = () => {
    // Conversa boa mas não agendou -> Interessado + Followup curto
    applyTalkUpdate({
      status: LeadStatus.DECISOR_INTERESSADO,
      attempts: (localLead?.attempts || currentLead.attempts || 0) + 1,
      nextAttemptDate: getFutureDate(3),
      nextAttemptChannel: 'Ligação',
      notes: (localLead?.notes || currentLead.notes || '') + '\n[BLITZ] Conversa boa, avançar relacionamento.'
    });
  };

  // --- RENDERIZAÇÃO ---

  return (
    <div className="fixed inset-0 bg-slate-900 text-slate-100 z-[100] flex flex-col">
      {/* HEADER: META & TEMPO */}
      <div className="h-16 bg-slate-800 border-b border-slate-700 flex items-center justify-between px-6 shadow-md">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-yellow-400 font-bold text-xl">
            <Zap className="fill-current" /> BLITZ MODE
          </div>
          <div className="bg-slate-700 px-3 py-1 rounded-full text-sm font-mono text-slate-300 flex items-center gap-2">
            <Timer size={14} /> {elapsedTime}
          </div>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-slate-400 font-medium">Lead {localQueue.length ? safeIndex + 1 : 0} de {localQueue.length}</span>
          <button onClick={onClose} className="p-2 hover:bg-slate-700 rounded-full text-slate-400 hover:text-white transition">
            <X size={24} />
          </button>
        </div>
      </div>

      {/* MAIN CARD: INFORMAÇÃO VITAL (Flashcard) */}
      <div className="flex-1 flex flex-col items-center justify-start p-6 pt-32 pb-10 bg-slate-900 overflow-y-auto">
        <div className="w-full max-w-3xl bg-slate-800 rounded-2xl shadow-2xl p-8 border border-slate-700 mt-4">
          {/* IDENTIFICAÇÃO GIGANTE */}
          <div className="text-center mb-8">
            {(topSegments.length > 0 || localQueue.length > 0) && (
              <div className="flex flex-col items-center gap-3 mb-4">
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {([
                    { key: 'new', label: 'Novos' },
                    { key: 'followup', label: 'Follow-up (Hoje)' }
                  ] as Array<{ key: BlitzCategory; label: string }>).map((item) => {
                    const isActive = category === item.key;
                    const count = categoryCounts[item.key];
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => handleCategoryChange(item.key)}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition ${
                          isActive
                            ? 'bg-slate-200 text-slate-900 border-slate-200'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                        title={item.key === 'new' ? 'Leads novos sem próximo contato' : 'Follow-ups do dia'}
                      >
                        {item.label} ({count})
                      </button>
                    );
                  })}
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  {topSegments.map((segment) => {
                    const isActive = localLead?.segment === segment;
                    return (
                      <button
                        key={segment}
                        type="button"
                        onClick={() => handleSegmentJump(segment)}
                        className={`px-3 py-1 rounded-full text-[11px] font-semibold border transition ${
                          isActive
                            ? 'bg-slate-200 text-slate-900 border-slate-200'
                            : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                        }`}
                        title={`Ir para ${segment}`}
                      >
                        {segment}
                      </button>
                    );
                  })}
                  {localQueue.length > 0 && (
                    <button
                      type="button"
                      onClick={handleRandomize}
                      className={`inline-flex items-center gap-2 px-3 py-1 rounded-full border text-[11px] font-semibold transition ${
                        isRandomMode
                          ? 'bg-slate-200 text-slate-900 border-slate-200'
                          : 'bg-slate-700 text-slate-200 border-slate-600 hover:bg-slate-600'
                      }`}
                      title="Misturar ordem dos leads"
                    >
                      <Shuffle size={12} />
                      Random
                    </button>
                  )}
                </div>
              </div>
            )}
            <h1 className="text-4xl md:text-5xl font-black text-white mb-2 tracking-tight">
              {localLead?.companyName}
            </h1>
            <div className="text-xl text-slate-400 font-light flex justify-center gap-2">
              {localLead?.segment} • {localLead?.decisors[0]?.name || 'Decisor não ident.'}
            </div>
          </div>

          {/* BATTLE CARDS (PILLS) */}
          <div className="flex flex-wrap items-center justify-center gap-2 mb-6">
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-700 text-slate-100 border border-slate-600">
              Status: {localLead?.status || 'N/A'}
            </span>
            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-700 text-slate-100 border border-slate-600">
              Tentativas: {localLead?.attempts ?? 0}
            </span>
            {localLead?.ticketPotential && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-emerald-800/50 text-emerald-100 border border-emerald-700">
                Ticket: {localLead.ticketPotential}
              </span>
            )}
            {localLead?.lastContactDate && (
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-700 text-slate-100 border border-slate-600">
                Ultimo contato: {new Date(localLead.lastContactDate).toLocaleDateString('pt-BR')}
              </span>
            )}
          </div>

          {/* TELEFONE HIPER-FOCO */}
          <div className="bg-slate-950 rounded-xl p-6 mb-6 text-center border border-slate-800">
            <div className="text-5xl md:text-6xl font-mono text-emerald-400 tracking-wider font-bold select-all">
              {quickPhone || 'Sem Telefone'}
            </div>
            <div className="text-slate-500 mt-2 text-sm uppercase tracking-widest font-bold">
              {localLead?.decisors[0]?.phone ? 'Telefone do Decisor' : 'Telefone Geral'}
            </div>
            {!quickPhone && (
              <div className="text-xs text-slate-600 mt-2">
                Sem telefone cadastrado para decisor/recepcao.
              </div>
            )}
          </div>

          {/* LINKS RAPIDOS */}
          <div className="flex flex-wrap items-center justify-center gap-3 mb-3">
            {mapsHref ? (
              <a
                href={mapsHref}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 text-sm font-semibold hover:bg-slate-700"
              >
                Maps
              </a>
            ) : (
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-500 text-sm font-semibold">
                Sem link do Maps
              </span>
            )}
            <button
              type="button"
              onClick={handleFoundationSearch}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 text-sm font-semibold hover:bg-slate-700"
            >
              Tempo de fundacao
            </button>
            {localLead?.siteUrl ? (
              <a
                href={localLead.siteUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-700/60 border border-slate-600 text-slate-100 text-sm font-semibold hover:bg-slate-700"
              >
                Site
              </a>
            ) : (
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-500 text-sm font-semibold">
                Sem site
              </span>
            )}
            {whatsappLink ? (
              <a
                href={whatsappLink}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-700/70 border border-emerald-600 text-emerald-50 text-sm font-semibold hover:bg-emerald-700"
              >
                WhatsApp
              </a>
            ) : (
              <span className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-800 border border-slate-700 text-slate-500 text-sm font-semibold">
                Sem WhatsApp
              </span>
            )}
          </div>
          {foundationHint && (
            <div className="mb-6 flex items-center justify-center">
              <div className="rounded-full bg-slate-700/80 border border-slate-600 px-3 py-1 text-xs text-slate-200 shadow-sm">
                Consulta copiada. Cole na barra de enderecos.
              </div>
            </div>
          )}

          {/* PEPITA DE OURO (Se existir) */}
          <div className="bg-amber-900/30 border border-amber-700/50 p-4 rounded-lg mb-6">
            <h4 className="text-amber-500 text-xs font-bold uppercase tracking-wide mb-1 flex items-center gap-1">
              <Zap size={12} /> Golden Nugget
            </h4>
            <p className="text-amber-100 font-medium text-lg leading-relaxed">
              {/* Simulando a pepita extraída das notas ou payload */}
              {localLead?.notes?.includes('Pepita:')
                ? localLead.notes.split('Pepita:')[1].split('\n')[0]
                : '💡 Pesquise algo rápido no Google Maps/Instagram antes de ligar.'}
            </p>
          </div>

          {/* CONTROLES RAPIDOS: SITE/DORES/TEMPO */}
          <div className="bg-slate-900/60 border border-slate-700 p-4 rounded-lg mb-6">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-slate-300 text-xs font-bold uppercase tracking-wide">Ajustes rapidos</h4>
              <span className="text-[11px] text-slate-500">Clique nas dores para marcar/desmarcar</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                <label className="block text-[11px] text-slate-400 mb-2 uppercase tracking-wide">Situacao do site</label>
                <select
                  value={localLead?.siteState || ''}
                  onChange={(e) => applyQuickUpdate({ siteState: e.target.value as SiteState })}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2"
                >
                  <option value="">Nao informado</option>
                  {Object.values(SiteState).map((state) => (
                    <option key={state} value={state}>
                      {state}
                    </option>
                  ))}
                </select>
              </div>

              <div className="bg-slate-950/40 border border-slate-800 rounded-lg p-3">
                <label className="block text-[11px] text-slate-400 mb-2 uppercase tracking-wide">Tempo de empresa (anos)</label>
                <input
                  type="number"
                  min={0}
                  value={yearsDraft}
                  onChange={(e) => {
                    const nextValue = e.target.value === '' ? '' : Number(e.target.value);
                    setYearsDraft(nextValue);
                    applyQuickUpdate({ yearsInBusiness: nextValue === '' ? undefined : Number(nextValue) });
                  }}
                  className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2"
                />
              </div>
            </div>

            <div className="mt-4 bg-slate-950/40 border border-slate-800 rounded-lg p-3">
              <label className="block text-[11px] text-slate-400 mb-3 uppercase tracking-wide">Dores do site</label>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {painPointOrder.map((point) => {
                  const active = localLead?.sitePainPoints?.includes(point);
                  return (
                    <button
                      key={point}
                      onClick={() => togglePainPoint(point)}
                      className={`px-3 py-2 rounded-lg text-[12px] font-semibold border transition text-left ${
                        active
                          ? 'bg-amber-700/70 text-amber-100 border-amber-600'
                          : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                      }`}
                      type="button"
                    >
                      {point}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* SITE: SITUACAO + DORES */}
          <div className="bg-slate-900/60 border border-slate-700 p-4 rounded-lg mb-6">
            <h4 className="text-slate-300 text-xs font-bold uppercase tracking-wide mb-2">Diagnostico do Site</h4>
            <div className="text-sm text-slate-200 mb-2">
              <span className="text-slate-400">Situacao:</span>{' '}
              {localLead?.siteState || 'Nao informado'}
              {localLead?.siteUrl ? (
                <span className="text-slate-500"> • {localLead.siteUrl}</span>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-2">
              {localLead?.sitePainPoints?.length ? (
                localLead.sitePainPoints.map((pain) => (
                  <span key={pain} className="text-xs bg-slate-800 text-slate-200 px-2 py-1 rounded-full border border-slate-700">
                    {pain}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-500">Sem dores registradas.</span>
              )}
            </div>
          </div>

          {/* SCRIPT */}
          <div className="bg-slate-950 rounded-xl p-4 border border-slate-800">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-slate-300 text-xs font-bold uppercase tracking-wide">Script</h4>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setScriptVariant('micro')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                    scriptVariant === 'micro'
                      ? 'bg-slate-200 text-slate-900 border-slate-200'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  Micro
                </button>
                <button
                  onClick={() => setScriptVariant('full')}
                  className={`px-2.5 py-1 rounded-full text-xs font-semibold border transition ${
                    scriptVariant === 'full'
                      ? 'bg-slate-200 text-slate-900 border-slate-200'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  Full
                </button>
              </div>
            </div>
            <p className="text-slate-200 text-sm whitespace-pre-line leading-relaxed">
              {scriptText || 'Sem script definido.'}
            </p>
          </div>
        </div>
      </div>

      {/* ACTION DECK: CONTROLE DE FLUXO */}
      <div className="h-auto bg-slate-800 border-t border-slate-700 p-6 pb-10">
        <div className="max-w-4xl mx-auto">
          {/* ESTÁGIO 1: CONECTAR */}
          {step === 'CONNECT' && (
            <div className="space-y-3">
              <h3 className="text-center text-slate-400 uppercase tracking-widest font-bold text-xs">Conexao</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                onClick={() => handleConnectFail('gatekeeper')}
                className="action-btn bg-red-900/40 border-red-800 hover:bg-red-900/60 text-red-200 text-lg"
              >
                <ShieldAlert size={28} />
                ⛔ GK Barrou
              </button>
              
              <button 
                onClick={() => handleConnectFail('voicemail')}
                className="action-btn bg-orange-900/40 border-orange-800 hover:bg-orange-900/60 text-orange-200 text-lg"
              >
                <Phone size={28} />
                📞 Caixa Postal
              </button>

              <button 
                onClick={() => setStep('OUTCOME')}
                className="action-btn bg-emerald-600 border-emerald-500 hover:bg-emerald-500 text-white text-2xl shadow-lg shadow-emerald-900/50"
              >
                <UserCheck size={32} />
                FALAMOS!
              </button>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-3">
                <button
                  type="button"
                  onClick={handleEmailSent}
                  className="px-3 py-1.5 rounded-md border border-blue-600 text-xs font-semibold text-blue-100 hover:bg-blue-700/30"
                >
                  Mandei email
                </button>
                <button
                  type="button"
                  onClick={handleWhatsappSent}
                  className="px-3 py-1.5 rounded-md border border-emerald-600 text-xs font-semibold text-emerald-100 hover:bg-emerald-700/30"
                >
                  Mandei mensagem no WhatsApp
                </button>
                <button
                  type="button"
                  onClick={handleNoWhatsapp}
                  className="px-3 py-1.5 rounded-md border border-slate-600 text-xs font-semibold text-slate-200 hover:bg-slate-700/70"
                >
                  Sem WhatsApp
                </button>
                <button
                  type="button"
                  onClick={handleDeleteLead}
                  className="px-3 py-1.5 rounded-md border border-red-800 text-xs font-semibold text-red-200 hover:bg-red-900/40"
                >
                  Excluir lead
                </button>
              </div>
              {pendingConfirm?.type === 'gatekeeper' && (
                <div className="mt-3 bg-slate-900/80 border border-slate-700 rounded-lg px-4 py-3 space-y-2 text-sm">
                  <div className="text-slate-200 font-semibold">GK barrou</div>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <input
                      type="text"
                      value={gkName}
                      onChange={(e) => setGkName(e.target.value)}
                      placeholder="Nome da atendente (opcional)"
                      className="w-full bg-slate-800 border border-slate-700 text-slate-100 rounded-md px-3 py-2"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          if (!gkName.trim()) {
                            setPendingConfirm(null);
                            applyGatekeeper();
                            return;
                          }
                          if (!gkConfirmStage) {
                            setGkConfirmStage(true);
                            return;
                          }
                          setPendingConfirm(null);
                          applyGatekeeper(gkName);
                        }
                      }}
                    />
                    <button
                      onClick={() => {
                        if (!gkName.trim()) {
                          setPendingConfirm(null);
                          applyGatekeeper();
                          return;
                        }
                        if (!gkConfirmStage) {
                          setGkConfirmStage(true);
                          return;
                        }
                        setPendingConfirm(null);
                        applyGatekeeper(gkName);
                      }}
                      className="px-3 py-2 rounded-md bg-red-600 text-white font-semibold hover:bg-red-500"
                    >
                      {gkConfirmStage ? 'Ir proximo (Enter)' : 'Confirmar (Enter)'}
                    </button>
                    <button
                      onClick={() => setPendingConfirm(null)}
                      className="px-3 py-2 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600"
                    >
                      Cancelar
                    </button>
                  </div>
                  <div className="text-[11px] text-slate-400">
                    Enter: confirma. Se nome vazio, Enter vai direto para o proximo lead.
                  </div>
                </div>
              )}
              {pendingConfirm && (pendingConfirm.type === 'no_whatsapp' || pendingConfirm.type === 'whatsapp_sent' || pendingConfirm.type === 'email_sent' || pendingConfirm.type === 'delete') && (
                <div className="mt-3 bg-slate-900/90 border border-slate-700 rounded-xl px-4 py-3 text-sm shadow-xl relative">
                  <span className="absolute -top-1.5 left-6 h-3 w-3 rotate-45 bg-slate-900/90 border border-slate-700" />
                  {pendingConfirm.type === 'email_sent' && (
                    <>
                      <div className="text-blue-200 font-semibold">Email enviado</div>
                      <div className="text-slate-400 mt-1">
                        Confirmar próximo contato para amanhã ({pendingConfirm.nextDate}) às {pendingConfirm.nextTime}?
                      </div>
                    </>
                  )}
                  {pendingConfirm.type === 'whatsapp_sent' && (
                    <>
                      <div className="text-emerald-200 font-semibold">WhatsApp enviado</div>
                      <div className="text-slate-400 mt-1">
                        Confirmar próximo contato para amanhã ({pendingConfirm.nextDate}) às {pendingConfirm.nextTime}?
                      </div>
                    </>
                  )}
                  {pendingConfirm.type === 'no_whatsapp' && (
                    <>
                      <div className="text-slate-200 font-semibold">Sem WhatsApp</div>
                      <div className="text-slate-400 mt-1">
                        Confirmar próximo contato para amanhã ({pendingConfirm.nextDate}) às {pendingConfirm.nextTime}?
                      </div>
                    </>
                  )}
                  {pendingConfirm.type === 'delete' && (
                    <>
                      <div className="text-red-200 font-semibold">Excluir lead</div>
                      <div className="text-slate-400 mt-1">
                        Isso remove o lead permanentemente do dashboard. Confirmar?
                      </div>
                    </>
                  )}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => {
                        if (!currentLead) return;
                        if (pendingConfirm.type === 'email_sent') {
                          const { nextDate, nextTime } = pendingConfirm;
                          const currentAttempts = (localLead?.attempts || currentLead.attempts || 0) + 1;
                          setPendingConfirm(null);
                          applyUpdate({
                            attempts: currentAttempts,
                            lastContactPerson: ContactPersonType.DECISOR,
                            channelLastAttempt: 'Email',
                            nextAttemptDate: nextDate,
                            nextAttemptTime: nextTime,
                            nextAttemptChannel: 'Email',
                            notes: (localLead?.notes || currentLead.notes || '') +
                              `\n[BLITZ] Email enviado. Próximo contato ${nextDate} ${nextTime}.`
                          });
                          return;
                        }
                        if (pendingConfirm.type === 'whatsapp_sent') {
                          const { nextDate, nextTime } = pendingConfirm;
                          const currentAttempts = (localLead?.attempts || currentLead.attempts || 0) + 1;
                          setPendingConfirm(null);
                          applyUpdate({
                            attempts: currentAttempts,
                            lastContactPerson: ContactPersonType.DECISOR,
                            channelLastAttempt: 'WhatsApp Texto',
                            nextAttemptDate: nextDate,
                            nextAttemptTime: nextTime,
                            nextAttemptChannel: 'WhatsApp Texto',
                            notes: (localLead?.notes || currentLead.notes || '') +
                              `\n[BLITZ] WhatsApp enviado. Próximo contato ${nextDate} ${nextTime}.`
                          });
                          return;
                        }
                        if (pendingConfirm.type === 'no_whatsapp') {
                          const { nextDate, nextTime } = pendingConfirm;
                          const currentAttempts = (localLead?.attempts || currentLead.attempts || 0) + 1;
                          setPendingConfirm(null);
                          applyUpdate({
                            attempts: currentAttempts,
                            lastContactPerson: ContactPersonType.DECISOR,
                            channelLastAttempt: 'WhatsApp Texto',
                            nextAttemptDate: nextDate,
                            nextAttemptTime: nextTime,
                            nextAttemptChannel: 'Ligação',
                            notes: (localLead?.notes || currentLead.notes || '') +
                              `\n[BLITZ] Sem WhatsApp. Próximo contato ${nextDate} ${nextTime}.`
                          });
                          return;
                        }
                        if (pendingConfirm.type === 'delete') {
                          setPendingConfirm(null);
                          onDelete(currentLead.id);
                          handleNext();
                        }
                      }}
                      className={`px-3 py-1.5 rounded-md text-white font-semibold ${
                        pendingConfirm.type === 'delete'
                          ? 'bg-red-600 hover:bg-red-500'
                          : 'bg-blue-600 hover:bg-blue-500'
                      }`}
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setPendingConfirm(null)}
                      className="px-3 py-1.5 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ESTÁGIO 2: RESULTADO (BLOCO 2 LIMPO) */}
          {step === 'OUTCOME' && (
            <div className="space-y-3 animate-in slide-in-from-bottom-4">
              <h3 className="text-center text-slate-400 uppercase tracking-widest font-bold text-xs">Resultado</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
              {/* 1. Rápida / Sem tempo */}
              <button onClick={() => setStep('REFINE_NO_TIME')} className="action-btn bg-slate-700 hover:bg-slate-600 border-slate-600 text-white">
                <Clock className="mb-2" /> Rápida / Sem Tempo
              </button>

              {/* 2. Conversa Boa */}
              <button onClick={handleGoodTalk} className="action-btn bg-blue-900/50 hover:bg-blue-800 border-blue-700 text-blue-100">
                <ThumbsUp className="mb-2" /> Conversa Boa
              </button>

              {/* 3. Pediu Retorno (Explicitamente) */}
              <button onClick={() => setStep('REFINE_NO_TIME')} className="action-btn bg-purple-900/50 hover:bg-purple-800 border-purple-700 text-purple-100">
                <ArrowRight className="mb-2" /> Pediu Retorno
              </button>

              {/* 4. Marcou Reunião */}
              <button onClick={handleMeeting} className="action-btn bg-emerald-600 hover:bg-emerald-500 border-emerald-400 text-white font-bold ring-2 ring-emerald-500/30">
                <Calendar className="mb-2" /> Marcou Reunião
              </button>

              {/* 5. Não tem interesse (Gatilho de Perigo) */}
              <button onClick={() => setStep('REFINE_NOT_INTERESTED')} className="action-btn bg-red-600 hover:bg-red-500 border-red-400 text-white font-bold">
                <ThumbsDown className="mb-2" /> ❌ Sem Interesse
              </button>
              </div>
              {pendingConfirm?.type === 'meeting' && (
                <div className="mt-3 bg-slate-900/80 border border-slate-700 rounded-lg px-4 py-3 flex items-center justify-between gap-3 text-sm">
                  <span className="text-slate-200">Marcar reuniao agendada agora?</span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setPendingConfirm(null);
                        applyTalkUpdate({
                          status: LeadStatus.REUNIAO_MARCADA,
                          meetingDate: getFutureDate(2),
                          meetingTime: '10:00',
                          meetingType: 'Primeira Reunião',
                          notes: (localLead?.notes || '') + '\n[BLITZ] Reunião agendada!'
                        });
                      }}
                      className="px-3 py-1 rounded-md bg-emerald-600 text-white font-semibold hover:bg-emerald-500"
                    >
                      Confirmar
                    </button>
                    <button
                      onClick={() => setPendingConfirm(null)}
                      className="px-3 py-1 rounded-md bg-slate-700 text-slate-200 hover:bg-slate-600"
                    >
                      Cancelar
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ESTÁGIO 3: REFINAMENTO - NÃO TEM INTERESSE */}
          {step === 'REFINE_NOT_INTERESTED' && (
            <div className="space-y-4 animate-in fade-in zoom-in-95">
              <h3 className="text-center text-slate-400 uppercase tracking-widest font-bold text-sm">Qual foi o motivo principal?</h3>
              <div className="grid grid-cols-5 gap-3">
                <button onClick={() => handleNotInterestedReason('rude')} className="refine-btn bg-red-950 text-red-200 border-red-900">
                  🤬 Ignorante
                </button>
                <button onClick={() => handleNotInterestedReason('provider')} className="refine-btn bg-slate-700 text-slate-200 border-slate-600">
                  😐 Já tem gente
                </button>
                <button onClick={() => handleNotInterestedReason('relative')} className="refine-btn bg-slate-700 text-slate-200 border-slate-600">
                  🧑‍🤝‍🧑 Parente
                </button>
                <button onClick={() => handleNotInterestedReason('blind')} className="refine-btn bg-slate-700 text-slate-200 border-slate-600">
                  ❓ Não entendeu
                </button>
                <button onClick={() => handleNotInterestedReason('timing')} className="refine-btn bg-slate-700 text-slate-200 border-slate-600">
                  💸 Sem prioridade
                </button>
              </div>
              <button onClick={() => setStep('OUTCOME')} className="w-full text-center text-slate-500 text-sm hover:text-white mt-2">← Voltar</button>
            </div>
          )}

          {/* ESTÁGIO 4: REFINAMENTO - SEM TEMPO */}
          {step === 'REFINE_NO_TIME' && (
            <div className="space-y-4 animate-in fade-in zoom-in-95">
              <h3 className="text-center text-slate-400 uppercase tracking-widest font-bold text-sm">Retornar quando?</h3>
              <div className="max-w-2xl mx-auto bg-slate-900/60 border border-slate-700 rounded-lg p-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-2 uppercase tracking-wide">Dia</label>
                    <input
                      type="date"
                      value={callbackDraftDate}
                      onChange={(e) => setCallbackDraftDate(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] text-slate-400 mb-2 uppercase tracking-wide">Hora</label>
                    <input
                      type="time"
                      value={callbackDraftTime}
                      onChange={(e) => setCallbackDraftTime(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2"
                    />
                  </div>
                </div>
                {callbackRequesterName.trim() ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs bg-slate-800 text-slate-200 px-2.5 py-1 rounded-full border border-slate-700">
                      {callbackRequesterType || 'Não atribuído'} • {callbackRequesterName}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setCallbackRequesterType('');
                        setCallbackRequesterName('');
                      }}
                      className="text-[11px] text-slate-400 hover:text-white"
                    >
                      editar
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-2 uppercase tracking-wide">Quem pediu?</label>
                      <select
                        value={callbackRequesterType}
                        onChange={(e) => setCallbackRequesterType(e.target.value as ContactPersonType)}
                        className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2"
                      >
                        <option value="">Selecione...</option>
                        <option value={ContactPersonType.EMPRESA}>{ContactPersonType.EMPRESA}</option>
                        <option value={ContactPersonType.DECISOR}>{ContactPersonType.DECISOR}</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-2 uppercase tracking-wide">Nome (obrigatorio)</label>
                      <input
                        type="text"
                        value={callbackRequesterName}
                        onChange={(e) => setCallbackRequesterName(e.target.value)}
                        placeholder="Ex: Carla / Dr. Jose"
                        className="w-full bg-slate-800 border border-slate-700 text-slate-100 text-sm rounded-lg px-3 py-2"
                        disabled={!callbackRequesterType}
                      />
                    </div>
                  </div>
                )}
                {!callbackRequesterName.trim() && (
                  <div className="mt-2 text-[11px] text-amber-300">
                    Informe quem pediu o retorno para seguir.
                  </div>
                )}
                <button
                  onClick={handleScheduleCallback}
                  disabled={!callbackRequesterName.trim()}
                  className="mt-4 w-full rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold py-2"
                >
                  Confirmar retorno
                </button>
              </div>
              <button onClick={() => setStep('OUTCOME')} className="w-full text-center text-slate-500 text-sm hover:text-white mt-2">← Voltar</button>
            </div>
          )}
        </div>
      </div>

      <style>{`
        .action-btn {
          height: 6rem;
          border-radius: 0.75rem;
          border-width: 1px;
          font-weight: 600;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          transition: all 0.1s;
          font-size: 0.9rem;
        }
        .action-btn:active { transform: scale(0.96); }

        .refine-btn {
          height: 4rem;
          border-radius: 0.5rem;
          border-width: 1px;
          font-weight: 600;
          font-size: 0.9rem;
          transition: all 0.1s;
        }
        .refine-btn:hover { filter: brightness(1.2); }
        .refine-btn:active { transform: scale(0.96); }
      `}</style>
    </div>
  );
};

export default BlitzMode;

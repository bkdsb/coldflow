import React, { useEffect, useState, useMemo, useRef, Suspense, useDeferredValue } from 'react';
import { Lead, LeadStatus, QueueItem, OriginType, ContactPersonType } from './types';
import { getQueueStatus, getStatusColor, calculateDownPayment, getTicketBadgeClass, calculatePriorityScore, getNextContactLevel } from './utils';
import { leadService } from './services/leadService';
import { supabase, supabaseInitError } from './supabaseClient';
import type { User } from '@supabase/supabase-js';
import { DashboardStats } from './components/DashboardStats';
import { Plus, Search, Filter, Phone, CheckCircle, Clock, MapPin, Globe, Instagram, Facebook, Users, HelpCircle, Link as LinkIcon, Trash2, AlertTriangle, ChevronRight, ChevronUp, LogOut, Loader2, RefreshCcw, Wifi, WifiOff, CloudCheck, Building2, User as UserIcon, Briefcase, Upload, Download, Layers } from 'lucide-react';
import { WhatsAppIcon } from './components/WhatsAppIcon';
import { ALLOWED_EMAILS, AUTH_ERROR_KEY, RESET_FLOW_KEY } from './authConfig';

const LeadModal = React.lazy(() => import('./components/LeadModal'));
const LoginScreen = React.lazy(() => import('./components/LoginScreen'));
const ImportLeadsModal = React.lazy(() => import('./components/ImportLeadsModal'));
const ExportLeadsModal = React.lazy(() => import('./components/ExportLeadsModal'));
const ConfirmationModal = React.lazy(() =>
  import('./components/ConfirmationModal').then((module) => ({ default: module.ConfirmationModal }))
);

const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZE_OPTIONS = [10, 20, 30];
const PAGE_SIZE_STORAGE_KEY = 'coldflow_page_size';
const STATUS_TABS = [
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
const NEXT_CONTACT_STATUS = 'Próximo contato';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [forcePasswordReset, setForcePasswordReset] = useState(() => localStorage.getItem(RESET_FLOW_KEY) === '1');
  
  // Data State - Initialized empty, populated by Service immediately
  const [leads, setLeads] = useState<Lead[]>([]);
  
  // UI State
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isBackendDisabled, setIsBackendDisabled] = useState(leadService.isBackendDisabled());
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);
  const [filter, setFilter] = useState('');
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);
  const [selectedStatus, setSelectedStatus] = useState<string>(LeadStatus.NOVO);
  const [segmentDropdownOpen, setSegmentDropdownOpen] = useState(false);
  const [segmentQuery, setSegmentQuery] = useState('');
  const [queueView, setQueueView] = useState<'slider' | 'list'>('slider');
  const [queueIndex, setQueueIndex] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => {
    const stored = localStorage.getItem(PAGE_SIZE_STORAGE_KEY);
    const parsed = stored ? Number(stored) : DEFAULT_PAGE_SIZE;
    return PAGE_SIZE_OPTIONS.includes(parsed) ? parsed : DEFAULT_PAGE_SIZE;
  });
  const queueSliderRef = useRef<HTMLDivElement | null>(null);
  const segmentDropdownRef = useRef<HTMLDivElement | null>(null);
  const segmentSearchRef = useRef<HTMLInputElement | null>(null);
  
  // Modals
  const [leadToDelete, setLeadToDelete] = useState<Lead | null>(null);
  const [isLogoutModalOpen, setIsLogoutModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [isExportModalOpen, setIsExportModalOpen] = useState(false);
  const [isDedupeModalOpen, setIsDedupeModalOpen] = useState(false);
  const [dedupePreview, setDedupePreview] = useState<{ groups: number; duplicates: number; total: number } | null>(null);
  const [isDedupeRunning, setIsDedupeRunning] = useState(false);
  const [toast, setToast] = useState<{ message: string; type?: 'success' | 'info' | 'error' } | null>(null);
  const toastTimerRef = useRef<number | null>(null);

  const currentYear = new Date().getFullYear();

  // 1. AUTH LISTENER
  useEffect(() => {
    if (!supabase) {
      setAuthLoading(false);
      return;
    }
    let isMounted = true;

    const handleSession = (sessionUser: User | null) => {
      if (!isMounted) return;
      const email = sessionUser?.email ?? '';
      if (sessionUser && !ALLOWED_EMAILS.includes(email)) {
        localStorage.setItem(AUTH_ERROR_KEY, 'Acesso restrito. Este e-mail não tem permissão para acessar o ColdFlow.');
        supabase.auth.signOut();
        setUser(null);
        setAuthLoading(false);
        return;
      }
      setUser(sessionUser);
      setAuthLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => {
      handleSession(data.session?.user ?? null);
    });

    const { data: authListener } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') {
        localStorage.setItem(RESET_FLOW_KEY, '1');
        setForcePasswordReset(true);
      }
      handleSession(session?.user ?? null);
    });

    return () => {
      isMounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    const syncResetFlag = () => {
      setForcePasswordReset(localStorage.getItem(RESET_FLOW_KEY) === '1');
    };
    window.addEventListener('storage', syncResetFlag);
    window.addEventListener('coldflow-reset-flow', syncResetFlag);
    return () => {
      window.removeEventListener('storage', syncResetFlag);
      window.removeEventListener('coldflow-reset-flow', syncResetFlag);
    };
  }, []);

  useEffect(() => {
    if (!user || forcePasswordReset) return;
    leadService.fetchRemote({ force: true, full: true });
  }, [user, forcePasswordReset]);

  // 2. DATA SUBSCRIPTION (Stable)
  useEffect(() => {
    // This fires immediately with current local data, preventing "empty flash"
    const unsubscribeService = leadService.subscribe((updatedLeads) => {
      setLeads(updatedLeads); 
      setIsBackendDisabled(leadService.isBackendDisabled()); // Check backend status on update
      const time = leadService.getLastSyncTime();
      if (time) setLastSync(new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    });
    return () => unsubscribeService();
  }, []);

  // 3. NETWORK STATUS
  useEffect(() => {
    const handleStatus = () => {
       const online = navigator.onLine;
       setIsOnline(online);
       if (online && !leadService.isBackendDisabled()) leadService.fetchRemote(); // Auto-sync on reconnect
    };
    window.addEventListener('online', handleStatus);
    window.addEventListener('offline', handleStatus);
    return () => {
      window.removeEventListener('online', handleStatus);
      window.removeEventListener('offline', handleStatus);
    };
  }, []);
  
  const handleSaveLead = async (updatedLead: Lead) => {
    await leadService.saveLead(updatedLead);
    setSelectedLead(null);
  };

  const confirmDelete = async () => {
    if (leadToDelete) {
      await leadService.deleteLead(leadToDelete.id);
      setLeadToDelete(null);
      if (selectedLead?.id === leadToDelete.id) {
        setSelectedLead(null);
      }
    }
  }

  const handleRetryBackend = () => {
    leadService.retryBackend();
    setIsBackendDisabled(false);
  };

  const createNewLead = () => {
    // Initialize empty lead. Service will assign ID on save.
    const newLead: Lead = {
      id: '', // Empty means NEW to the UI, but Service handles generation
      updatedAt: Date.now(),
      companyName: '',
      decisors: [{ name: '', phone: '' }],
      attendants: [],
      origin: '',
      originLink: '',
      originRating: null,
      references: [],
      siteUrl: '',
      segment: '',
      yearsInBusiness: 0,
      ticketPotential: '',
      siteState: '',
      sitePainPoints: [],
      attempts: 0,
      lastContactDate: null,
      lastContactPerson: '',
      channelLastAttempt: '',
      resultLastAttempt: '',
      callbackDate: null,
      callbackTime: null,
      callbackRequestedBy: '',
      meetingDate: null,
      meetingTime: null,
      meetingType: '',
      nextAttemptDate: null,
      nextAttemptTime: null,
      nextAttemptChannel: '',
      paidValueType: '',
      paidValueCustom: null,
      status: LeadStatus.NOVO,
      discardReason: '',
      notes: ''
    };
    setSelectedLead(newLead);
  };

  // Performance Optimization
  const queue = useMemo(() => {
    return leads
      .map(lead => ({ lead, status: getQueueStatus(lead), weight: calculatePriorityScore(lead) }))
      .filter(item => item.status !== null)
      .sort((a, b) => {
        const sortOrderDiff = a.status!.sortOrder - b.status!.sortOrder;
        if (sortOrderDiff !== 0) return sortOrderDiff;
        const aHasTime = a.status!.hasTime === true;
        const bHasTime = b.status!.hasTime === true;
        if (aHasTime !== bHasTime) return aHasTime ? -1 : 1;
        if (aHasTime && bHasTime) {
          const timeDiff = (a.status!.timeSort || 0) - (b.status!.timeSort || 0);
          if (timeDiff !== 0) return timeDiff;
        }
        return b.weight - a.weight;
      });
  }, [leads]);

  const queueCounts = useMemo(() => {
    const counts = { urgent: 0, warning: 0, info: 0, other: 0 };
    queue.forEach(({ status }) => {
      if (!status) return;
      if (status.type === 'urgent') counts.urgent += 1;
      else if (status.type === 'warning') counts.warning += 1;
      else if (status.type === 'info') counts.info += 1;
      else counts.other += 1;
    });
    return counts;
  }, [queue]);

  const deferredFilter = useDeferredValue(filter);
  const deferredSegmentQuery = useDeferredValue(segmentQuery);

  const needsNextContact = (lead: Lead) => {
    if (lead.status === LeadStatus.NAO_TENTAR_MAIS) return false;
    if (lead.nextAttemptDate) return true;
    return getNextContactLevel(lead) !== 'none';
  };

  const hasScheduledNextContact = (lead: Lead) => Boolean(lead.nextAttemptDate);

  const getNextContactBadgeInfo = (lead: Lead) => {
    if (lead.status === LeadStatus.NAO_TENTAR_MAIS) return null;
    if (lead.nextAttemptDate) {
      return {
        label: 'Próximo contato agendado',
        className: 'border-sky-200 bg-sky-50 text-sky-700'
      };
    }
    const level = getNextContactLevel(lead);
    if (level === 'strong') {
      return {
        label: 'Próximo contato pendente',
        className: 'border-amber-400 bg-amber-100 text-amber-900'
      };
    }
    if (level === 'light') {
      return {
        label: 'Próximo contato pendente',
        className: 'border-amber-200 bg-amber-50 text-amber-800'
      };
    }
    return null;
  };

  const getStatusGroup = (lead: Lead) => {
    if (lead.status === LeadStatus.TENTAR_EM_30) return 2;
    if (lead.status === LeadStatus.NAO_TENTAR_MAIS) return 3;
    return 0;
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
    return '';
  };

  const parseDateTimeParts = (value?: string | null) => {
    if (!value) return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (trimmed.includes('T')) {
      const [datePart, timePart] = trimmed.split('T');
      const date = normalizeDateKey(datePart);
      if (!date) return null;
      const time = timePart ? timePart.slice(0, 5) : '';
      return { date, time };
    }
    const date = normalizeDateKey(trimmed);
    if (!date) return null;
    return { date, time: '' };
  };

  const getNextActionInfo = (lead: Lead) => {
    if (lead.status === LeadStatus.NAO_TENTAR_MAIS) return null;
    if (lead.meetingDate) {
      return {
        type: 'meeting' as const,
        label: 'Reunião agendada',
        date: lead.meetingDate,
        time: lead.meetingTime
      };
    }
    if (lead.callbackDate) {
      return {
        type: 'callback' as const,
        label: 'Retorno agendado',
        date: lead.callbackDate,
        time: lead.callbackTime
      };
    }
    if (lead.nextAttemptDate) {
      return {
        type: 'next' as const,
        label: 'Próxima tentativa',
        date: lead.nextAttemptDate,
        time: lead.nextAttemptTime
      };
    }
    return null;
  };

  const buildTimestamp = (dateValue: string, timeValue?: string | null) => {
    const dateKey = normalizeDateKey(dateValue);
    if (!dateKey) return null;
    const [year, month, day] = dateKey.split('-').map(Number);
    if (!year || !month || !day) return null;
    let hours = 23;
    let minutes = 59;
    if (timeValue) {
      const [h, m] = timeValue.split(':').map(Number);
      if (Number.isFinite(h) && Number.isFinite(m)) {
        hours = h;
        minutes = m;
      }
    }
    return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
  };

  const getNextContactSortMeta = (lead: Lead) => {
    const nextAction = getNextActionInfo(lead);
    if (nextAction?.date) {
      return {
        group: 0,
        time: buildTimestamp(nextAction.date, nextAction.time)
      };
    }
    const lastContact = parseDateTimeParts(lead.lastContactDate);
    if (lastContact?.date) {
      return {
        group: 1,
        time: buildTimestamp(lastContact.date, lastContact.time)
      };
    }
    return { group: 2, time: null };
  };

  const buildSearchableText = (lead: Lead) => {
    const contacts = [...(lead.decisors || []), ...(lead.attendants || [])];
    const contactValues = contacts.flatMap((contact) => [
      contact.name,
      contact.phone,
      contact.role
    ]);
    const referenceValues = (lead.references || []).flatMap((ref) => [
      ref.type,
      ref.platform,
      ref.link
    ]);
    return [
      lead.companyName,
      lead.segment,
      lead.origin,
      lead.originLink,
      lead.siteUrl,
      lead.status,
      lead.ticketPotential,
      lead.siteState,
      lead.discardReason,
      lead.notes,
      lead.channelLastAttempt,
      lead.resultLastAttempt,
      lead.lastContactPerson,
      lead.nextAttemptChannel,
      lead.callbackRequestedBy,
      lead.meetingType,
      lead.callbackDate,
      lead.callbackTime,
      lead.meetingDate,
      lead.meetingTime,
      lead.nextAttemptDate,
      lead.nextAttemptTime,
      lead.lastContactDate,
      lead.yearsInBusiness,
      lead.originRating,
      ...contactValues,
      ...referenceValues
    ]
      .filter(Boolean)
      .map((value) => String(value).toLowerCase())
      .join(' ');
  };

  const leadMatchesSearch = (lead: Lead, query: string) => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return true;
    const haystack = buildSearchableText(lead);
    if (haystack.includes(normalizedQuery)) return true;
    const digitsQuery = normalizedQuery.replace(/\D/g, '');
    if (!digitsQuery) return false;
    const digitsHaystack = haystack.replace(/\D/g, '');
    return digitsHaystack.includes(digitsQuery);
  };

  const filteredLeads = useMemo(() => {
    const lowerFilter = deferredFilter.toLowerCase();
    const isSearchActive = lowerFilter.trim().length > 0;
    const filtered = leads.filter(l => {
      const matchesText = leadMatchesSearch(l, lowerFilter);
      const matchesSegment =
        isSearchActive
          ? true
          : selectedSegments.length === 0 || selectedSegments.includes(l.segment);
    const matchesStatus =
        isSearchActive
          ? true
          : selectedStatus === 'Todos'
            ? true
            : selectedStatus === NEXT_CONTACT_STATUS
              ? needsNextContact(l)
              : selectedStatus === LeadStatus.NOVO
                ? l.status === LeadStatus.NOVO && !hasScheduledNextContact(l)
                : l.status === selectedStatus;
      return matchesText && matchesSegment && matchesStatus;
    });
    const scored = filtered.map((lead) => ({
      lead,
      score: calculatePriorityScore(lead),
      group: getStatusGroup(lead)
    }));
    scored.sort((a, b) => {
      if (!isSearchActive && selectedStatus === NEXT_CONTACT_STATUS) {
        const aMeta = getNextContactSortMeta(a.lead);
        const bMeta = getNextContactSortMeta(b.lead);
        if (aMeta.group !== bMeta.group) return aMeta.group - bMeta.group;
        if (aMeta.time !== null && bMeta.time !== null && aMeta.time !== bMeta.time) {
          return aMeta.time - bMeta.time;
        }
        if (aMeta.time !== null && bMeta.time === null) return -1;
        if (aMeta.time === null && bMeta.time !== null) return 1;
        return (b.lead.updatedAt || 0) - (a.lead.updatedAt || 0);
      }
      const groupDiff = a.group - b.group;
      if (groupDiff !== 0) return groupDiff;
      if (a.lead.status === LeadStatus.TENTAR_EM_30 && b.lead.status === LeadStatus.TENTAR_EM_30) {
        const dateA = a.lead.nextAttemptDate || '';
        const dateB = b.lead.nextAttemptDate || '';
        if (dateA && dateB && dateA !== dateB) return dateA.localeCompare(dateB);
      }
      const scoreDiff = b.score - a.score;
      if (scoreDiff !== 0) return scoreDiff;
      return (b.lead.updatedAt || 0) - (a.lead.updatedAt || 0);
    });
    return scored.map((item) => item.lead);
  }, [leads, deferredFilter, selectedSegments, selectedStatus]);

  const totalPages = useMemo(() => (
    Math.max(1, Math.ceil(filteredLeads.length / pageSize))
  ), [filteredLeads.length, pageSize]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [deferredFilter, selectedSegments, selectedStatus, pageSize]);

  const paginatedLeads = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredLeads.slice(start, start + pageSize);
  }, [filteredLeads, currentPage, pageSize]);

  const pageStart = filteredLeads.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const pageEnd = Math.min(filteredLeads.length, currentPage * pageSize);

  const availableSegments = useMemo(() => {
    const segments = leads.map((l) => l.segment).filter(Boolean);
    return Array.from(new Set(segments)).sort();
  }, [leads]);

  const segmentCounts = useMemo(() => {
    const counts = new Map<string, number>();
    leads.forEach((lead) => {
      if (!lead.segment) return;
      counts.set(lead.segment, (counts.get(lead.segment) || 0) + 1);
    });
    return counts;
  }, [leads]);

  const statusBaseLeads = useMemo(() => {
    const lowerFilter = deferredFilter.toLowerCase();
    return leads.filter((lead) => {
      const matchesText =
        lead.companyName.toLowerCase().includes(lowerFilter) ||
        (lead.segment || '').toLowerCase().includes(lowerFilter);
      const matchesSegment = selectedSegments.length === 0 || selectedSegments.includes(lead.segment);
      return matchesText && matchesSegment;
    });
  }, [leads, deferredFilter, selectedSegments]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    statusBaseLeads.forEach((lead) => {
      if (lead.status === LeadStatus.NOVO && hasScheduledNextContact(lead)) {
        return;
      }
      const key = lead.status || 'Sem status';
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    const nextContactCount = statusBaseLeads.filter(needsNextContact).length;
    if (nextContactCount > 0) {
      counts.set(NEXT_CONTACT_STATUS, nextContactCount);
    }
    return counts;
  }, [statusBaseLeads, needsNextContact]);

  const extraStatuses = useMemo(() => {
    const unique = Array.from(new Set(statusBaseLeads.map((lead) => lead.status).filter(Boolean)));
    return unique.filter((status) => !STATUS_TABS.includes(status as LeadStatus));
  }, [statusBaseLeads]);

  const statusOptions = useMemo(() => {
    const baseStatuses = [
      LeadStatus.NOVO,
      NEXT_CONTACT_STATUS,
      LeadStatus.DECISOR_NAO_ATENDEU,
      LeadStatus.DECISOR_FRIO,
      LeadStatus.DECISOR_INTERESSADO,
      LeadStatus.REUNIAO_MARCADA,
      LeadStatus.PROPOSTA_ENVIADA,
      LeadStatus.PROPOSTA_ACEITA,
      LeadStatus.TENTAR_EM_30,
      LeadStatus.NAO_TENTAR_MAIS
    ];
    const options: { value: string; label: string; count: number }[] = [
      { value: 'Todos', label: 'Todos os status', count: statusBaseLeads.length }
    ];
    baseStatuses.forEach((status) => {
      const count = statusCounts.get(status) || 0;
      options.push({ value: status, label: status, count });
    });
    extraStatuses.forEach((status) => {
      const count = statusCounts.get(status) || 0;
      options.push({ value: status, label: status, count });
    });
    return options;
  }, [statusBaseLeads.length, statusCounts, extraStatuses]);


  const filteredSegmentsList = useMemo(() => {
    const q = deferredSegmentQuery.toLowerCase().trim();
    let list = availableSegments;
    if (q) {
      list = list.filter((seg) => seg.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (segmentCounts.get(b) || 0) - (segmentCounts.get(a) || 0));
  }, [availableSegments, deferredSegmentQuery, segmentCounts]);

  useEffect(() => {
    if (selectedSegments.length > 0) {
      const valid = selectedSegments.filter((seg) => availableSegments.includes(seg));
      if (valid.length !== selectedSegments.length) {
        setSelectedSegments(valid);
      }
    }
  }, [availableSegments, selectedSegments]);

  const toggleSegment = (segment: string) => {
    setSelectedSegments((prev) =>
      prev.includes(segment) ? prev.filter((s) => s !== segment) : [...prev, segment]
    );
  };

  const clearSegments = () => setSelectedSegments([]);

  const listTitle = useMemo(() => {
    const statusLabel = selectedStatus === 'Todos' ? 'Todos os Leads' : `Status: ${selectedStatus}`;
    if (selectedSegments.length === 0) return statusLabel;
    if (selectedSegments.length === 1) return `${statusLabel} • Segmento: ${selectedSegments[0]}`;
    const preview = selectedSegments.slice(0, 2).join(', ');
    const extra = selectedSegments.length - 2;
    const segmentLabel = extra > 0 ? `Segmentos: ${preview} +${extra}` : `Segmentos: ${preview}`;
    return `${statusLabel} • ${segmentLabel}`;
  }, [selectedSegments, selectedStatus]);

  useEffect(() => {
    if (segmentDropdownOpen && segmentSearchRef.current) {
      segmentSearchRef.current.focus();
    }
  }, [segmentDropdownOpen]);

  useEffect(() => {
    if (!segmentDropdownOpen && segmentQuery) {
      setSegmentQuery('');
    }
  }, [segmentDropdownOpen, segmentQuery]);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);


  const handleImportLeads = async (imported: Lead[]) => {
    await leadService.saveLeadsBatch(imported);
  };

  const showToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
    setToast({ message, type });
    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      setToast(null);
    }, 3200);
  };

  const handleCheckDuplicates = () => {
    const preview = leadService.previewDuplicates();
    setDedupePreview(preview);
    setIsDedupeModalOpen(true);
  };

  const handleConfirmDedupe = async () => {
    if (!dedupePreview || dedupePreview.duplicates === 0) return;
    setIsDedupeRunning(true);
    try {
      const result = await leadService.dedupeDuplicates();
      setDedupePreview(null);
      window.setTimeout(() => {
        showToast(`Deduplicação concluída. Mesclados: ${result.merged}. Removidos: ${result.deleted}.`, 'success');
      }, 50);
    } finally {
      setIsDedupeRunning(false);
    }
  };

  useEffect(() => {
    setQueueIndex(0);
    if (queueSliderRef.current) {
      queueSliderRef.current.scrollLeft = 0;
    }
  }, [queue.length, queueView]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (segmentDropdownRef.current && !segmentDropdownRef.current.contains(target)) {
        setSegmentDropdownOpen(false);
      }
    };
    if (segmentDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [segmentDropdownOpen]);

  const handleQueueScroll = () => {
    const container = queueSliderRef.current;
    if (!container) return;
    const card = container.querySelector<HTMLElement>('[data-queue-card]');
    const cardWidth = card?.offsetWidth || container.clientWidth;
    if (!cardWidth) return;
    const styles = getComputedStyle(container);
    const gap = parseFloat(styles.columnGap || styles.gap || '0');
    const step = cardWidth + gap;
    const nextIndex = Math.round(container.scrollLeft / step);
    setQueueIndex(Math.max(0, Math.min(queue.length - 1, nextIndex)));
  };

  const getOriginIconType = (origin: string) => {
    if (origin === OriginType.GOOGLE_MAPS) return MapPin;
    if (origin === OriginType.SITE) return Globe;
    if (origin === OriginType.INSTAGRAM) return Instagram;
    if (origin === OriginType.FACEBOOK) return Facebook;
    if (origin === OriginType.WHATSAPP) return WhatsAppIcon;
    if (origin === OriginType.INDICACAO) return Users;
    return HelpCircle;
  };

  const withHttp = (link: string) => (link.startsWith('http') ? link : `https://${link}`);

  type WhatsAppRole = 'decisor' | 'attendant' | 'unknown';
  type WhatsAppTarget = {
    phone: string;
    role: WhatsAppRole;
    decisorName?: string;
    companyName?: string;
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

  const getGreetingPeriod = () => {
    const hour = new Date().getHours();
    return hour >= 18 ? 'boa noite' : hour >= 12 ? 'boa tarde' : 'bom dia';
  };

  const getWhatsAppGreeting = (target: WhatsAppTarget) => {
    const period = getGreetingPeriod();
    const company = (target.companyName || '').trim() || 'sua empresa';
    const decisorFullName =
      target.decisorName && !isPlaceholderName(target.decisorName) ? target.decisorName.trim() : '';
    if (target.role === 'decisor') {
      const greeting = decisorFullName ? `Olá, ${decisorFullName}, ${period}.` : `Olá, ${period}.`;
      return `${greeting} Gostaria de falar com você a respeito da imagem da ${company} online.`;
    }
    const responsible = decisorFullName ? `a pessoa responsável, ${decisorFullName}` : 'a pessoa responsável';
    return `Olá, ${period}. Gostaria de falar com ${responsible}, a respeito da imagem da ${company} online, poderia me ajudar a falar com essa pessoa?`;
  };

  const getWhatsAppLink = (target: WhatsAppTarget) => {
    const digits = target.phone.replace(/\D/g, '');
    if (!digits) return '';
    const normalized = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
    const message = encodeURIComponent(getWhatsAppGreeting(target));
    return `https://wa.me/${normalized}?text=${message}`;
  };

  const getPrimaryWhatsAppTarget = (lead: Lead): WhatsAppTarget => {
    const decisorWithPhone = lead.decisors?.find((c) => c.phone);
    const attendantWithPhone = lead.attendants?.find((c) => c.phone);
    const decisorName =
      lead.decisors?.find((c) => c.name && !isPlaceholderName(c.name))?.name || '';
    if (decisorWithPhone?.phone) {
      const ownName =
        decisorWithPhone.name && !isPlaceholderName(decisorWithPhone.name) ? decisorWithPhone.name : '';
      return {
        phone: decisorWithPhone.phone,
        role: 'decisor',
        decisorName: ownName,
        companyName: lead.companyName
      };
    }
    if (attendantWithPhone?.phone) {
      return {
        phone: attendantWithPhone.phone,
        role: 'attendant',
        decisorName,
        companyName: lead.companyName
      };
    }
    return { phone: '', role: 'unknown', decisorName, companyName: lead.companyName };
  };

  const renderQuickLink = (
    href: string,
    title: string,
    Icon: React.ElementType,
    {
      size = 16,
      activeClass = 'text-blue-500 hover:text-blue-700',
      inactiveClass = 'text-gray-300'
    }: { size?: number; activeClass?: string; inactiveClass?: string } = {}
  ) => {
    const icon = <Icon size={size} className={href ? activeClass : inactiveClass} />;
    if (!href) {
      return (
        <span title={title} className="p-1 rounded-full">
          {icon}
        </span>
      );
    }
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title}
        onClick={(e) => e.stopPropagation()}
        className="p-1 rounded-full hover:bg-gray-50 transition-colors"
      >
        {icon}
      </a>
    );
  };

  const renderLeadQuickLinks = (lead: Lead, { align = 'center', size = 16 }: { align?: 'center' | 'left'; size?: number } = {}) => {
    const OriginIcon = getOriginIconType(lead.origin);
    const originHref = lead.originLink ? withHttp(lead.originLink) : '';
    const siteHref = lead.siteUrl ? withHttp(lead.siteUrl) : '';
    const whatsappTarget = getPrimaryWhatsAppTarget(lead);
    const whatsappHref = getWhatsAppLink(whatsappTarget);
    const justifyClass = align === 'center' ? 'justify-center' : '';

    return (
      <div className={`flex items-center gap-1 ${justifyClass}`}>
        {renderQuickLink(originHref, `Ir para ${lead.origin || 'Origem'}`, OriginIcon, {
          size,
          activeClass: 'text-blue-500 hover:text-blue-700'
        })}
        {renderQuickLink(siteHref, 'Abrir site', Globe, {
          size,
          activeClass: 'text-slate-500 hover:text-slate-700'
        })}
        {renderQuickLink(whatsappHref, 'Abrir WhatsApp', WhatsAppIcon, {
          size,
          activeClass: 'opacity-90 hover:opacity-100',
          inactiveClass: 'opacity-30'
        })}
      </div>
    );
  };

  const getQueueDisplayInfo = (lead: Lead, status: QueueItem | null) => {
    const isCallback = status?.kind === 'callback';
    const isReception = isCallback && lead.callbackRequestedBy === ContactPersonType.EMPRESA;
    const downPayment = calculateDownPayment(lead.ticketPotential);

    let personName = lead.decisors[0]?.name;
    let roleLabel = "DECISOR";
    let roleColorClass = "bg-blue-50 text-blue-700 border-blue-100";
    let RoleIcon = Briefcase;

    if (isReception) {
      personName = lead.attendants[0]?.name || "Recepção / Atendente";
      roleLabel = "ATENDENTE";
      roleColorClass = "bg-orange-50 text-orange-700 border-orange-100";
      RoleIcon = Users;
    } else {
      if (!personName) personName = "Decisor (Não Cadastrado)";
    }

    const ticketLabel = lead.ticketPotential
      ? (lead.ticketPotential.includes('-') ? lead.ticketPotential.split('-')[1].trim() : lead.ticketPotential)
      : '-';
    const dateLabel = lead.meetingDate || lead.callbackDate || lead.nextAttemptDate || '';
    const timeLabel = lead.meetingDate
      ? lead.meetingTime || '-'
      : lead.callbackDate
        ? lead.callbackTime || '-'
        : lead.nextAttemptTime || '-';

    return { personName, roleLabel, roleColorClass, RoleIcon, downPayment, ticketLabel, timeLabel, dateLabel };
  };

  const renderQueueCard = (lead: Lead, status: QueueItem | null, variant: 'slider' | 'list') => {
    const display = getQueueDisplayInfo(lead, status);
    const { personName, roleLabel, roleColorClass, RoleIcon, downPayment } = display;
    const showNextAttemptTime = Boolean(
      lead.nextAttemptTime && status?.kind && ['proposal', 'interested', 'followup', 'try30'].includes(status.kind)
    );

    return (
      <div
        onClick={() => setSelectedLead(lead)}
        className={`cursor-pointer group relative bg-white ${variant === 'slider' ? 'p-4 md:p-5' : 'p-5 md:p-6'} rounded-xl border border-gray-200/80 shadow-sm transition-all border-l-[6px] md:bg-gradient-to-br md:from-white md:via-white md:to-slate-50/60 md:shadow-[0_18px_38px_rgba(15,23,42,0.08)] md:before:content-[''] md:before:absolute md:before:inset-0 md:before:rounded-xl md:before:ring-1 md:before:ring-white/70 md:before:pointer-events-none ${
          variant === 'list' ? 'hover:shadow-lg transform hover:-translate-y-1 md:hover:shadow-[0_24px_50px_rgba(15,23,42,0.12)]' : 'hover:shadow-md md:hover:shadow-[0_22px_44px_rgba(15,23,42,0.1)]'
        } ${
          status?.type === 'urgent' ? 'border-l-red-500' :
          status?.type === 'warning' ? 'border-l-yellow-500' :
          status?.type === 'info' ? 'border-l-blue-500' :
          'border-l-gray-300'
        }`}
      >
        <div className={`flex flex-col ${variant === 'list' ? 'md:flex-row md:items-center md:justify-between md:gap-6' : ''}`}>
          <div className="min-w-0">
            <div className="flex justify-between items-start mb-3">
              <span className={`text-[10px] md:text-sm font-bold md:font-semibold px-2.5 md:px-3 py-1 md:py-1.5 rounded uppercase md:normal-case tracking-wider md:tracking-normal ${
                status?.type === 'urgent' ? 'bg-red-50 text-red-700' :
                status?.type === 'warning' ? 'bg-yellow-50 text-yellow-700' :
                status?.type === 'info' ? 'bg-blue-50 text-blue-700' :
                'bg-gray-100 text-gray-600'
              }`}>
                {status?.message}
              </span>
              <div className="flex flex-col items-end">
                {lead.meetingTime && (
                  <span className="text-xs md:text-sm font-bold text-gray-700 bg-gray-100 px-1.5 md:px-2 rounded">
                    {lead.meetingTime}
                  </span>
                )}
                {lead.callbackTime && (
                  <span className="text-xs md:text-sm font-bold text-gray-700 bg-gray-100 px-1.5 md:px-2 rounded">
                    {lead.callbackTime}
                  </span>
                )}
                {showNextAttemptTime && (
                  <span className="text-xs md:text-sm font-bold text-gray-700 bg-gray-100 px-1.5 md:px-2 rounded">
                    {lead.nextAttemptTime}
                  </span>
                )}
              </div>
            </div>

            <div className={`inline-flex items-center gap-1.5 px-2 md:px-3 py-0.5 md:py-1 rounded text-[10px] md:text-sm font-bold md:font-semibold uppercase md:normal-case tracking-wider md:tracking-normal border mb-1.5 ${roleColorClass}`}>
              <RoleIcon size={10} />
              {roleLabel}
            </div>

            <h3 className="font-bold text-gray-900 text-lg md:text-xl leading-tight truncate">
              {personName}
            </h3>

            <div className="flex items-center gap-1.5 mt-1.5 text-gray-700">
              <Building2 size={14} className="text-gray-400 shrink-0" />
              <span className="font-semibold text-sm md:text-base truncate tracking-tight">{lead.companyName}</span>
            </div>
          </div>

          {downPayment && (
            <div className={`mt-3 ${variant === 'list' ? 'md:mt-0 md:ml-auto md:text-right' : ''}`}>
              <div className="inline-flex items-center gap-1.5 px-2 md:px-3 py-1 md:py-1.5 bg-gray-100 rounded border border-gray-200 text-xs md:text-sm text-gray-600">
                <span>{lead.ticketPotential?.split('-')[0]}</span>
                <span className="w-1 h-1 rounded-full bg-gray-400"></span>
                <span>Entrada: <strong className="text-gray-900">{downPayment}</strong></span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderQueueRow = (lead: Lead, status: QueueItem | null) => {
    const display = getQueueDisplayInfo(lead, status);
    const { personName, roleLabel, roleColorClass, RoleIcon, downPayment, ticketLabel, timeLabel, dateLabel } = display;
    const statusPillClass =
      status?.type === 'urgent' ? 'bg-red-50 text-red-700 border-red-200' :
      status?.type === 'warning' ? 'bg-yellow-50 text-yellow-700 border-yellow-200' :
      status?.type === 'info' ? 'bg-blue-50 text-blue-700 border-blue-200' :
      'bg-gray-100 text-gray-600 border-gray-200';
    const borderClass =
      status?.type === 'urgent' ? 'border-l-red-500' :
      status?.type === 'warning' ? 'border-l-yellow-500' :
      status?.type === 'info' ? 'border-l-blue-500' :
      'border-l-gray-300';
    const displayDate = dateLabel ? new Date(dateLabel).toLocaleDateString('pt-BR') : '';

    return (
      <div
        onClick={() => setSelectedLead(lead)}
        className={`grid grid-cols-12 items-center gap-4 px-6 py-4 border-l-4 ${borderClass} hover:bg-slate-50/80 transition cursor-pointer`}
      >
        <div className="col-span-3">
          <div className={`inline-flex items-center px-3 py-1 rounded-full border text-sm font-semibold ${statusPillClass}`}>
            {status?.message}
          </div>
        </div>
        <div className="col-span-3">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-sm font-semibold border ${roleColorClass}`}>
              <RoleIcon size={12} />
              {roleLabel}
            </span>
            <span className="text-base font-semibold text-gray-900 truncate">{personName}</span>
          </div>
          <div className="mt-1 flex items-center gap-2 text-sm text-gray-500">
            <Building2 size={14} className="text-gray-400 shrink-0" />
            <span className="truncate">{lead.companyName}</span>
          </div>
        </div>
        <div className="col-span-3">
          <div className="text-base font-semibold text-gray-900 truncate">{ticketLabel}</div>
          <div className="text-sm text-gray-500 truncate">{lead.segment || 'Sem segmento'}</div>
        </div>
        <div className="col-span-2">
          <div className="text-base font-semibold text-gray-900">{timeLabel}</div>
          <div className="text-sm text-gray-500">{displayDate}</div>
        </div>
        <div className="col-span-1 text-right">
          {downPayment ? (
            <span className="text-base font-semibold text-gray-900">{downPayment}</span>
          ) : (
            <span className="text-sm text-gray-300">-</span>
          )}
        </div>
      </div>
    );
  };

  if (supabaseInitError) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50 text-gray-500">
        <div className="max-w-md text-center space-y-3 p-6 bg-white border border-gray-200 rounded-2xl shadow-sm">
          <h1 className="text-lg font-bold text-gray-900">Configuração incompleta</h1>
          <p className="text-sm">{supabaseInitError}</p>
          <p className="text-xs text-gray-400">Verifique as variáveis no `.env.local` e o deploy.</p>
        </div>
      </div>
    );
  }

  if (authLoading) return <div className="h-screen flex items-center justify-center bg-gray-50 text-gray-400 font-medium animate-pulse">Carregando ColdFlow...</div>;

  if (!user || forcePasswordReset) {
    return (
      <Suspense fallback={<div className="h-screen flex items-center justify-center bg-gray-50 text-gray-400 font-medium animate-pulse">Carregando...</div>}>
        <LoginScreen />
      </Suspense>
    );
  }

  const displayName = user.user_metadata?.full_name || user.user_metadata?.name || user.email?.split('@')[0] || 'Usuário';
  const avatarUrl = user.user_metadata?.avatar_url as string | undefined;

  const formatLastContact = (value: string | null | undefined) => {
    if (!value) return '';
    const [datePart, timePart] = value.split('T');
    if (!datePart) return '';
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [year, month, day] = datePart.split('-');
      const dateStr = `${day}/${month}/${year}`;
      const timeStr = timePart ? timePart.slice(0, 5) : '';
      return timeStr ? `${dateStr} ${timeStr}` : dateStr;
    }
    return value;
  };

  const formatDateTimeParts = (dateValue: string | null | undefined, timeValue: string | null | undefined) => {
    if (!dateValue) return '';
    if (dateValue.includes('T')) return formatLastContact(dateValue);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) return dateValue;
    const [year, month, day] = dateValue.split('-');
    const dateStr = `${day}/${month}/${year}`;
    const timeStr = timeValue ? timeValue.slice(0, 5) : '';
    return timeStr ? `${dateStr} ${timeStr}` : dateStr;
  };

  const getNextActionBadgeClass = (type: 'meeting' | 'callback' | 'next') => {
    if (type === 'meeting') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    if (type === 'callback') return 'border-amber-200 bg-amber-50 text-amber-700';
    return 'border-gray-200 bg-gray-50 text-gray-600';
  };

  return (
    <div className="min-h-screen bg-gray-50 text-slate-800 font-sans">
      
      {/* Navbar */}
      <nav className="bg-white border-b border-gray-200 sticky top-0 z-30 shadow-sm transition-all">
        <div className="max-w-[1400px] mx-auto w-full px-4 md:px-8 lg:px-10 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-gray-900 rounded-lg flex items-center justify-center text-white font-bold shadow-lg shadow-gray-200 text-lg">
              CF
            </div>
            <h1 className="text-base md:text-xl font-bold tracking-tight text-gray-900">ColdFlow</h1>
          </div>

          <div className="flex items-center gap-4">
             <button
               onClick={isBackendDisabled ? handleRetryBackend : undefined}
               className={`flex items-center gap-2 px-2 py-1 rounded-full border text-[10px] font-medium transition-all ${
                 isBackendDisabled
                   ? 'border-orange-200 text-orange-600 bg-orange-50/60 hover:bg-orange-100/60 cursor-pointer'
                   : isOnline
                     ? 'border-green-100 text-gray-400 bg-white/60'
                     : 'border-amber-100 text-gray-400 bg-white/60'
               }`}
               title={
                 isBackendDisabled
                   ? 'Clique para tentar reconectar'
                   : isOnline
                     ? `Online • Sync automático${lastSync ? ` • ${lastSync}` : ''}`
                     : 'Offline'
               }
               aria-label="Status de sincronização"
             >
               <span
                 className={`w-1.5 h-1.5 rounded-full ${
                   isBackendDisabled ? 'bg-orange-500' : isOnline ? 'bg-green-500' : 'bg-amber-500'
                 }`}
               />
               <span className="hidden sm:inline">
                 {isBackendDisabled ? 'Local' : isOnline ? 'Sync' : 'Offline'}
               </span>
             </button>
             <div className="hidden md:flex flex-col items-end mr-2">
               <span className="text-xs font-bold text-gray-900">{displayName}</span>
               <span className="text-[10px] text-gray-500">{user.email}</span>
             </div>
             {avatarUrl && <img src={avatarUrl} alt="Foto do usuário" loading="lazy" className="w-8 h-8 rounded-full border border-gray-200 hidden md:block" />}
             
             <button onClick={createNewLead} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all shadow-md active:scale-95 flex items-center gap-2">
               <Plus size={18} /> <span className="hidden md:inline">Novo</span>
             </button>

             <button onClick={() => setIsLogoutModalOpen(true)} className="text-gray-400 hover:text-red-600 hover:bg-red-50 p-2 rounded-lg transition-colors" title="Sair" aria-label="Sair">
               <LogOut size={20} />
             </button>
          </div>
        </div>
      </nav>

      <main className="max-w-[1400px] mx-auto p-4 md:p-8 lg:px-10 space-y-10 md:space-y-12">
        
        {/* DASHBOARD STATS */}
        <section>
          <DashboardStats leads={leads} />
        </section>

        {/* QUEUE */}
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl md:text-2xl font-bold text-gray-800 flex items-center gap-2">
                <Clock className="text-blue-600" size={22} />
                Fila de Hoje
              </h2>
              <span className="text-xs md:text-sm font-semibold text-gray-600 bg-gray-200 px-2.5 py-0.5 rounded-full">{queue.length}</span>
            </div>
            {queue.length > 0 && queueView === 'slider' && (
              <button
                onClick={() => setQueueView('list')}
                className="md:hidden text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-sm transition"
              >
                Mostrar todos
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 mb-4">
            {queueCounts.urgent > 0 && (
              <span className="text-[10px] md:text-sm font-bold md:font-semibold uppercase md:normal-case tracking-wider md:tracking-normal px-2.5 md:px-3 py-1 md:py-1.5 rounded-full border border-red-200 text-red-700 bg-red-50">
                Urgente {queueCounts.urgent}
              </span>
            )}
            {queueCounts.warning > 0 && (
              <span className="text-[10px] md:text-sm font-bold md:font-semibold uppercase md:normal-case tracking-wider md:tracking-normal px-2.5 md:px-3 py-1 md:py-1.5 rounded-full border border-yellow-200 text-yellow-700 bg-yellow-50">
                Alerta {queueCounts.warning}
              </span>
            )}
            {queueCounts.info > 0 && (
              <span className="text-[10px] md:text-sm font-bold md:font-semibold uppercase md:normal-case tracking-wider md:tracking-normal px-2.5 md:px-3 py-1 md:py-1.5 rounded-full border border-blue-200 text-blue-700 bg-blue-50">
                Info {queueCounts.info}
              </span>
            )}
            {queueCounts.other > 0 && (
              <span className="text-[10px] md:text-sm font-bold md:font-semibold uppercase md:normal-case tracking-wider md:tracking-normal px-2.5 md:px-3 py-1 md:py-1.5 rounded-full border border-gray-200 text-gray-600 bg-gray-50">
                Outros {queueCounts.other}
              </span>
            )}
            {queue.length > 0 && queueView === 'slider' && (
              <div className="ml-auto flex items-center gap-2 text-[11px] md:hidden text-gray-500">
                <span>Sequência</span>
                <span className="font-semibold text-gray-700">{queueIndex + 1}/{queue.length}</span>
                <div className="hidden sm:flex items-center gap-1">
                  {queue.map((_, idx) => (
                    <span key={`dot-${idx}`} className={`h-1.5 w-1.5 rounded-full ${idx === queueIndex ? 'bg-gray-800' : 'bg-gray-300'}`} />
                  ))}
                </div>
              </div>
            )}
          </div>

          {queue.length === 0 ? (
            <div className="p-10 text-center text-gray-400 bg-white rounded-xl border-2 border-dashed border-gray-200">
              <p className="text-lg font-medium">Tudo limpo por hoje!</p>
            </div>
          ) : (
            <>
              <div className="md:hidden">
                {queueView === 'slider' ? (
                  <div className="relative">
                    <div
                      ref={queueSliderRef}
                      onScroll={handleQueueScroll}
                      className="flex gap-3 overflow-x-auto snap-x snap-mandatory scroll-smooth -mx-4 px-4 pb-2"
                    >
                      {queue.map(({ lead, status }) => (
                        <div key={lead.id} data-queue-card className="snap-center shrink-0 w-full">
                          {renderQueueCard(lead, status, 'slider')}
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-5">
                    <div className="grid grid-cols-1 gap-5">
                      {queue.map(({ lead, status }) => (
                        <div key={lead.id}>
                          {renderQueueCard(lead, status, 'list')}
                        </div>
                      ))}
                    </div>
                    <div className="flex justify-center">
                      <button
                        onClick={() => setQueueView('slider')}
                        className="inline-flex items-center gap-2 text-xs font-semibold text-gray-600 hover:text-gray-900 bg-white border border-gray-200 px-3 py-1.5 rounded-full shadow-sm transition"
                      >
                        <ChevronUp size={14} />
                        Encolher lista
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="hidden md:block">
                <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_20px_40px_rgba(15,23,42,0.08)] overflow-hidden">
                  <div className="grid grid-cols-12 gap-4 px-6 py-4 bg-gray-50 text-sm font-semibold text-gray-500">
                    <div className="col-span-3">Status</div>
                    <div className="col-span-3">Contato</div>
                    <div className="col-span-3">Ticket</div>
                    <div className="col-span-2">Agenda</div>
                    <div className="col-span-1 text-right">Entrada</div>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {queue.map(({ lead, status }) => (
                      <div key={lead.id}>
                        {renderQueueRow(lead, status)}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </>
          )}
        </section>

        {/* LIST */}
        <section>
          <div className="flex flex-col gap-4 mb-6">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-800">{listTitle}</h2>
              <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
              <div className="relative group w-full md:w-72">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 group-focus-within:text-blue-500 transition-colors" size={18} />
                <input 
                  type="text" 
                  placeholder="Encontrar algo específico" 
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  aria-label="Encontrar algo específico nos leads"
                  className="pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none w-full shadow-sm transition-all text-gray-900 placeholder-gray-400"
                />
              </div>

              <div ref={segmentDropdownRef} className="relative w-full md:w-60">
                <button
                  type="button"
                  onClick={() => {
                    setSegmentDropdownOpen((prev) => !prev);
                    setStatusDropdownOpen(false);
                  }}
                  className="w-full inline-flex items-center justify-between gap-2 px-3.5 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-semibold text-gray-700 shadow-sm hover:border-blue-200 hover:text-blue-700 transition"
                  aria-expanded={segmentDropdownOpen}
                  aria-controls="segment-filter-dropdown"
                  title="Filtrar por segmento"
                >
                  <span className="flex items-center gap-2">
                    <Filter size={16} className="text-gray-400" />
                    {selectedSegments.length === 0 ? "Todos os segmentos" : "Segmentos"}
                  </span>
                  <span className="text-xs text-gray-500">
                    {selectedSegments.length > 0 ? selectedSegments.length : "Todos"}
                  </span>
                </button>

                {segmentDropdownOpen && (
                  <div id="segment-filter-dropdown" className="absolute z-30 mt-2 w-full bg-white border border-gray-200 rounded-xl shadow-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                        Filtrar segmentos
                      </span>
                      {selectedSegments.length > 0 && (
                        <button
                          onClick={clearSegments}
                          className="text-[10px] font-semibold text-blue-600 hover:text-blue-700"
                        >
                          Limpar
                        </button>
                      )}
                    </div>
                    <div className="mb-3">
                      <input
                        ref={segmentSearchRef}
                        value={segmentQuery}
                        onChange={(e) => setSegmentQuery(e.target.value)}
                        placeholder="Buscar categoria..."
                        className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                      />
                    </div>

                    <div className="max-h-48 overflow-y-auto pr-1 space-y-1">
                      {filteredSegmentsList.length === 0 && (
                        <p className="text-xs text-gray-400 px-2 py-1">Nenhum segmento encontrado.</p>
                      )}
                      {filteredSegmentsList.map((segment) => (
                        <label key={segment} className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-gray-50 text-sm text-gray-700 cursor-pointer">
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={selectedSegments.includes(segment)}
                              onChange={() => toggleSegment(segment)}
                              className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span>{segment}</span>
                          </span>
                          <span className="text-xs text-gray-400">{segmentCounts.get(segment) || 0}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <button
                onClick={handleCheckDuplicates}
                aria-label="Verificar duplicidades de leads"
                disabled={leads.length === 0 || isDedupeRunning}
                className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-600 px-3.5 py-2.5 rounded-lg text-sm font-semibold shadow-sm hover:border-blue-200 hover:text-blue-700 hover:bg-blue-50/40 transition disabled:opacity-50 disabled:hover:bg-white"
                title="Verificar duplicados e mesclar"
              >
                <Layers size={16} /> Deduplicar
              </button>

              <button
                onClick={() => setIsImportModalOpen(true)}
                aria-label="Importar leads via CSV ou XLSX"
                className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-3.5 py-2.5 rounded-lg text-sm font-semibold shadow-sm hover:border-blue-200 hover:text-blue-700 hover:bg-blue-50/40 transition"
              >
                <Upload size={16} /> Importar CSV
              </button>

              <button
                onClick={() => setIsExportModalOpen(true)}
                aria-label="Exportar leads para CSV ou XLSX"
                disabled={leads.length === 0}
                className="inline-flex items-center gap-2 bg-white border border-gray-200 text-gray-700 px-3.5 py-2.5 rounded-lg text-sm font-semibold shadow-sm hover:border-emerald-200 hover:text-emerald-700 hover:bg-emerald-50/40 transition disabled:opacity-50 disabled:hover:bg-white"
              >
                <Download size={16} /> Exportar
              </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {statusOptions.map((option) => {
                const isActive = selectedStatus === option.value;
                const label = option.value === 'Todos' ? 'Todos' : option.label;
                return (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      if (isActive && option.value !== 'Todos') {
                        setSelectedStatus(LeadStatus.NOVO);
                        return;
                      }
                      setSelectedStatus(option.value);
                    }}
                    className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition ${
                      isActive
                        ? 'bg-gray-900 text-white border-gray-900 shadow-sm'
                        : option.count === 0
                          ? 'bg-white text-gray-300 border-gray-200'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300 hover:text-gray-800'
                    }`}
                    title={label}
                  >
                    <span className="truncate max-w-[140px]">{label}</span>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                      isActive ? 'bg-white/20 text-white' : option.count === 0 ? 'bg-gray-100 text-gray-400' : 'bg-gray-100 text-gray-500'
                    }`}>
                      {option.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-white md:bg-white rounded-xl shadow-none md:shadow-sm border-0 md:border border-gray-200 overflow-hidden md:max-h-[70vh] md:min-h-[50vh] md:overflow-auto md:overscroll-contain relative">
             {/* Desktop Table View */}
             <div className="hidden md:block">
                <table className="w-full text-left border-separate border-spacing-0">
                  <thead className="sticky top-0 z-20 bg-gray-50/95 backdrop-blur">
                    <tr className="text-xs text-gray-500 uppercase tracking-wider">
                      <th className="p-4 md:p-5 font-semibold text-center w-24 sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Origem</th>
                      <th className="p-4 md:p-5 font-semibold sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Status</th>
                      <th className="p-4 md:p-5 font-semibold sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Empresa</th>
                      <th className="p-4 md:p-5 font-semibold hidden md:table-cell sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Decisor</th>
                      <th className="p-4 md:p-5 font-semibold hidden md:table-cell sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Segmento</th>
                      <th className="p-4 md:p-5 font-semibold hidden md:table-cell sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Ticket</th>
                      <th className="p-4 md:p-5 font-semibold text-center hidden md:table-cell sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Tentativas</th>
                      <th className="p-4 md:p-5 font-semibold hidden md:table-cell sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Último Contato</th>
                      <th className="p-4 md:p-5 font-semibold hidden md:table-cell sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200">Próximo Contato</th>
                      <th className="p-4 md:p-5 font-semibold w-10 sticky top-0 bg-gray-50/95 backdrop-blur border-b border-gray-200"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedLeads.map(lead => (
                      <tr 
                        key={lead.id} 
                        onClick={() => setSelectedLead(lead)}
                        className={`hover:bg-gray-50 cursor-pointer transition-colors group ${getStatusColor(lead.status).replace('border', 'border-l-4')}`}
                      >
                         <td className="p-4 md:p-5 text-center w-24">
                            {renderLeadQuickLinks(lead)}
                         </td>
                         <td className="p-4 md:p-5">
                           <div className="flex flex-col gap-1">
                             {!(lead.status === LeadStatus.NOVO && hasScheduledNextContact(lead)) && (
                               <span className={`inline-block text-[10px] md:text-[11px] font-bold px-2.5 py-1 rounded-full border shadow-sm whitespace-nowrap ${getStatusColor(lead.status)}`}>
                                 {lead.status}
                               </span>
                             )}
                             {(() => {
                               const nextBadge = getNextContactBadgeInfo(lead);
                               if (!nextBadge) return null;
                               return (
                                 <span className={`inline-block text-[10px] md:text-[11px] font-bold px-2.5 py-1 rounded-full border whitespace-nowrap ${nextBadge.className}`}>
                                   {nextBadge.label}
                                 </span>
                               );
                             })()}
                           </div>
                         </td>
                         <td className="p-4 md:p-5 font-bold text-gray-800 group-hover:text-blue-600 transition-colors text-sm md:text-base">{lead.companyName}</td>
                         <td className="p-4 md:p-5 text-sm text-gray-600 hidden md:table-cell">
                            <div className="font-medium text-gray-900">{lead.decisors[0]?.name || '-'}</div>
                         </td>
                         <td className="p-4 md:p-5 text-sm font-medium text-gray-600 hidden md:table-cell">{lead.segment}</td>
                         
                         {/* TICKET COLUMN (Updated with 40% subtitle) */}
                         <td className="p-4 md:p-5 hidden md:table-cell">
                           {lead.ticketPotential ? (
                             <div className="flex flex-col items-start gap-1">
                               <span className={`inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-bold border shadow-sm whitespace-nowrap ${getTicketBadgeClass(lead.ticketPotential)}`}>
                                 {lead.ticketPotential.includes('-') ? lead.ticketPotential.split('-')[1].trim() : lead.ticketPotential}
                               </span>
                               {calculateDownPayment(lead.ticketPotential) && (
                                  <span className="text-[10px] text-gray-400 font-medium">
                                    Entrada: <span className="text-gray-600 font-bold">{calculateDownPayment(lead.ticketPotential)}</span>
                                  </span>
                               )}
                             </div>
                           ) : (
                             <span className="text-gray-300 text-xs">-</span>
                           )}
                         </td>

                         <td className="p-4 md:p-5 text-center w-24 hidden md:table-cell">
                           <span className="bg-white border border-gray-200 px-2.5 py-1 rounded-md text-gray-700 font-mono text-xs font-bold shadow-sm">{lead.attempts}</span>
                         </td>
                         <td className="p-4 md:p-5 text-sm text-gray-500 font-medium hidden md:table-cell">
                           {lead.lastContactDate ? formatLastContact(lead.lastContactDate) : <span className="text-gray-300">-</span>}
                         </td>
                         <td className="p-4 md:p-5 text-sm text-gray-500 font-medium hidden md:table-cell">
                           {(() => {
                             const nextAction = getNextActionInfo(lead);
                             if (!nextAction) {
                               return <span className="text-gray-300">-</span>;
                             }
                             return (
                               <div className="flex flex-col gap-1">
                                <span className={`inline-flex items-center justify-center px-2.5 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide text-center leading-snug whitespace-normal ${getNextActionBadgeClass(nextAction.type)}`}>
                                  {nextAction.label}
                                </span>
                                 <span className="text-xs text-gray-500">
                                   {formatDateTimeParts(nextAction.date, nextAction.time)}
                                 </span>
                               </div>
                             );
                           })()}
                         </td>
                         <td className="p-4 md:p-5 text-center" onClick={(e) => e.stopPropagation()}>
                           <button onClick={() => setLeadToDelete(lead)} className="text-gray-300 hover:text-red-500 hover:bg-red-50 p-2 rounded-full transition-all" aria-label={`Excluir lead ${lead.companyName}`}>
                              <Trash2 size={16} />
                           </button>
                         </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
             </div>

             {/* Mobile List View */}
             <div className="block md:hidden space-y-2">
               {paginatedLeads.map(lead => (
                 <div 
                    key={lead.id}
                    onClick={() => setSelectedLead(lead)}
                    className="bg-white rounded-lg border border-gray-200 px-3.5 py-2.5 shadow-sm active:scale-[0.99] transition-all"
                 >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-2">
                            {!(lead.status === LeadStatus.NOVO && hasScheduledNextContact(lead)) && (
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getStatusColor(lead.status)}`}>{lead.status}</span>
                            )}
                            {(() => {
                              const nextBadge = getNextContactBadgeInfo(lead);
                              if (!nextBadge) return null;
                              return (
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${nextBadge.className}`}>
                                  {nextBadge.label}
                                </span>
                              );
                            })()}
                          </div>
                          {lead.ticketPotential && (
                            <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${getTicketBadgeClass(lead.ticketPotential)}`}>
                              {lead.ticketPotential.includes('-') ? lead.ticketPotential.split('-')[1].trim() : lead.ticketPotential}
                            </span>
                          )}
                        </div>
                        <h3 className="mt-1 font-semibold text-gray-900 truncate">{lead.companyName}</h3>
                        <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-500">
                          {renderLeadQuickLinks(lead, { align: 'left', size: 14 })}
                          <span className="truncate">{lead.decisors[0]?.name || 'Sem decisor'}</span>
                          <span className="text-gray-300">•</span>
                          <span className="font-mono">{lead.attempts} tent.</span>
                          {lead.lastContactDate && (
                            <>
                              <span className="text-gray-300">•</span>
                              <span>{formatLastContact(lead.lastContactDate)}</span>
                            </>
                          )}
                          {(() => {
                            const nextAction = getNextActionInfo(lead);
                            if (!nextAction) return null;
                            return (
                              <>
                                <span className="text-gray-300">•</span>
                                <span className={`inline-flex items-center justify-center px-2 py-0.5 rounded border text-[10px] font-semibold text-center leading-snug whitespace-normal ${getNextActionBadgeClass(nextAction.type)}`}>
                                  {nextAction.label}
                                </span>
                                <span className="text-gray-300">•</span>
                                <span>{formatDateTimeParts(nextAction.date, nextAction.time)}</span>
                              </>
                            );
                          })()}
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        <button onClick={(e) => { e.stopPropagation(); setLeadToDelete(lead); }} className="p-1 text-gray-300 hover:text-red-500" aria-label={`Excluir lead ${lead.companyName}`}>
                          <Trash2 size={18} />
                        </button>
                        <ChevronRight size={18} className="text-gray-300" />
                      </div>
                    </div>
                 </div>
               ))}
             </div>

            {filteredLeads.length > 0 && (
              <div className="border-t border-gray-200 bg-white/80 px-4 md:px-6 py-3 flex flex-col md:flex-row items-center justify-between gap-3 text-sm text-gray-600">
                <span>
                  Mostrando <strong className="text-gray-900">{pageStart}</strong>–<strong className="text-gray-900">{pageEnd}</strong> de{' '}
                  <strong className="text-gray-900">{filteredLeads.length}</strong>
                </span>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-gray-500">Por página</span>
                    <select
                      value={pageSize}
                      onChange={(e) => {
                        const next = Number(e.target.value);
                        setPageSize(next);
                        localStorage.setItem(PAGE_SIZE_STORAGE_KEY, String(next));
                      }}
                      className="px-2.5 py-1.5 rounded-lg border border-gray-200 bg-white text-xs font-semibold text-gray-700 focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                    >
                      {PAGE_SIZE_OPTIONS.map((size) => (
                        <option key={size} value={size}>{size}</option>
                      ))}
                    </select>
                  </div>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                    disabled={currentPage === 1}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:border-gray-300 transition disabled:opacity-40"
                  >
                    Anterior
                  </button>
                  <span className="text-xs font-semibold text-gray-500">
                    Página <strong className="text-gray-900">{currentPage}</strong> de <strong className="text-gray-900">{totalPages}</strong>
                  </span>
                  <button
                    onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                    disabled={currentPage === totalPages}
                    className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-semibold text-gray-600 hover:text-gray-900 hover:border-gray-300 transition disabled:opacity-40"
                  >
                    Próxima
                  </button>
                </div>
              </div>
            )}

          </div>
        </section>

      </main>

      <footer className="border-t border-gray-200 bg-white/80">
        <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-6 flex items-center justify-center">
          <span className="relative overflow-hidden text-xs text-gray-500 px-4 py-1.5 before:content-[''] before:absolute before:inset-y-0 before:-left-1/2 before:w-[200%] before:bg-[linear-gradient(120deg,transparent,rgba(255,255,255,0.45),transparent)] before:opacity-25 before:animate-luxury-shine-soft">
            © {currentYear} belegante.co
          </span>
        </div>
      </footer>

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 md:left-auto md:right-6 md:translate-x-0 z-[80]">
          <div
            className={`flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold shadow-lg backdrop-blur bg-white/90 ${
              toast.type === 'success'
                ? 'border-emerald-200 text-emerald-700'
                : toast.type === 'error'
                  ? 'border-red-200 text-red-700'
                  : 'border-blue-200 text-blue-700'
            }`}
          >
            {toast.type === 'success' ? <CheckCircle size={16} /> : toast.type === 'error' ? <AlertTriangle size={16} /> : <HelpCircle size={16} />}
            <span>{toast.message}</span>
            <button
              type="button"
              onClick={() => setToast(null)}
              className="ml-1 text-xs text-gray-400 hover:text-gray-600"
              aria-label="Fechar notificação"
            >
              ×
            </button>
          </div>
        </div>
      )}

      <Suspense fallback={null}>
        {/* Lead Modal */}
        {selectedLead && (
          <LeadModal 
            lead={selectedLead} 
            onClose={() => setSelectedLead(null)} 
            onSave={handleSaveLead} 
            onRequestDelete={(lead) => setLeadToDelete(lead)}
          />
        )}

        {/* Import Leads */}
        {isImportModalOpen && (
          <ImportLeadsModal
            isOpen={isImportModalOpen}
            onClose={() => setIsImportModalOpen(false)}
            onImport={handleImportLeads}
          />
        )}

        {/* Export Leads */}
        {isExportModalOpen && (
          <ExportLeadsModal
            isOpen={isExportModalOpen}
            onClose={() => setIsExportModalOpen(false)}
            leads={leads}
            availableSegments={availableSegments}
            segmentCounts={segmentCounts}
          />
        )}

        {/* Deduplicate Leads */}
        {isDedupeModalOpen && (
          <ConfirmationModal
            isOpen={true}
            onClose={() => setIsDedupeModalOpen(false)}
            onConfirm={() => {
              if (dedupePreview && dedupePreview.duplicates > 0) {
                handleConfirmDedupe();
              }
            }}
            title={dedupePreview && dedupePreview.duplicates > 0 ? 'Deduplicar leads?' : 'Sem duplicidades'}
            message={
              dedupePreview
                ? dedupePreview.duplicates > 0
                  ? `Encontramos ${dedupePreview.groups} grupo(s) com ${dedupePreview.duplicates} duplicados. Vamos mesclar e excluir os repetidos?`
                  : `Nenhuma duplicidade encontrada entre ${dedupePreview.total} leads.`
                : 'Verificando duplicidades...'
            }
            confirmText={dedupePreview && dedupePreview.duplicates > 0 ? 'Deduplicar' : 'Ok'}
            cancelText={dedupePreview && dedupePreview.duplicates > 0 ? 'Cancelar' : 'Fechar'}
            type={dedupePreview && dedupePreview.duplicates > 0 ? 'warning' : 'info'}
            icon={Layers}
          />
        )}

        {/* Delete Confirmation */}
        {leadToDelete && (
          <ConfirmationModal
            isOpen={true}
            onClose={() => setLeadToDelete(null)}
            onConfirm={confirmDelete}
            title="Excluir Lead?"
            message={`Tem certeza que deseja excluir ${leadToDelete?.companyName}? Essa ação não poderá ser desfeita. Segmento: ${leadToDelete?.segment || '—'} • Status: ${leadToDelete?.status || '—'}`}
            confirmText="Excluir Definitivamente"
            cancelText="Cancelar"
            type="danger"
          />
        )}

        {/* Logout Confirmation */}
        {isLogoutModalOpen && (
          <ConfirmationModal
            isOpen={true}
            onClose={() => setIsLogoutModalOpen(false)}
            onConfirm={() => supabase.auth.signOut()}
            title="Sair do Sistema"
            message="Suas alterações locais não sincronizadas serão preservadas no navegador."
            confirmText="Sair"
            cancelText="Voltar"
            type="warning"
            icon={LogOut}
          />
        )}
      </Suspense>
    </div>
  );
}

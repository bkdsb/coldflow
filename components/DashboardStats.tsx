import React, { useMemo, useState, useEffect } from 'react';
import { Lead, LeadStatus } from '../types';
import { getTicketNumericValue, formatCurrency, getPaidAmount } from '../utils';
import { Sparkles, Flame, TrendingUp, Eye, EyeOff } from 'lucide-react';
import { supabase } from '../supabaseClient';

interface Props {
  leads: Lead[];
}

type DateRange = 'today' | '7d' | '30d' | 'all';

type StatsRow = {
  day: string;
  total_pipeline: number | string;
  forecast_hot: number | string;
  revenue_realized: number | string;
  paid_entry: number | string;
  paid_full: number | string;
  total_ticket_value: number | string;
  total_ticket_count: number | string;
  total_leads: number | string;
  hot_leads: number | string;
  decisor_frio: number | string;
  propostas_enviadas: number | string;
  reunioes_agendadas: number | string;
  pagamentos_feitos: number | string;
};

const SNAPSHOT_KEY = 'coldflow_stats_last_snapshot';
const TRACKER_SNAPSHOT_KEY = 'coldflow_tracker_last_snapshot';

const toNumber = (value: number | string | null | undefined) => {
  const num = typeof value === 'string' ? Number(value) : value ?? 0;
  return Number.isFinite(num) ? num : 0;
};

const getLocalDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getDaysAgoKey = (daysAgo: number) => {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return getLocalDateKey(date);
};

export const DashboardStats: React.FC<Props> = React.memo(({ leads }) => {
  const [isCompactView, setIsCompactView] = useState(false);
  const [dateRange, setDateRange] = useState<DateRange>('all');
  const [historyRows, setHistoryRows] = useState<StatsRow[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [showMobileDetails, setShowMobileDetails] = useState(false);
  const [historyEnabled, setHistoryEnabled] = useState(true);
  const [eventsEnabled, setEventsEnabled] = useState(true);
  const [eventsLoaded, setEventsLoaded] = useState(false);
  const [trackerEnabled, setTrackerEnabled] = useState(true);
  const [eventRows, setEventRows] = useState<any[]>([]);
  const [eventStats, setEventStats] = useState({
    contacts: 0,
    proposals: 0,
    meetings: 0,
    payments: 0
  });

  const liveStats = useMemo(() => {
    let totalPipeline = 0;
    let revenueRealized = 0;
    let forecastHot = 0; // High Probability
    let paidEntryTotal = 0; // Sinal (entrada)
    let paidFullTotal = 0; // Inteiro ou Outro
    let totalTicketCount = 0;
    let totalTicketValue = 0;
    let hotLeadsCount = 0;
    let decisorFrioCount = 0;
    let propostasEnviadasCount = 0;
    let reunioesAgendadasCount = 0;
    let pagamentosFeitosCount = 0;

    leads.forEach(lead => {
      if (lead.status === LeadStatus.DECISOR_FRIO) decisorFrioCount += 1;
      if (lead.status === LeadStatus.PROPOSTA_ENVIADA) {
        propostasEnviadasCount += 1;
      }
      if (lead.meetingDate || lead.status === LeadStatus.REUNIAO_MARCADA) {
        reunioesAgendadasCount += 1;
      }
      const paidAmount = getPaidAmount(lead);
      if (paidAmount > 0) {
        pagamentosFeitosCount += 1;
      }

      const val = getTicketNumericValue(lead.ticketPotential);
      if (paidAmount > 0) {
        if (lead.paidValueType === 'Sinal') {
          paidEntryTotal += paidAmount;
        } else {
          paidFullTotal += paidAmount;
        }
      }
      if (val === 0) return;

      totalTicketCount += 1;
      totalTicketValue += val;

      // 1. REVENUE (Lucro/Caixa)
      if (lead.status === LeadStatus.PROPOSTA_ACEITA) {
        revenueRealized += val;
      }
      // 2. ACTIVE PIPELINE (Exclude lost)
      else if (lead.status !== LeadStatus.NAO_TENTAR_MAIS) {
        totalPipeline += val;

        // 3. FORECAST (Hot Leads)
        // If Meeting Scheduled or Proposal Sent -> Count as High Probability for Cash Flow
        if (
            lead.status === LeadStatus.REUNIAO_MARCADA || 
            lead.status === LeadStatus.PROPOSTA_ENVIADA ||
            lead.status === LeadStatus.DECISOR_INTERESSADO ||
            lead.meetingDate
        ) {
            forecastHot += val;
            hotLeadsCount += 1;
        }
      }

    });

    const totalLeads = leads.length;
    const avgTicket = totalTicketCount > 0 ? totalTicketValue / totalTicketCount : 0;
    return {
      totalPipeline,
      revenueRealized,
      forecastHot,
      paidEntryTotal,
      paidFullTotal,
      avgTicket,
      hotLeadsCount,
      decisorFrioCount,
      propostasEnviadasCount,
      reunioesAgendadasCount,
      pagamentosFeitosCount,
      totalTicketValue,
      totalTicketCount,
      totalLeads
    };
  }, [leads]);
  const historyStats = useMemo(() => {
    if (!historyRows.length) return null;
    const todayKey = getLocalDateKey(new Date());
    const cutoff =
      dateRange === 'today' ? todayKey
      : dateRange === '7d' ? getDaysAgoKey(6)
      : dateRange === '30d' ? getDaysAgoKey(29)
      : null;

    const filtered = dateRange === 'all'
      ? historyRows
      : dateRange === 'today'
        ? historyRows.filter(row => row.day === todayKey)
        : historyRows.filter(row => row.day >= (cutoff || todayKey));

    if (!filtered.length) return null;

    const latest = filtered[0];
    const beforeStart =
      dateRange === 'all'
        ? historyRows[historyRows.length - 1]
        : historyRows.find(row => row.day < (cutoff || todayKey));
    const useDelta = dateRange !== 'all' && !!beforeStart && beforeStart.day !== latest.day;

    const valueOrDelta = (key: keyof StatsRow) => {
      const latestValue = toNumber(latest[key]);
      if (!useDelta) return latestValue;
      const startValue = toNumber(beforeStart?.[key]);
      return Math.max(0, latestValue - startValue);
    };

    const totalTicketCount = valueOrDelta('total_ticket_count');
    const totalTicketValue = valueOrDelta('total_ticket_value');
    const avgTicket = totalTicketCount > 0 ? totalTicketValue / totalTicketCount : 0;

    return {
      totalPipeline: valueOrDelta('total_pipeline'),
      revenueRealized: valueOrDelta('revenue_realized'),
      forecastHot: valueOrDelta('forecast_hot'),
      paidEntryTotal: valueOrDelta('paid_entry'),
      paidFullTotal: valueOrDelta('paid_full'),
      totalTicketValue,
      totalTicketCount,
      totalLeads: valueOrDelta('total_leads'),
      hotLeadsCount: valueOrDelta('hot_leads'),
      decisorFrioCount: valueOrDelta('decisor_frio'),
      propostasEnviadasCount: valueOrDelta('propostas_enviadas'),
      reunioesAgendadasCount: valueOrDelta('reunioes_agendadas'),
      pagamentosFeitosCount: valueOrDelta('pagamentos_feitos'),
      avgTicket
    };
  }, [historyRows, dateRange]);

  const isLiveRange = dateRange === 'today';
  const stats = isLiveRange ? liveStats : (historyStats ?? liveStats);
  const hotRate = stats.totalLeads > 0 ? Math.round((stats.hotLeadsCount / stats.totalLeads) * 100) : 0;

  const barSeries = [
    { key: 'pipeline', label: 'Em negociação', value: stats.totalPipeline, bar: 'bg-blue-600', track: 'bg-blue-50', text: 'text-blue-700' },
    { key: 'hot', label: 'Alta chance', value: stats.forecastHot, bar: 'bg-amber-500', track: 'bg-amber-50', text: 'text-amber-700' },
    { key: 'realizado', label: 'Fechados', value: stats.revenueRealized, bar: 'bg-emerald-500', track: 'bg-emerald-50', text: 'text-emerald-700' },
    ...(stats.paidFullTotal > 0
      ? [{ key: 'recebido', label: 'Recebido', value: stats.paidFullTotal, bar: 'bg-emerald-600', track: 'bg-emerald-50', text: 'text-emerald-700' }]
      : []),
    ...(stats.paidEntryTotal > 0
      ? [{ key: 'entrada', label: 'Sinal', value: stats.paidEntryTotal, bar: 'bg-purple-500', track: 'bg-purple-50', text: 'text-purple-700' }]
      : [])
  ];
  const barMax = Math.max(...barSeries.map((metric) => metric.value), 1);
  const getBarWidth = (value: number) => {
    if (value <= 0) return 0;
    return Math.min(100, Math.max(6, (value / barMax) * 100));
  };
  const coreBarKeys = new Set(['pipeline', 'hot', 'realizado']);
  const mobileCoreBars = barSeries.filter(metric => coreBarKeys.has(metric.key));
  const mobileExtraBars = barSeries.filter(metric => !coreBarKeys.has(metric.key));

  const miniStats = [
    { label: 'Ticket médio', value: formatCurrency(stats.avgTicket) },
    { label: 'Taxa alta chance', value: `${hotRate}%` }
  ];
  const mobileMiniStats = miniStats;

  const proposalsFromLeads = useMemo(
    () => leads.filter((lead) => lead.status === LeadStatus.PROPOSTA_ENVIADA).length,
    [leads]
  );
  const meetingsFromLeads = useMemo(
    () => leads.filter((lead) => Boolean(lead.meetingDate || lead.status === LeadStatus.REUNIAO_MARCADA)).length,
    [leads]
  );
  const paymentsFromLeads = useMemo(
    () => leads.filter((lead) => getPaidAmount(lead) > 0).length,
    [leads]
  );
  const shouldFallbackToLive = !eventsEnabled || !eventsLoaded || eventRows.length === 0;

  const proposalsValue = useMemo(() => {
    if (isLiveRange) return proposalsFromLeads;
    if (shouldFallbackToLive) return proposalsFromLeads;
    if (eventsEnabled && eventsLoaded) {
      if (dateRange === 'all') {
        return Math.max(eventStats.proposals, proposalsFromLeads);
      }
      return eventStats.proposals;
    }
    return proposalsFromLeads;
  }, [eventsEnabled, eventsLoaded, eventStats.proposals, proposalsFromLeads, dateRange, isLiveRange, shouldFallbackToLive]);

  const meetingsValue = useMemo(() => {
    if (isLiveRange) return meetingsFromLeads;
    if (shouldFallbackToLive) return meetingsFromLeads;
    if (eventsEnabled && eventsLoaded) {
      if (dateRange === 'all') {
        return Math.max(eventStats.meetings, meetingsFromLeads);
      }
      return eventStats.meetings;
    }
    return meetingsFromLeads;
  }, [eventsEnabled, eventsLoaded, eventStats.meetings, meetingsFromLeads, dateRange, isLiveRange, shouldFallbackToLive]);

  const paymentsValue = useMemo(() => {
    if (isLiveRange) return paymentsFromLeads;
    if (shouldFallbackToLive) return paymentsFromLeads;
    if (eventsEnabled && eventsLoaded) {
      if (dateRange === 'all') {
        return Math.max(eventStats.payments, paymentsFromLeads);
      }
      return eventStats.payments;
    }
    return paymentsFromLeads;
  }, [eventsEnabled, eventsLoaded, eventStats.payments, paymentsFromLeads, dateRange, isLiveRange, shouldFallbackToLive]);

  const helperProposals = shouldFallbackToLive ? proposalsFromLeads : eventStats.proposals;
  const helperMeetings = shouldFallbackToLive ? meetingsFromLeads : eventStats.meetings;
  const helperPayments = shouldFallbackToLive ? paymentsFromLeads : eventStats.payments;

  const trackerMetrics = useMemo(() => {
    const rows = eventRows || [];
    const contacts = rows.filter((row) => row.event_type === 'contacted');
    const callbacks = rows.filter((row) => row.event_type === 'callback_scheduled');
    const nextContacts = rows.filter((row) => row.event_type === 'next_attempt_set');

    const HALF_LIFE_DAYS = 21;
    const now = Date.now();
    const weightForDate = (ts: number) => {
      const ageDays = Math.max(0, (now - ts) / (1000 * 60 * 60 * 24));
      return Math.exp(-ageDays / HALF_LIFE_DAYS);
    };

    const hourBuckets = new Array(24).fill(0);
    let contactsWeightSum = 0;
    contacts.forEach((row) => {
      if (row?.meta && row.meta.has_time === false) return;
      if (!row.occurred_at) return;
      const ts = Date.parse(row.occurred_at);
      if (Number.isNaN(ts)) return;
      const hour = new Date(ts).getHours();
      const w = weightForDate(ts);
      hourBuckets[hour] += w;
      contactsWeightSum += w;
    });
    let bestHour: number | null = null;
    let bestHourCount = 0;
    hourBuckets.forEach((count, hour) => {
      if (count > bestHourCount) {
        bestHourCount = count;
        bestHour = hour;
      }
    });

    const contactsByLead = new Map<string, number[]>();
    contacts.forEach((row) => {
      if (!row.lead_id || !row.occurred_at) return;
      const ts = Date.parse(row.occurred_at);
      if (Number.isNaN(ts)) return;
      const bucket = contactsByLead.get(row.lead_id) || [];
      bucket.push(ts);
      contactsByLead.set(row.lead_id, bucket);
    });

    let gapWeightSum = 0;
    let gapWeightedTotal = 0;
    let gapSamples = 0;
    contactsByLead.forEach((times) => {
      if (times.length < 2) return;
      const sorted = [...times].sort((a, b) => a - b);
      for (let i = 1; i < sorted.length; i += 1) {
        const diffDays = (sorted[i] - sorted[i - 1]) / (1000 * 60 * 60 * 24);
        if (diffDays > 0 && diffDays < 90) {
          const w = weightForDate(sorted[i]);
          gapWeightSum += w;
          gapWeightedTotal += w * diffDays;
          gapSamples += 1;
        }
      }
    });

    const avgGapDays = gapWeightSum > 0 ? gapWeightedTotal / gapWeightSum : 0;

    return {
      contactsCount: contacts.length,
      contactsWeightSum,
      callbacksCount: callbacks.length,
      nextContactsCount: nextContacts.length,
      meetingsCount: helperMeetings,
      proposalsCount: helperProposals,
      paymentsCount: helperPayments,
      bestContactHour: bestHour,
      bestContactCount: bestHourCount,
      avgFollowupGapDays: avgGapDays,
      followupGapSamples: gapSamples
    };
  }, [eventRows, helperMeetings, helperPayments, helperProposals]);

  const formatHourWindow = (hour: number) => {
    const start = String(hour).padStart(2, '0');
    const end = String((hour + 1) % 24).padStart(2, '0');
    return `${start}h–${end}h`;
  };

  const suggestions = useMemo(() => {
    const items: { title: string; value: string; tooltip?: string; countLabel?: string; metaLine?: string }[] = [];
    if (!eventsEnabled || !eventsLoaded) return items;

    const confidenceLabel = (sample: number) => {
      if (sample >= 18) return 'alta';
      if (sample >= 8) return 'média';
      return 'baixa';
    };

    if (trackerMetrics.contactsCount === 0) {
      return [{ title: 'Sugestões inteligentes', value: 'Ainda não há dados suficientes.' }];
    }

    if (trackerMetrics.bestContactHour !== null && trackerMetrics.contactsWeightSum > 0.8) {
      const count = trackerMetrics.contactsCount;
      const metaLine = count > 0 ? `Sugestão com base em suas interações: ${count} contatos registrados` : undefined;
      items.push({
        title: 'Melhor horário histórico',
        value: `${formatHourWindow(trackerMetrics.bestContactHour)} • ${confidenceLabel(trackerMetrics.contactsWeightSum)} confiança`,
        countLabel: undefined,
        tooltip: count > 0 ? `Contatos registrados = vezes em que você marcou "Último contato" com data e hora.` : undefined,
        metaLine
      });
    }

    if (trackerMetrics.avgFollowupGapDays > 0 || trackerMetrics.followupGapSamples > 0) {
      const base = trackerMetrics.avgFollowupGapDays > 0 ? trackerMetrics.avgFollowupGapDays : 3;
      const days = Math.max(1, Math.round(base));
      const count = trackerMetrics.followupGapSamples;
      const metaLine = count > 0 ? `Sugestão com base em suas interações: ${count} intervalos entre contatos` : undefined;
      items.push({
        title: 'Cadência sugerida',
        value: `a cada ${days} dia${days > 1 ? 's' : ''} • ${confidenceLabel(trackerMetrics.followupGapSamples)} confiança`,
        countLabel: undefined,
        tooltip: count > 0 ? `Intervalos entre contatos = tempo entre um contato e outro no mesmo lead.` : undefined,
        metaLine
      });
    }

    if (trackerMetrics.contactsCount >= 6) {
      const rate = trackerMetrics.meetingsCount > 0
        ? Math.round((trackerMetrics.meetingsCount / trackerMetrics.contactsCount) * 100)
        : 0;
      const count = trackerMetrics.contactsCount;
      const metaLine = count > 0 ? `Sugestão com base em suas interações: ${count} contatos registrados` : undefined;
      items.push({
        title: 'Taxa de avanço p/ reunião',
        value: `${rate}% • ${confidenceLabel(trackerMetrics.contactsCount)} confiança`,
        countLabel: undefined,
        tooltip: count > 0 ? `Contatos registrados = vezes em que você marcou "Último contato" com data e hora.` : undefined,
        metaLine
      });
    }

    if (trackerMetrics.nextContactsCount > 0) {
      const count = trackerMetrics.nextContactsCount;
      const metaLine = count > 0 ? `Sugestão com base em suas interações: ${count} próximos contatos definidos` : undefined;
      items.push({
        title: 'Próximos contatos definidos',
        value: `${trackerMetrics.nextContactsCount}`,
        countLabel: undefined,
        tooltip: count > 0 ? `Próximos contatos definidos = leads com data/hora marcada na Próxima Tentativa.` : undefined,
        metaLine
      });
    }

    return items.slice(0, 3);
  }, [eventsEnabled, eventsLoaded, trackerMetrics]);

  const compactSuggestions = useMemo(() => suggestions.slice(0, 2), [suggestions]);

  const statusStats = [
    ...(eventsEnabled && eventsLoaded
      ? [{ label: 'Follow-ups feitos', value: eventStats.contacts, tone: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' }]
      : []),
    { label: 'Decisor frio', value: stats.decisorFrioCount, tone: 'text-blue-700', bg: 'bg-blue-50', border: 'border-blue-200' },
    { label: 'Reuniões agendadas', value: meetingsValue, tone: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
    { label: 'Pagamentos feitos', value: paymentsValue, tone: 'text-green-700', bg: 'bg-green-50', border: 'border-green-200' }
  ];

  useEffect(() => {
    if (!supabase) {
      setHistoryLoaded(true);
      setHistoryEnabled(false);
      return;
    }
    let active = true;

    const loadHistory = async () => {
      const { data, error } = await supabase
        .from('stats_daily')
        .select('*')
        .order('day', { ascending: false })
        .limit(400);
      if (!active) return;
      if (error) {
        if (error.message?.includes('stats_daily')) {
          setHistoryEnabled(false);
        }
        console.warn('ColdFlow: falha ao carregar histórico de stats', error.message);
        setHistoryLoaded(true);
        return;
      }
      setHistoryRows((data as StatsRow[]) || []);
      setHistoryLoaded(true);
    };

    loadHistory();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!supabase || !eventsEnabled) return;
    let active = true;

    const getRangeBounds = () => {
      const now = new Date();
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      if (dateRange === 'today') {
        return { from: start, to: end };
      }
      const days = dateRange === '7d' ? 6 : dateRange === '30d' ? 29 : null;
      if (days === null) {
        return { from: null, to: end };
      }
      const from = new Date(start);
      from.setDate(from.getDate() - days);
      return { from, to: end };
    };

    const loadEvents = async () => {
      const { from, to } = getRangeBounds();
      const PAGE_SIZE = 1000;
      const rows: any[] = [];
      let offset = 0;
      let hasMore = true;

      while (hasMore && active) {
        let query = supabase
          .from('lead_events')
          .select('lead_id,event_type,new_status,occurred_at')
          .order('occurred_at', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1);
        if (from) query = query.gte('occurred_at', from.toISOString());
        if (to) query = query.lte('occurred_at', to.toISOString());

        const { data, error } = await query;
        if (!active) return;
        if (error) {
          const message = error.message?.toLowerCase() || '';
          const tableMissing = message.includes('lead_events') && (
            message.includes('schema cache') ||
            message.includes('does not exist') ||
            message.includes('relation')
          );
          if (tableMissing) {
            setEventsEnabled(false);
          }
          console.warn('ColdFlow: falha ao carregar eventos', error.message);
          setEventsLoaded(false);
          setEventRows([]);
          return;
        }
        const batch = data || [];
        rows.push(...batch);
        if (batch.length < PAGE_SIZE) {
          hasMore = false;
        } else {
          offset += PAGE_SIZE;
        }
      }

      if (!active) return;

      if (!rows.length) {
        setEventStats({ contacts: 0, proposals: 0, meetings: 0, payments: 0 });
        setEventsLoaded(true);
        setEventRows([]);
        return;
      }

      const counts = { contacts: 0, proposals: 0, meetings: 0, payments: 0 };
      const meetingsBySchedule = new Set<string>();
      const meetingsByStatus = new Set<string>();

      rows.forEach((row: any) => {
        if (row.event_type === 'contacted') counts.contacts += 1;
        if (row.event_type === 'meeting_scheduled' && row.lead_id) {
          meetingsBySchedule.add(row.lead_id);
        }
        if (row.event_type === 'status_change' && row.new_status === LeadStatus.REUNIAO_MARCADA && row.lead_id) {
          meetingsByStatus.add(row.lead_id);
        }
        if (row.event_type === 'status_change' && row.new_status === LeadStatus.PROPOSTA_ENVIADA) counts.proposals += 1;
        if (row.event_type === 'status_change' && row.new_status === LeadStatus.PROPOSTA_ACEITA) counts.payments += 1;
      });

      let meetingsTotal = meetingsBySchedule.size;
      meetingsByStatus.forEach((leadId) => {
        if (!meetingsBySchedule.has(leadId)) meetingsTotal += 1;
      });
      counts.meetings = meetingsTotal;

      setEventStats(counts);
      setEventsLoaded(true);
      setEventRows(rows);
    };

    loadEvents();
    return () => {
      active = false;
    };
  }, [dateRange, eventsEnabled]);

  useEffect(() => {
    if (!supabase || !historyEnabled) return;
    const todayKey = getLocalDateKey(new Date());
    const now = Date.now();
    let shouldSnapshot = true;

    try {
      const stored = localStorage.getItem(SNAPSHOT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.day === todayKey && typeof parsed?.ts === 'number') {
          if (now - parsed.ts < 10 * 60 * 1000) {
            shouldSnapshot = false;
          }
        }
      }
    } catch {
      shouldSnapshot = true;
    }

    if (!shouldSnapshot) return;

    const payload = {
      day: todayKey,
      total_pipeline: liveStats.totalPipeline,
      forecast_hot: liveStats.forecastHot,
      revenue_realized: liveStats.revenueRealized,
      paid_entry: liveStats.paidEntryTotal,
      paid_full: liveStats.paidFullTotal,
      total_ticket_value: liveStats.totalTicketValue,
      total_ticket_count: liveStats.totalTicketCount,
      total_leads: liveStats.totalLeads,
      hot_leads: liveStats.hotLeadsCount,
      decisor_frio: liveStats.decisorFrioCount,
      propostas_enviadas: liveStats.propostasEnviadasCount,
      reunioes_agendadas: liveStats.reunioesAgendadasCount,
      pagamentos_feitos: liveStats.pagamentosFeitosCount
    };

    supabase
      .from('stats_daily')
      .upsert(payload)
      .then(({ error }) => {
        if (error) {
          if (error.message?.includes('stats_daily')) {
            setHistoryEnabled(false);
          }
          console.warn('ColdFlow: falha ao salvar snapshot diário', error.message);
          return;
        }
        localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ day: todayKey, ts: now }));
        setHistoryRows(prev => {
          const filtered = prev.filter(row => row.day !== todayKey);
          return [{ ...(payload as StatsRow), day: todayKey }, ...filtered];
        });
      });
  }, [liveStats, historyEnabled]);

  useEffect(() => {
    if (!supabase || !eventsEnabled || !trackerEnabled) return;
    if (dateRange !== 'today' || !eventsLoaded) return;

    const todayKey = getLocalDateKey(new Date());
    const now = Date.now();
    let shouldSnapshot = true;

    try {
      const stored = localStorage.getItem(TRACKER_SNAPSHOT_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed?.day === todayKey && typeof parsed?.ts === 'number') {
          if (now - parsed.ts < 10 * 60 * 1000) {
            shouldSnapshot = false;
          }
        }
      }
    } catch {
      shouldSnapshot = true;
    }

    if (!shouldSnapshot) return;

    const payload = {
      day: todayKey,
      contacts_count: Math.round(trackerMetrics.contactsCount),
      callbacks_count: Math.round(trackerMetrics.callbacksCount),
      meetings_count: Math.round(trackerMetrics.meetingsCount),
      proposals_count: Math.round(trackerMetrics.proposalsCount),
      payments_count: Math.round(trackerMetrics.paymentsCount),
      next_contacts_count: Math.round(trackerMetrics.nextContactsCount),
      best_contact_hour: trackerMetrics.bestContactHour,
      best_contact_count: Number.isFinite(trackerMetrics.bestContactCount)
        ? trackerMetrics.bestContactCount
        : 0,
      avg_followup_gap_days: trackerMetrics.avgFollowupGapDays,
      followup_gap_samples: Math.round(trackerMetrics.followupGapSamples)
    };

    supabase
      .from('tracker_daily')
      .upsert(payload)
      .then(({ error }) => {
        if (error) {
          if (error.message?.includes('tracker_daily')) {
            setTrackerEnabled(false);
          }
          console.warn('ColdFlow: falha ao salvar tracker diário', error.message);
          return;
        }
        localStorage.setItem(TRACKER_SNAPSHOT_KEY, JSON.stringify({ day: todayKey, ts: now }));
      });
  }, [dateRange, eventsLoaded, eventsEnabled, trackerEnabled, trackerMetrics]);

  const rangeOptions: { key: DateRange; label: string }[] = [
    { key: 'today', label: 'Hoje' },
    { key: '7d', label: '7 dias' },
    { key: '30d', label: '30 dias' },
    { key: 'all', label: 'Tudo' }
  ];

  return (
    <div className="mb-8">
      <div className="md:hidden">
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="relative px-5 py-5 overflow-hidden">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-white" />
            {isCompactView ? (
              <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1.5">
                      <Sparkles size={12} className="text-blue-500" /> Receita estimada
                    </span>
                    <div className="mt-1 text-2xl font-black text-gray-900">
                      {formatCurrency(stats.forecastHot)}
                    </div>
                    <p className="text-xs text-gray-500">Alta chance de fechamento</p>
                    {compactSuggestions.length > 0 && (
                      <div className="mt-2 space-y-1">
                        {compactSuggestions.map((item, index) => (
                          <div
                            key={`${item.title}-${index}`}
                            className="text-[10px] text-gray-500"
                            title={item.tooltip}
                          >
                            <span className="font-semibold text-gray-600">{item.title}:</span> {item.value}
                            {item.metaLine && <span className="text-[10px] text-gray-400 block">{item.metaLine}</span>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCompactView(prev => !prev)}
                    className="shrink-0 p-2 rounded-full border border-gray-200 bg-white/90 text-gray-500 hover:text-gray-900 hover:border-gray-300 shadow-sm transition"
                    title={isCompactView ? 'Ver visão geral' : 'Ver visão minimalista'}
                    aria-label={isCompactView ? 'Mostrar visão geral do chart' : 'Mostrar visão minimalista do chart'}
                  >
                    {isCompactView ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                {historyEnabled && (
                  <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1">
                    {rangeOptions.map(option => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setDateRange(option.key)}
                        className={`px-3 py-1 rounded-full text-[10px] font-semibold border transition ${
                          dateRange === option.key
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white/80 text-gray-500 border-gray-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                    {!historyLoaded && (
                      <span className="text-[10px] text-gray-400">Carregando...</span>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  <div className="rounded-lg border border-blue-100 bg-blue-50/60 px-2.5 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-blue-500">Em negociação</div>
                    <div className="text-[12px] font-semibold text-blue-800">{formatCurrency(stats.totalPipeline)}</div>
                  </div>
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 px-2.5 py-2">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-emerald-600">Fechados</div>
                    <div className="text-[12px] font-semibold text-emerald-800">{formatCurrency(stats.revenueRealized)}</div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="relative z-10 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-[9px] uppercase tracking-wider text-gray-400 font-semibold flex items-center gap-1.5">
                      <Sparkles size={12} className="text-blue-500" /> Receita estimada
                    </span>
                    <div className="mt-1 text-2xl font-black text-gray-900">
                      {formatCurrency(stats.forecastHot)}
                    </div>
                    <p className="text-xs text-gray-500">Alta chance de fechamento</p>
                  </div>
                <button
                  type="button"
                  onClick={() => setIsCompactView(prev => !prev)}
                  className="shrink-0 p-2 rounded-full border border-gray-200 bg-white/90 text-gray-500 hover:text-gray-900 hover:border-gray-300 shadow-sm transition"
                  title={isCompactView ? 'Ver visão geral' : 'Ver visão minimalista'}
                  aria-label={isCompactView ? 'Mostrar visão geral do chart' : 'Mostrar visão minimalista do chart'}
                >
                  {isCompactView ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                </div>
                {historyEnabled && (
                  <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto pb-1">
                    {rangeOptions.map(option => (
                      <button
                        key={option.key}
                        type="button"
                        onClick={() => setDateRange(option.key)}
                        className={`px-3 py-1 rounded-full text-[10px] font-semibold border transition ${
                          dateRange === option.key
                            ? 'bg-gray-900 text-white border-gray-900'
                            : 'bg-white/80 text-gray-500 border-gray-200'
                        }`}
                      >
                        {option.label}
                      </button>
                    ))}
                    {!historyLoaded && (
                      <span className="text-[10px] text-gray-400">Carregando...</span>
                    )}
                  </div>
                )}
                {!showMobileDetails && (
                  <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                    <span className="px-2 py-1 rounded-full border border-gray-200 bg-white/80 text-gray-600 whitespace-nowrap">
                      Leads: <strong className="text-gray-900">{stats.totalLeads}</strong>
                    </span>
                    <span className="px-2 py-1 rounded-full border border-amber-200 bg-amber-50 text-amber-700 flex items-center gap-1 whitespace-nowrap">
                      <Flame size={12} /> Alta chance <strong>{stats.hotLeadsCount}</strong>
                      <span className="text-amber-400">•</span>
                      Propostas enviadas <strong>{proposalsValue}</strong>
                    </span>
                  </div>
                )}
                <div className="space-y-3">
                  {mobileCoreBars.map((metric) => (
                    <div key={metric.key} className="flex items-center gap-3">
                      <span className="w-20 text-[10px] uppercase tracking-wider text-gray-400 font-semibold truncate">{metric.label}</span>
                      <div className={`flex-1 h-2.5 rounded-full ${metric.track} overflow-hidden`}>
                        <div
                          className={`${metric.bar} h-full rounded-full`}
                          style={{ width: `${getBarWidth(metric.value)}%` }}
                        />
                      </div>
                      <span className={`text-[11px] font-semibold ${metric.text}`}>{formatCurrency(metric.value)}</span>
                    </div>
                  ))}
                </div>
                <button
                  type="button"
                  onClick={() => setShowMobileDetails(prev => !prev)}
                  className="text-xs font-semibold text-blue-600 hover:text-blue-700 self-start"
                >
                  {showMobileDetails ? 'Ocultar detalhes' : 'Mostrar detalhes'}
                </button>
                {showMobileDetails && (
                  <div className="space-y-3">
                    {mobileExtraBars.length > 0 && (
                      <div className="space-y-2">
                        {mobileExtraBars.map((metric) => (
                          <div key={metric.key} className="flex items-center gap-3">
                            <span className="w-20 text-[10px] uppercase tracking-wider text-gray-400 font-semibold truncate">{metric.label}</span>
                            <div className={`flex-1 h-2 rounded-full ${metric.track} overflow-hidden`}>
                              <div
                                className={`${metric.bar} h-full rounded-full`}
                                style={{ width: `${getBarWidth(metric.value)}%` }}
                              />
                            </div>
                            <span className={`text-[11px] font-semibold ${metric.text}`}>{formatCurrency(metric.value)}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2">
                      {mobileMiniStats.map((metric) => (
                        <div key={metric.label} className="rounded-lg border border-gray-200 bg-white/80 px-2.5 py-2">
                          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">{metric.label}</div>
                          <div className="text-[11px] font-semibold text-gray-900">{metric.value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      {statusStats.map((metric) => (
                        <div
                          key={metric.label}
                          className={`rounded-lg border ${metric.border} ${metric.bg} px-2.5 py-2`}
                        >
                          <div className="text-[9px] font-bold uppercase tracking-wider text-gray-500">{metric.label}</div>
                          <div className={`text-[12px] font-semibold ${metric.tone}`}>{metric.value}</div>
                        </div>
                      ))}
                    </div>
                    {suggestions.length > 0 && (
                      <div className="rounded-lg border border-gray-200 bg-white/80 px-2.5 py-2">
                        <div className="text-[9px] font-bold uppercase tracking-wider text-gray-400">Sugestões</div>
                        <div className="mt-1 space-y-1">
                          {suggestions.map((item, index) => (
                            <div
                              key={`${item.title}-${index}`}
                              className="text-[11px] text-gray-600"
                              title={item.tooltip}
                            >
                              <span className="font-semibold text-gray-700">{item.title}:</span> {item.value}
                              {item.countLabel && <span className="text-[10px] text-gray-400"> {item.countLabel}</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="hidden md:block">
        <div className="bg-white rounded-3xl border border-gray-200 shadow-[0_24px_48px_rgba(15,23,42,0.08)] overflow-hidden">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-white" />
            <div className="relative z-10 px-8 py-7 lg:px-10 lg:py-8">
              <div className="flex items-center justify-between">
                <span className="inline-flex items-center gap-2 text-[11px] uppercase tracking-wider font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full">
                  <TrendingUp size={12} /> {isCompactView ? 'Receita estimada' : 'Visão geral'}
                </span>
                <div className="flex items-center gap-3">
                  {historyEnabled && (
                    <div className="flex items-center gap-1 bg-white/80 border border-gray-200 rounded-full p-1">
                      {rangeOptions.map(option => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setDateRange(option.key)}
                          className={`px-3 py-1 rounded-full text-[10px] font-semibold transition ${
                            dateRange === option.key
                              ? 'bg-gray-900 text-white'
                              : 'text-gray-500'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  )}
                  {historyEnabled && !historyLoaded && (
                    <span className="text-[10px] text-gray-400">Carregando...</span>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsCompactView(prev => !prev)}
                    className="p-2 rounded-full border border-gray-200 bg-white/90 text-gray-500 hover:text-gray-900 hover:border-gray-300 shadow-sm transition"
                    title={isCompactView ? 'Ver visão geral' : 'Ver visão minimalista'}
                    aria-label={isCompactView ? 'Mostrar visão geral do chart' : 'Mostrar visão minimalista do chart'}
                  >
                    {isCompactView ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
              </div>

              {isCompactView ? (
                <div className="mt-6 grid grid-cols-12 gap-4 items-center">
                  <div className="col-span-12 xl:col-span-7">
                    <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Receita estimada</div>
                    <div className="mt-2 text-3xl font-black text-gray-900">{formatCurrency(stats.forecastHot)}</div>
                    <p className="text-sm text-gray-500 mt-1">Alta chance de fechamento</p>
                    {compactSuggestions.length > 0 && (
                      <div className="mt-3 space-y-1">
                        {compactSuggestions.map((item, index) => (
                          <div key={`${item.title}-${index}`} className="text-xs text-gray-500">
                            <span className="font-semibold text-gray-600">{item.title}:</span> {item.value}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="col-span-12 xl:col-span-5 grid grid-cols-2 gap-3">
                    <div className="rounded-2xl border border-blue-100 bg-blue-50/70 px-5 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
                      <div className="text-xs font-semibold text-blue-600">Em negociação</div>
                      <div className="mt-2 text-2xl font-semibold text-blue-900">{formatCurrency(stats.totalPipeline)}</div>
                    </div>
                    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/70 px-5 py-4 shadow-[0_12px_24px_rgba(15,23,42,0.06)]">
                      <div className="text-xs font-semibold text-emerald-600">Fechados</div>
                      <div className="mt-2 text-2xl font-semibold text-emerald-900">{formatCurrency(stats.revenueRealized)}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 grid grid-cols-12 gap-6 items-stretch">
                  <div className="col-span-12 xl:col-span-7 flex flex-col h-full">
                    <h2 className="text-3xl font-black text-gray-900">
                      {formatCurrency(stats.forecastHot)}
                    </h2>
                    <p className="text-sm text-gray-500 mt-1">Receita estimada (alta chance)</p>

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <span className="px-3 py-1.5 rounded-full border border-gray-200 bg-white/80 text-sm text-gray-600">
                        Leads totais <strong className="text-gray-900">{stats.totalLeads}</strong>
                      </span>
                      <span className="px-3 py-1.5 rounded-full border border-amber-200 bg-amber-50 text-sm text-amber-700 flex items-center gap-2">
                        <Flame size={14} /> Alta chance <strong>{stats.hotLeadsCount}</strong>
                        <span className="text-amber-400">•</span>
                        Propostas enviadas <strong>{proposalsValue}</strong>
                      </span>
                    </div>

                    <div className="mt-6 grid grid-cols-3 gap-4">
                      {miniStats.map((metric) => (
                        <div key={metric.label} className="rounded-xl border border-white/70 bg-white/70 px-4 py-3 shadow-[0_12px_24px_rgba(15,23,42,0.08)] backdrop-blur-sm">
                          <div className="text-xs font-semibold text-gray-500">{metric.label}</div>
                          <div className="text-lg font-semibold text-gray-900">{metric.value}</div>
                        </div>
                      ))}
                    </div>

                    <div className="mt-4 grid grid-cols-2 xl:grid-cols-4 gap-3">
                      {statusStats.map((metric) => (
                        <div
                          key={metric.label}
                          className={`rounded-xl border ${metric.border} ${metric.bg} px-4 py-3 shadow-[0_10px_20px_rgba(15,23,42,0.06)]`}
                        >
                          <div className="text-xs font-semibold text-gray-600">{metric.label}</div>
                          <div className={`text-lg font-semibold ${metric.tone}`}>{metric.value}</div>
                        </div>
                      ))}
                    </div>
                    {suggestions.length > 0 && (
                      <div className="mt-4">
                        <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                          Sugestões inteligentes
                        </div>
                        <div className={`mt-2 grid gap-3 ${suggestions.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
                          {suggestions.map((item, index) => (
                            <div
                              key={`${item.title}-${index}`}
                              className="rounded-xl border border-gray-200 bg-white/80 px-4 py-3 shadow-[0_10px_20px_rgba(15,23,42,0.06)]"
                              title={item.tooltip}
                            >
                              <div className="text-[11px] font-semibold text-gray-500">{item.title}</div>
                              <div className="text-sm font-semibold text-gray-900">
                                {item.value}
                              </div>
                              {item.metaLine && <div className="mt-1 text-[10px] text-gray-400">{item.metaLine}</div>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="col-span-12 xl:col-span-5 flex">
                    <div className="bg-white/80 border border-white/70 rounded-2xl p-5 shadow-[0_18px_36px_rgba(15,23,42,0.08)] w-full h-full flex flex-col">
                      <div className="text-[10px] uppercase tracking-wider text-gray-400 font-semibold">
                        Resumo financeiro
                      </div>
                      <div className="mt-4 space-y-3 flex-1 flex flex-col justify-center">
                        {barSeries.map((metric) => (
                          <div key={metric.key} className="flex items-center gap-4">
                            <span className="w-28 text-[11px] font-semibold text-gray-500">{metric.label}</span>
                            <div className={`flex-1 h-2.5 rounded-full ${metric.track} overflow-hidden`}>
                              <div
                                className={`${metric.bar} h-full rounded-full`}
                                style={{ width: `${getBarWidth(metric.value)}%` }}
                              />
                            </div>
                            <span className={`text-sm font-semibold ${metric.text}`}>{formatCurrency(metric.value)}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

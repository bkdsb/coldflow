import * as XLSX from 'xlsx';
import { Lead } from '../types';

export type ExportFormat = 'csv' | 'xlsx';

const EXPORT_HEADERS = [
  'GOOGLEMAPS',
  'EMPRESA',
  'AVALIAÇÃO',
  'PROFISSÃO',
  'TELEFONE',
  'SITE',
  'ORIGEM',
  'DECISOR',
  'STATUS',
  'TICKET',
  'TENTATIVAS',
  'ÚLTIMO CONTATO',
  'PRÓXIMA TENTATIVA',
  'OBSERVAÇÕES'
];

const formatDate = (date: string | null) => date || '';
const formatDateTime = (date: string | null, time?: string | null) => {
  if (!date) return '';
  if (time) return `${date} ${time}`;
  return date;
};

const buildExportRows = (leads: Lead[]) => {
  return leads.map((lead) => ([
    lead.originLink || '',
    lead.companyName || '',
    lead.originRating ?? '',
    lead.segment || '',
    lead.decisors?.[0]?.phone || '',
    lead.siteUrl || '',
    lead.origin || '',
    lead.decisors?.[0]?.name || '',
    lead.status || '',
    lead.ticketPotential || '',
    lead.attempts ?? 0,
    formatDate(lead.lastContactDate),
    formatDateTime(lead.nextAttemptDate, lead.nextAttemptTime),
    lead.notes || ''
  ]));
};

const downloadBlob = (blob: Blob, filename: string) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
};

export const exportLeadsFile = (leads: Lead[], format: ExportFormat) => {
  const matrix = [EXPORT_HEADERS, ...buildExportRows(leads)];
  const sheet = XLSX.utils.aoa_to_sheet(matrix);
  const dateTag = new Date().toISOString().slice(0, 10);
  const fileName = `coldflow_leads_${dateTag}.${format}`;

  if (format === 'csv') {
    const csv = XLSX.utils.sheet_to_csv(sheet);
    const csvWithBom = `\uFEFF${csv}`;
    const blob = new Blob([csvWithBom], { type: 'text/csv;charset=utf-8;' });
    downloadBlob(blob, fileName);
    return;
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Leads');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([output], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  });
  downloadBlob(blob, fileName);
};

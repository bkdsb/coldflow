import React, { useMemo, useState } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";
import { Lead } from "../types";
import { mapRowsToLeads } from "../utils/importLeads";
import { Upload, FileText, AlertTriangle, CheckCircle2 } from "lucide-react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onImport: (leads: Lead[]) => Promise<void> | void;
}

export default function ImportLeadsModal({ isOpen, onClose, onImport }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [fileName, setFileName] = useState("");
  const [rowsCount, setRowsCount] = useState(0);
  const [rawRows, setRawRows] = useState<Record<string, any>[]>([]);
  const [leads, setLeads] = useState<Lead[]>([]);
  const [skipped, setSkipped] = useState(0);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [headerMapInfo, setHeaderMapInfo] = useState<Record<string, string | undefined>>({});
  const [originOverride, setOriginOverride] = useState("Google Maps");
  const [originOtherLabel, setOriginOtherLabel] = useState("");

  const previewLeads = useMemo(() => leads.slice(0, 6), [leads]);

  if (!isOpen) return null;

  const resetState = () => {
    setError("");
    setFileName("");
    setRowsCount(0);
    setRawRows([]);
    setLeads([]);
    setSkipped(0);
    setWarnings([]);
    setHeaderMapInfo({});
    setOriginOverride("Google Maps");
    setOriginOtherLabel("");
  };

  const handleClose = () => {
    if (loading) return;
    resetState();
    onClose();
  };

  const parseCsv = (file: File) =>
    new Promise<Record<string, any>[]>((resolve, reject) => {
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (result) => resolve(result.data as Record<string, any>[]),
        error: (err) => reject(err)
      });
    });

  const parseXlsx = async (file: File) => {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return XLSX.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, any>[];
  };

  const handleFile = async (file?: File | null) => {
    if (!file) return;
    setLoading(true);
    setError("");
    setFileName(file.name);

    try {
      const extension = file.name.split(".").pop()?.toLowerCase();
      let rows: Record<string, any>[] = [];
      if (extension === "csv") {
        rows = await parseCsv(file);
      } else if (extension === "xlsx" || extension === "xls") {
        rows = await parseXlsx(file);
      } else {
        throw new Error("Formato inválido. Use CSV ou XLSX.");
      }

      setRawRows(rows);
      const result = mapRowsToLeads(rows, { originOverride, originOtherLabel });
      setRowsCount(rows.length);
      setLeads(result.leads);
      setSkipped(result.skipped);
      setWarnings(result.warnings);
      setHeaderMapInfo(result.headerMap);
    } catch (err: any) {
      setError(err?.message || "Erro ao processar o arquivo.");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    if (!leads.length) return;
    setLoading(true);
    try {
      await onImport(leads);
      resetState();
      onClose();
    } finally {
      setLoading(false);
    }
  };

  const reprocessWithOrigin = (nextOrigin: string, nextOther: string) => {
    if (!rawRows.length) return;
    const result = mapRowsToLeads(rawRows, { originOverride: nextOrigin, originOtherLabel: nextOther });
    setLeads(result.leads);
    setSkipped(result.skipped);
    setWarnings(result.warnings);
    setHeaderMapInfo(result.headerMap);
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-lg">
              <Upload size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Importar Leads</h2>
              <p className="text-xs text-gray-500">CSV ou Excel (XLSX)</p>
            </div>
          </div>
          <button onClick={handleClose} className="text-gray-400 hover:text-gray-700 text-sm">
            Fechar
          </button>
        </div>

        <div className="p-6 space-y-4">
          <label className="flex flex-col gap-3 items-center justify-center border-2 border-dashed border-gray-200 rounded-2xl p-6 text-center cursor-pointer hover:border-blue-300 hover:bg-blue-50/30 transition">
            <FileText className="text-gray-400" size={24} />
            <div>
              <p className="text-sm font-semibold text-gray-700">Arraste o arquivo ou clique para selecionar</p>
              <p className="text-xs text-gray-400">CSV ou XLSX</p>
            </div>
            <input
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
          </label>

          <div className="grid md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Origem padrão</label>
              <select
                value={originOverride}
                onChange={(e) => {
                  const nextValue = e.target.value;
                  setOriginOverride(nextValue);
                  reprocessWithOrigin(nextValue, originOtherLabel);
                }}
                className="mt-1 w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
              >
                <option value="Google Maps">Google Maps (padrão)</option>
                <option value="Auto">Auto detectar pelo link</option>
                <option value="Instagram">Instagram</option>
                <option value="Facebook">Facebook</option>
                <option value="WhatsApp">WhatsApp</option>
                <option value="Site">Site</option>
                <option value="Indicação">Indicação</option>
                <option value="Outro">Outro</option>
              </select>
            </div>

            {originOverride === "Outro" && (
              <div>
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Nome da origem</label>
                <input
                  value={originOtherLabel}
                  onChange={(e) => {
                    const nextValue = e.target.value;
                    setOriginOtherLabel(nextValue);
                    reprocessWithOrigin(originOverride, nextValue);
                  }}
                  className="mt-1 w-full px-3 py-2.5 bg-white border border-gray-200 rounded-lg text-sm font-medium focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none"
                  placeholder="Ex: Indicação feira"
                />
              </div>
            )}
          </div>

          {loading && <p className="text-sm text-gray-500">Processando arquivo...</p>}

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-100 p-3 rounded-lg">
              <AlertTriangle size={16} /> {error}
            </div>
          )}

          {!!leads.length && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-3 text-xs text-gray-600">
                <span className="px-2.5 py-1 rounded-full bg-gray-100 border">Arquivo: {fileName}</span>
                <span className="px-2.5 py-1 rounded-full bg-gray-100 border">Linhas: {rowsCount}</span>
                <span className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700">Leads válidos: {leads.length}</span>
                {skipped > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
                    Ignorados: {skipped}
                  </span>
                )}
              </div>

              {warnings.length > 0 && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 p-3 rounded-lg">
                  {warnings.map((warning, idx) => (
                    <p key={idx}>• {warning}</p>
                  ))}
                </div>
              )}

              <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                {Object.entries(headerMapInfo).map(([key, value]) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="uppercase text-[10px] text-gray-400">{key}</span>
                    <span className="font-semibold text-gray-700">{value || "-"}</span>
                  </div>
                ))}
              </div>

              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="bg-gray-50 px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  Pré-visualização
                </div>
                <div className="divide-y divide-gray-100">
                  {previewLeads.map((lead) => (
                    <div key={lead.id} className="px-4 py-3 text-sm flex flex-col md:flex-row md:items-center md:justify-between gap-2">
                      <div>
                        <p className="font-semibold text-gray-900">{lead.companyName}</p>
                        <p className="text-xs text-gray-500">{lead.segment}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-gray-500">
                        <span className="px-2 py-1 rounded-full bg-gray-100 border">{lead.origin}</span>
                        {lead.originRating !== null && lead.originRating !== undefined && (
                          <span className="px-2 py-1 rounded-full bg-yellow-50 border border-yellow-200 text-yellow-700">
                            {lead.originRating.toFixed(1)}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {lead.decisors[0]?.phone || "Sem telefone"}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <button onClick={handleClose} className="text-sm font-semibold text-gray-500 hover:text-gray-800">
            Cancelar
          </button>
          <button
            onClick={handleImport}
            disabled={!leads.length || loading}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
          >
            {loading ? "Importando..." : (
              <>
                <CheckCircle2 size={16} /> Importar leads
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

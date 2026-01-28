import React, { useMemo, useState, useEffect } from "react";
import { Download, Filter, CheckCircle2 } from "lucide-react";
import { Lead } from "../types";
import { exportLeadsFile, ExportFormat } from "../utils/exportLeads";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  leads: Lead[];
  availableSegments: string[];
  segmentCounts: Map<string, number>;
}

export default function ExportLeadsModal({
  isOpen,
  onClose,
  leads,
  availableSegments,
  segmentCounts
}: Props) {
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [scope, setScope] = useState<"all" | "segments">("all");
  const [segmentQuery, setSegmentQuery] = useState("");
  const [selectedSegments, setSelectedSegments] = useState<string[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setFormat("xlsx");
    setScope("all");
    setSegmentQuery("");
    setSelectedSegments([]);
  }, [isOpen]);

  const filteredSegments = useMemo(() => {
    const q = segmentQuery.toLowerCase().trim();
    let list = availableSegments;
    if (q) {
      list = list.filter((seg) => seg.toLowerCase().includes(q));
    }
    return list.sort((a, b) => (segmentCounts.get(b) || 0) - (segmentCounts.get(a) || 0));
  }, [availableSegments, segmentCounts, segmentQuery]);

  const leadsToExport = useMemo(() => {
    if (scope === "all") return leads;
    if (selectedSegments.length === 0) return [];
    return leads.filter((lead) => selectedSegments.includes(lead.segment));
  }, [leads, scope, selectedSegments]);

  const toggleSegment = (segment: string) => {
    setScope("segments");
    setSelectedSegments((prev) =>
      prev.includes(segment) ? prev.filter((s) => s !== segment) : [...prev, segment]
    );
  };

  const handleExport = () => {
    if (!leadsToExport.length) return;
    exportLeadsFile(leadsToExport, format);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/40 backdrop-blur-sm flex items-center justify-center px-4">
      <div className="w-full max-w-3xl bg-white rounded-2xl shadow-2xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-600 text-white flex items-center justify-center shadow-lg">
              <Download size={18} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">Exportar Leads</h2>
              <p className="text-xs text-gray-500">CSV ou Excel (XLSX)</p>
            </div>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-sm">
            Fechar
          </button>
        </div>

        <div className="p-6 space-y-5">
          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Formato</label>
            <div className="mt-2 flex gap-2">
              {(["csv", "xlsx"] as ExportFormat[]).map((option) => (
                <button
                  key={option}
                  onClick={() => setFormat(option)}
                  className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
                    format === option
                      ? "bg-emerald-600 text-white border-emerald-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-emerald-200 hover:text-emerald-700"
                  }`}
                >
                  {option.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Categorias / Segmentos</label>
            <div className="mt-2 flex gap-2">
              <button
                onClick={() => {
                  setScope("all");
                  setSelectedSegments([]);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
                  scope === "all"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-200 hover:text-blue-700"
                }`}
              >
                Todos
              </button>
              <button
                onClick={() => setScope("segments")}
                className={`px-4 py-2 rounded-lg text-sm font-semibold border transition ${
                  scope === "segments"
                    ? "bg-blue-600 text-white border-blue-600"
                    : "bg-white text-gray-600 border-gray-200 hover:border-blue-200 hover:text-blue-700"
                }`}
              >
                Selecionar
              </button>
            </div>

            {scope === "segments" && (
              <div className="mt-4 border border-gray-200 rounded-xl p-4 bg-gray-50/40">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 text-xs text-gray-500 font-semibold uppercase tracking-wide">
                    <Filter size={14} /> Escolha os segmentos
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <button
                      onClick={() => setSelectedSegments(availableSegments)}
                      className="text-blue-600 hover:text-blue-700 font-semibold"
                    >
                      Selecionar todos
                    </button>
                    <span className="text-gray-300">|</span>
                    <button
                      onClick={() => setSelectedSegments([])}
                      className="text-gray-500 hover:text-gray-700 font-semibold"
                    >
                      Limpar
                    </button>
                  </div>
                </div>

                <input
                  value={segmentQuery}
                  onChange={(e) => setSegmentQuery(e.target.value)}
                  placeholder="Buscar categoria..."
                  className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:ring-2 focus:ring-blue-100 focus:border-blue-500 outline-none bg-white"
                />

                <div className="mt-3 max-h-48 overflow-y-auto pr-1 space-y-1">
                  {filteredSegments.length === 0 && (
                    <p className="text-xs text-gray-400 px-2 py-1">Nenhum segmento encontrado.</p>
                  )}
                  {filteredSegments.map((segment) => (
                    <label
                      key={segment}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg hover:bg-white text-sm text-gray-700 cursor-pointer"
                    >
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

          <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span className="px-2.5 py-1 rounded-full bg-gray-100 border">
              Leads para exportar: <strong className="text-gray-900">{leadsToExport.length}</strong>
            </span>
            {scope === "segments" && (
              <span className="px-2.5 py-1 rounded-full bg-blue-50 border border-blue-200 text-blue-700">
                Segmentos selecionados: {selectedSegments.length}
              </span>
            )}
            {scope === "segments" && selectedSegments.length === 0 && (
              <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-700">
                Selecione ao menos 1 segmento
              </span>
            )}
          </div>
        </div>

        <div className="px-6 py-4 border-t border-gray-100 flex items-center justify-between">
          <button onClick={onClose} className="text-sm font-semibold text-gray-500 hover:text-gray-800">
            Cancelar
          </button>
          <button
            onClick={handleExport}
            disabled={leadsToExport.length === 0}
            className="inline-flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-50"
          >
            <CheckCircle2 size={16} /> Exportar {format.toUpperCase()}
          </button>
        </div>
      </div>
    </div>
  );
}

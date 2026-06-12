import { useState, useEffect } from "react";
import { Search, CheckCircle, Clock } from "lucide-react";
import RunCard from "../components/RunCard";
import type { RunSummary } from "../types";
import { useLocale, t } from "../i18n";

export default function History() {
  const { m } = useLocale();
  const h = m.history;

  const [runs,    setRuns]    = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [search,  setSearch]  = useState("");

  useEffect(() => {
    window.kt.history.list().then((list) => {
      const summaries = (list as Array<RunSummary & { uploadedAt?: string }>)
        .map((r) => ({ ...r, syncStatus: "uploaded" as const }));
      setRuns(summaries);
      setLoading(false);
    });
  }, []);

  const filtered = runs.filter((r) => {
    if (!search) return true;
    return r.dungeonName.toLowerCase().includes(search.toLowerCase());
  });

  return (
    <div className="p-6 space-y-4">
      <div>
        <h1 className="text-lg font-semibold text-white">{h.title}</h1>
        <p className="text-xs text-gray-500 mt-0.5">
          {loading ? h.loading : t(h.subtitle, { n: runs.length })}
        </p>
      </div>

      {/* Search + count */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 bg-surface-700 border border-surface-500 rounded-lg px-3 py-1.5">
          <Search size={12} className="text-gray-500" />
          <input
            type="text"
            placeholder={h.search}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="bg-transparent text-xs text-white outline-none w-40 placeholder:text-gray-600"
          />
        </div>
        {search && (
          <span className="text-xs text-gray-500">{t(h.results, { n: filtered.length })}</span>
        )}
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-16">
          <div className="w-5 h-5 border-2 border-accent-purple border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : filtered.length > 0 ? (
        <div className="grid grid-cols-2 gap-3">
          {filtered.map((r) => (
            <RunCard key={r.id} run={r} />
          ))}
        </div>
      ) : runs.length === 0 ? (
        <div className="text-center py-16">
          <CheckCircle size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{h.empty}</p>
          <p className="text-gray-600 text-xs mt-1">{h.emptyHint}</p>
        </div>
      ) : (
        <div className="text-center py-16">
          <Clock size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{t(h.noResults, { q: search })}</p>
        </div>
      )}
    </div>
  );
}

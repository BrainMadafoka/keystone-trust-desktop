import { useState, useEffect, useRef } from "react";
import { Trash2, RefreshCw } from "lucide-react";
import { useLocale, t } from "../i18n";

interface LogEntry { ts: number; level: "info" | "warn" | "error"; msg: string; }

export default function Logs() {
  const { m, locale } = useLocale();
  const l = m.logs;

  const [logs,   setLogs]   = useState<LogEntry[]>([]);
  const [filter, setFilter] = useState<"all" | "warn" | "error">("all");
  const bottomRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    const data = await window.kt.logs.get();
    setLogs(data as LogEntry[]);
  };

  useEffect(() => {
    load();
    const off = window.kt.on("logs:new", (entry) => {
      setLogs((prev) => [...prev.slice(-499), entry as LogEntry]);
    });
    return off;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  const handleClear = async () => {
    await window.kt.logs.clear();
    setLogs([]);
  };

  const visible = filter === "all" ? logs : logs.filter((entry) => entry.level === filter);

  const levelClass = (level: string) => {
    if (level === "error") return "text-red-400";
    if (level === "warn")  return "text-amber-400";
    return "text-gray-400";
  };

  const levelBg = (level: string) => {
    if (level === "error") return "bg-red-500/10";
    if (level === "warn")  return "bg-amber-500/10";
    return "";
  };

  return (
    <div className="h-full flex flex-col p-6 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <div>
          <h1 className="text-lg font-semibold text-white">{l.title}</h1>
          <p className="text-xs text-gray-500 mt-0.5">{t(l.subtitle, { n: logs.length })}</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Filter */}
          <div className="flex rounded-lg overflow-hidden border border-surface-600 text-xs">
            {(["all", "warn", "error"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1.5 font-medium transition-colors ${
                  filter === f ? "bg-surface-600 text-white" : "bg-surface-800 text-gray-500 hover:text-gray-300"
                }`}
              >
                {f === "all" ? l.filterAll : f === "warn" ? l.filterWarn : l.filterError}
              </button>
            ))}
          </div>
          <button onClick={load} title="Refresh" className="p-1.5 rounded-lg bg-surface-700 hover:bg-surface-600 text-gray-400 hover:text-white transition-colors">
            <RefreshCw size={14} />
          </button>
          <button onClick={handleClear} title={l.clear} className="p-1.5 rounded-lg bg-surface-700 hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Log list */}
      <div className="flex-1 overflow-y-auto rounded-lg border border-surface-600 bg-surface-900 font-mono text-xs">
        {visible.length === 0 ? (
          <div className="h-full flex items-center justify-center text-gray-600">{l.empty}</div>
        ) : (
          visible.map((entry, i) => (
            <div key={i} className={`flex gap-3 px-3 py-1 border-b border-surface-700/50 last:border-0 ${levelBg(entry.level)}`}>
              <span className="text-gray-600 shrink-0 w-20 tabular-nums">
                {new Date(entry.ts).toLocaleTimeString(locale)}
              </span>
              <span className={`shrink-0 w-10 font-semibold uppercase ${levelClass(entry.level)}`}>
                {entry.level === "info" ? "INF" : entry.level === "warn" ? "WRN" : "ERR"}
              </span>
              <span className="text-gray-300 break-all whitespace-pre-wrap">{entry.msg}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

import { useState, useEffect } from "react";
import { RefreshCw, Upload, Settings, CheckCircle, Clock, XCircle, TrendingUp, Download, Users } from "lucide-react";
import RunCard from "../components/RunCard";
import type { RunSummary, SyncState } from "../types";
import { useLocale, t } from "../i18n";

interface Props {
  runs: RunSummary[];
  sync: SyncState;
  configured: boolean;
  uploaded: number;
  pending: number;
  onSync: () => void;
  onDownloadBenchmarks: () => void;
  onGoSettings: () => void;
  appVersion?: string;
  updaterStatus?: { status: string; version?: string };
}

function fmtRelative(iso: string, locale: string): string {
  if (!iso) return "";
  const diff  = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  const rtf   = new Intl.RelativeTimeFormat(locale, { numeric: "auto", style: "short" });
  if (mins  < 1)  return rtf.format(0, "second");
  if (mins  < 60) return rtf.format(-mins, "minute");
  if (hours < 24) return rtf.format(-hours, "hour");
  return rtf.format(-days, "day");
}

export default function Dashboard({ runs, sync, configured, uploaded, pending, onSync, onDownloadBenchmarks, onGoSettings, appVersion, updaterStatus }: Props) {
  const { m, locale } = useLocale();
  const d = m.dashboard;

  const failed        = runs.filter((r) => r.syncStatus === "failed").length;
  const isDownloading = sync.status === "downloading";
  const isSyncing     = sync.status === "uploading" || sync.status === "detecting" || isDownloading;

  const [benchInfo, setBenchInfo] = useState<{ count: number; lastUpdated: string } | null>(null);

  useEffect(() => {
    window.kt.benchmarks.info().then((info) => {
      const i = info as { count: number; lastUpdated: string };
      if (i.count > 0) setBenchInfo(i);
    });
    const off = window.kt.on("benchmarks:info", (data) => {
      const i = data as { count: number; lastUpdated: string };
      if (i.count > 0) setBenchInfo(i);
    });
    return off;
  }, []);

  const recentRuns = runs.slice(0, 12);
  const avgKs = runs.length > 0
    ? Math.round(runs.reduce((s, r) => s + r.keystoneLevel, 0) / runs.length)
    : 0;
  const inTimePct = runs.length > 0
    ? Math.round(runs.filter((r) => r.inTime).length / runs.length * 100)
    : 0;

  if (!configured) {
    return (
      <div className="h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 rounded-2xl bg-accent-purple/20 border border-accent-purple/30 flex items-center justify-center mx-auto mb-4">
            <Settings size={28} className="text-accent-purple" />
          </div>
          <h2 className="text-xl font-semibold text-white mb-2">{d.setupTitle}</h2>
          <p className="text-gray-500 text-sm mb-6">{d.setupDesc}</p>
          <button onClick={onGoSettings} className="btn-primary">{d.setupBtn}</button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-white">{d.title}</h1>
            {appVersion && (
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${
                updaterStatus?.status === "available" || updaterStatus?.status === "ready" || updaterStatus?.status === "downloading"
                  ? "text-amber-400 border-amber-400/40 bg-amber-400/10"
                  : "text-gray-600 border-surface-600 bg-surface-800"
              }`}>
                v{appVersion}
                {(updaterStatus?.status === "available" || updaterStatus?.status === "ready") && updaterStatus.version
                  ? ` → v${updaterStatus.version}`
                  : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-500 mt-0.5">{d.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex flex-col items-end gap-0.5">
            <button
              onClick={onDownloadBenchmarks}
              disabled={isSyncing}
              title={d.benchmarks}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-500 bg-surface-800 hover:bg-surface-700 hover:border-surface-400 text-gray-300 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={13} />
              {d.benchmarks}
            </button>
            {benchInfo && (
              <div className="flex items-center gap-1 text-[10px] text-gray-600">
                <Users size={9} />
                <span>{t(d.profiles, { n: benchInfo.count.toLocaleString(locale) })}</span>
                {benchInfo.lastUpdated && (
                  <span>· {fmtRelative(benchInfo.lastUpdated, locale)}</span>
                )}
              </div>
            )}
          </div>
          <button onClick={onSync} disabled={isSyncing} className="btn-primary flex items-center gap-2">
            <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
            {isSyncing ? d.syncing : d.sync}
          </button>
        </div>
      </div>

      {/* Sync status banner */}
      {sync.message && (
        <div className={`px-4 py-3 rounded-lg border text-sm ${
          sync.status === "error"
            ? "bg-red-500/10 border-red-500/40 text-red-400"
            : isDownloading
            ? "bg-accent-blue/10 border-accent-blue/30 text-accent-blue"
            : sync.status === "uploading" || sync.status === "detecting"
              ? "bg-accent-purple/10 border-accent-purple/30 text-accent-purple"
              : "bg-surface-700 border-surface-500 text-gray-400"
        }`}>
          <div className="flex items-center gap-3">
            {isDownloading
              ? <Download size={14} className="animate-bounce shrink-0" />
              : isSyncing && <RefreshCw size={14} className="animate-spin shrink-0" />}
            <span className="flex-1">{sync.message}</span>
            {isDownloading && sync.pct != null && (
              <span className="text-xs font-mono font-semibold shrink-0">{sync.pct}%</span>
            )}
          </div>
          {/* Progress bar — shown during benchmark download */}
          {isDownloading && (
            <div className="mt-2 h-1.5 rounded-full bg-accent-blue/20 overflow-hidden">
              {sync.pct != null ? (
                <div
                  className="h-full bg-accent-blue rounded-full transition-all duration-300"
                  style={{ width: `${sync.pct}%` }}
                />
              ) : (
                <div className="h-full w-1/3 bg-accent-blue rounded-full animate-[slide_1.2s_ease-in-out_infinite]" />
              )}
            </div>
          )}
        </div>
      )}

      {/* Stats cards */}
      <div className="grid grid-cols-4 gap-3">
        <StatCard icon={<Upload size={18} className="text-trust-certified" />}
          value={String(uploaded)} label={d.uploaded} color="text-trust-certified" />
        <StatCard icon={<Clock size={18} className="text-accent-gold" />}
          value={String(pending)} label={d.pending} color="text-accent-gold" />
        <StatCard icon={<XCircle size={18} className="text-trust-danger" />}
          value={String(failed)} label={d.failed} color="text-trust-danger" />
        <StatCard icon={<TrendingUp size={18} className="text-accent-blue" />}
          value={runs.length > 0 ? `+${avgKs} · ${inTimePct}%` : "—"}
          label={d.avgKey} color="text-accent-blue" />
      </div>

      {/* Pending runs */}
      {pending > 0 && (
        <div>
          <SectionHeader title={d.pendingSection} count={pending} />
          <div className="grid grid-cols-2 gap-3">
            {runs.filter((r) => r.syncStatus === "pending").slice(0, 4).map((r) => (
              <RunCard key={r.id} run={r} />
            ))}
          </div>
          {pending > 4 && (
            <p className="text-xs text-gray-600 text-center mt-2">{t(d.more, { n: pending - 4 })}</p>
          )}
        </div>
      )}

      {/* Recent runs */}
      {recentRuns.length > 0 && (
        <div>
          <SectionHeader title={d.recentSection} count={recentRuns.length} />
          <div className="grid grid-cols-2 gap-3">
            {recentRuns.map((r) => <RunCard key={r.id} run={r} />)}
          </div>
        </div>
      )}

      {runs.length === 0 && (
        <div className="text-center py-16">
          <CheckCircle size={32} className="text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">{d.noRuns}</p>
          <p className="text-gray-600 text-xs mt-1">{d.noRunsHint}</p>
        </div>
      )}
    </div>
  );
}

function StatCard({ icon, value, label, color }: { icon: React.ReactNode; value: string; label: string; color: string }) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className="p-2 bg-surface-700 rounded-lg">{icon}</div>
      <div>
        <div className={`text-lg font-bold font-mono ${color}`}>{value}</div>
        <div className="text-[11px] text-gray-500">{label}</div>
      </div>
    </div>
  );
}

function SectionHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <h2 className="text-sm font-semibold text-gray-300">{title}</h2>
      <span className="text-xs text-gray-600 bg-surface-700 px-2 py-0.5 rounded-full">{count}</span>
    </div>
  );
}

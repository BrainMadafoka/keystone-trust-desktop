import { LayoutDashboard, History, Settings, RefreshCw, Wifi, WifiOff, Clock, User, Download, CheckCircle, AlertCircle, ScrollText, FolderUp } from "lucide-react";
import type { SyncState } from "../types";
import { useLocale, t } from "../i18n";

interface UpdaterStatus { status: string; version?: string; pct?: number; message?: string; }

interface Props {
  page: string;
  setPage: (p: "dashboard" | "history" | "import" | "settings" | "logs") => void;
  sync: SyncState;
  apiOk: boolean | null;
  battletag: string;
  pendingCount: number;
  onSync: () => void;
  updaterStatus: UpdaterStatus;
  onCheckUpdate: () => void;
}

function UpdaterLabel({ s, u }: { s: UpdaterStatus; u: ReturnType<typeof useLocale>["m"]["updater"] }) {
  if (s.status === "checking")    return <><RefreshCw size={10} className="animate-spin shrink-0" /><span>{u.checking}</span></>;
  if (s.status === "available")   return <><Download size={10} className="text-accent-blue shrink-0" /><span className="text-accent-blue">{t(u.available, { v: s.version ?? "" })}</span></>;
  if (s.status === "downloading") return <><Download size={10} className="animate-bounce shrink-0" /><span>{t(u.downloading, { pct: String(s.pct ?? 0) })}</span></>;
  if (s.status === "ready")       return <><CheckCircle size={10} className="text-trust-certified shrink-0" /><span className="text-trust-certified">{u.ready}</span></>;
  if (s.status === "current")     return <><CheckCircle size={10} className="text-gray-500 shrink-0" /><span>{u.current}</span></>;
  if (s.status === "error")       return <><AlertCircle size={10} className="text-trust-danger shrink-0" /><span className="text-trust-danger">{u.error}</span></>;
  return <><Download size={10} className="shrink-0" /><span>{u.check}</span></>;
}

export default function Sidebar({ page, setPage, sync, apiOk, battletag, pendingCount, onSync, updaterStatus, onCheckUpdate }: Props) {
  const { m } = useLocale();
  const isSyncing = sync.status === "uploading" || sync.status === "detecting";

  const navItems = [
    { id: "dashboard", label: m.nav.dashboard, icon: LayoutDashboard },
    { id: "history",   label: m.nav.history,   icon: History },
    { id: "import",    label: m.nav.import,     icon: FolderUp },
    { id: "logs",      label: m.nav.logs,       icon: ScrollText },
    { id: "settings",  label: m.nav.settings,   icon: Settings },
  ] as const;

  return (
    <aside className="w-56 flex-shrink-0 flex flex-col bg-surface-800 border-r border-surface-600">
      <div className="drag-region px-4 py-4 border-b border-surface-600">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="no-drag w-7 h-7 rounded-lg bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center text-white text-xs font-bold shadow-glow-purple">
            KT
          </div>
          <div>
            <div className="text-sm font-semibold text-white leading-tight">Keystone Trust</div>
            <div className="text-[10px] text-gray-500">{m.sidebar.syncClient}</div>
          </div>
        </div>
        {battletag && (
          <div className="no-drag flex items-center gap-2 px-2 py-1.5 rounded-md bg-surface-700">
            <div className="w-5 h-5 rounded-full bg-accent-purple/30 flex items-center justify-center">
              <User size={11} className="text-accent-purple" />
            </div>
            <span className="text-[11px] text-gray-300 truncate font-medium">{battletag}</span>
          </div>
        )}
      </div>

      <nav className="flex-1 p-2 space-y-0.5">
        {navItems.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setPage(id)}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              page === id ? "bg-accent-purple/20 text-accent-purple" : "text-gray-400 hover:text-white hover:bg-surface-700"
            }`}
          >
            <Icon size={16} />
            <span>{label}</span>
            {id === "dashboard" && pendingCount > 0 && (
              <span className="ml-auto bg-accent-purple text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="p-3 border-t border-surface-600 space-y-2">
        <button onClick={onSync} disabled={isSyncing} className="w-full btn-primary flex items-center justify-center gap-2">
          <RefreshCw size={14} className={isSyncing ? "animate-spin" : ""} />
          {isSyncing ? m.sidebar.syncing : m.sidebar.sync}
        </button>

        <div className="flex items-center gap-2 px-1">
          {apiOk === null
            ? <div className="w-2 h-2 rounded-full bg-gray-600 animate-pulse-dot" />
            : apiOk ? <Wifi size={12} className="text-trust-certified" /> : <WifiOff size={12} className="text-trust-danger" />}
          <span className="text-[11px] text-gray-500 truncate">
            {apiOk === null ? m.sidebar.checking : apiOk ? m.sidebar.connected : m.sidebar.offline}
          </span>
        </div>

        {sync.message && (
          <div className="flex items-center gap-1.5 px-1">
            <Clock size={10} className="text-gray-600 shrink-0" />
            <span className="text-[10px] text-gray-600 truncate">{sync.message}</span>
          </div>
        )}

        <button
          onClick={onCheckUpdate}
          disabled={["checking", "downloading", "ready"].includes(updaterStatus.status)}
          className="w-full flex items-center gap-1.5 px-1 text-[10px] text-gray-600 hover:text-gray-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <UpdaterLabel s={updaterStatus} u={m.updater} />
        </button>
      </div>
    </aside>
  );
}

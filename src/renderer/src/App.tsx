import { useState, useEffect, useCallback } from "react";
import { LocaleProvider, useLocale } from "./i18n";
import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import History from "./pages/History";
import Import from "./pages/Import";
import Login from "./pages/Login";
import Settings from "./pages/Settings";
import Logs from "./pages/Logs";
import type { RunSummary, Settings as SettingsType, SyncState } from "./types";

type Page = "dashboard" | "history" | "import" | "settings" | "logs";

function UpdateBanner({ onInstall }: { onInstall: () => void }) {
  const { m } = useLocale();
  return (
    <div className="absolute bottom-0 left-0 right-0 z-50 flex items-center justify-between gap-4 px-4 py-2.5 bg-surface-800 border-t border-accent-blue/40 text-white text-sm">
      <span className="text-xs text-gray-300">{m.updater.banner}</span>
      <button onClick={onInstall} className="no-drag shrink-0 px-3 py-1.5 rounded-lg bg-accent-blue hover:bg-blue-500 transition-colors text-xs font-semibold">
        {m.updater.install}
      </button>
    </div>
  );
}

export default function App() {
  const [page, setPage]               = useState<Page>("dashboard");
  const [runs, setRuns]               = useState<RunSummary[]>([]); // used for dashboard stats only
  const [settings, setSettingsState]  = useState<SettingsType | null>(null);
  const [sync, setSync]               = useState<SyncState>({ status: "idle", message: "" });
  const [apiOk, setApiOk]             = useState<boolean | null>(null);
  const [configured, setConfigured]   = useState(false);
  const [apiKey, setApiKey]           = useState<string | null>(null); // null = not yet loaded
  const [updateReady, setUpdateReady] = useState(false);
  const [updaterStatus, setUpdaterStatus] = useState<{ status: string; version?: string; pct?: number; message?: string }>({ status: "idle" });
  const [appVersion, setAppVersion]   = useState<string>("");

  const loadRuns = useCallback(async () => {
    const list = await window.kt.runs.list();
    setRuns(list as RunSummary[]);
  }, []);

  const loadSettings = useCallback(async () => {
    const s = await window.kt.settings.get() as SettingsType;
    setSettingsState(s);
    setApiKey(s.apiKey ?? "");
    setConfigured(!!(s.wowPath && s.accountName));
  }, []);

  const checkApi = useCallback(async () => {
    const result = await window.kt.api.test();
    setApiOk((result as { ok: boolean }).ok);
  }, []);

  useEffect(() => {
    window.kt.app.version().then((v) => setAppVersion(v as string));
  }, []);

  useEffect(() => {
    loadSettings();
    loadRuns();
    checkApi();

    const off1 = window.kt.on("sync:status", (data) => {
      const d = data as { status: string; message: string; pct?: number };
      setSync({ status: d.status as SyncState["status"], message: d.message, pct: d.pct });
    });
    const off2 = window.kt.on("runs:refresh", (list) => setRuns(list as RunSummary[]));
    const off3 = window.kt.on("run:status",   () => loadRuns());

    const off5 = window.kt.on("updater:ready",  () => setUpdateReady(true));
    const off6 = window.kt.on("updater:status", (d) => {
      const data = d as { status: string; version?: string; pct?: number; message?: string };
      setUpdaterStatus(data);
      if (data.status === "ready") setUpdateReady(true);
    });

    // Deep link auth success — reload settings so apiKey becomes truthy
    const off4 = window.kt.on("auth:success", async () => {
      await loadSettings();
      await checkApi();
      await loadRuns();
      setPage("dashboard");
    });

    return () => { off1(); off2(); off3(); off4(); off5(); off6(); };
  }, [loadRuns, loadSettings, checkApi]);

  const handleSync = async () => {
    setSync({ status: "uploading", message: "Synchronisation…" });
    await window.kt.sync.trigger();
    await loadRuns();
  };

  const handleDownloadBenchmarks = async () => {
    setSync({ status: "downloading", message: "Téléchargement des benchmarks KT…" });
    await window.kt.benchmarks.download();
    setSync({ status: "idle", message: "" });
  };

  const handleSettingsSave = async (patch: Partial<SettingsType>) => {
    await window.kt.settings.set(patch as Record<string, unknown>);
    await loadSettings();
    await loadRuns();
    await checkApi();
  };

  const handleLogout = async () => {
    await window.kt.auth.logout();
    setApiKey("");
    setSettingsState(null);
    setApiOk(null);
  };

  const pending  = runs.filter((r) => r.syncStatus === "pending").length;
  const uploaded = runs.filter((r) => r.syncStatus === "uploaded").length;

  // Still loading initial settings — render nothing to avoid flash
  if (apiKey === null) return null;

  // Not authenticated → login screen
  if (!apiKey) {
    return (
      <LocaleProvider initialLocale={settings?.locale}>
        <Login apiUrl={settings?.apiUrl ?? "https://wowkeystonetrust.com"} />
      </LocaleProvider>
    );
  }

  return (
    <LocaleProvider initialLocale={settings?.locale}>
    <div className="flex h-screen w-screen overflow-hidden bg-surface-900">
      {updateReady && <UpdateBanner onInstall={() => window.kt.updater.install()} />}
      <Sidebar
        page={page}
        setPage={setPage}
        sync={sync}
        apiOk={apiOk}
        battletag={settings?.battletag ?? ""}
        pendingCount={pending}
        onSync={handleSync}
        updaterStatus={updaterStatus}
        onCheckUpdate={() => window.kt.updater.check()}
      />

      <main className="flex-1 overflow-y-auto">
        {page === "dashboard" && (
          <Dashboard
            runs={runs}
            sync={sync}
            configured={configured}
            uploaded={uploaded}
            pending={pending}
            onSync={handleSync}
            onDownloadBenchmarks={handleDownloadBenchmarks}
            onGoSettings={() => setPage("settings")}
            appVersion={appVersion}
            updaterStatus={updaterStatus}
          />
        )}
        {page === "history" && <History />}
        {page === "import"  && <Import />}
        {page === "logs"    && <Logs />}
        {page === "settings" && (
          <Settings
            settings={settings}
            apiOk={apiOk}
            onSave={handleSettingsSave}
            onCheckApi={checkApi}
            onLogout={handleLogout}
          />
        )}
      </main>
    </div>
    </LocaleProvider>
  );
}

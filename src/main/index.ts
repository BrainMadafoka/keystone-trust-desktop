import { app, BrowserWindow, ipcMain, dialog, shell, Tray, Menu, nativeImage } from "electron";
import { join } from "path";
import { createHmac } from "crypto";
import { is } from "@electron-toolkit/utils";
import { autoUpdater } from "electron-updater";
import { getSettings, setSettings, markUploaded, markFailed, getUploadedIds, getFailedIds, getUploadedRunsMeta, resetSyncQueue, getLastLogRunEndTimeMs, setLastLogRunEndTimeMs, setBenchmarkInfo, getBenchmarkInfo } from "./store";
import { detectWowPath, detectAccounts, startWatcher, stopWatcher, type AccountInfo } from "./watcher";
import { normalizeSpecName, normalizeDungeonName, specIdToClass, specIdToRole, CURRENT_SEASON_DUNGEONS, readPlayerFromSavedVars } from "./luaParser";
import { writeBenchmarkLua } from "./benchmarkWriter";
import { parseRunsFromLog, getCombatLogPath } from "./combatLogParser";
import type { LogRun } from "./combatLogParser";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

// ── Import cache (manual log file upload) ─────────────────────────────────────
// Stores parsed runs from the last browsed file so log:upload-imported can find them.
const importedRuns = new Map<string, LogRun>();

// ── In-memory log buffer ───────────────────────────────────────────────────────

interface LogEntry { ts: number; level: "info" | "warn" | "error"; msg: string; }
const appLogs: LogEntry[] = [];
const MAX_LOGS = 500;

function addLog(level: LogEntry["level"], msg: string) {
  appLogs.push({ ts: Date.now(), level, msg });
  if (appLogs.length > MAX_LOGS) appLogs.shift();
  emit("logs:new", appLogs[appLogs.length - 1]);
}

// Intercept console so every log/warn/error is captured automatically
const _log   = console.log.bind(console);
const _warn  = console.warn.bind(console);
const _error = console.error.bind(console);
console.log   = (...a) => { addLog("info",  a.map(String).join(" ")); _log(...a);   };
console.warn  = (...a) => { addLog("warn",  a.map(String).join(" ")); _warn(...a);  };
console.error = (...a) => { addLog("error", a.map(String).join(" ")); _error(...a); };

// ── Single instance + deep link (Windows) ─────────────────────────────────────

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv) => {
    const url = argv.find((a) => a.startsWith("kt://"));
    if (url) handleDeepLink(url);
    if (mainWindow) { mainWindow.show(); mainWindow.focus(); }
  });
}

app.setAsDefaultProtocolClient("kt");

function handleDeepLink(url: string) {
  try {
    const parsed    = new URL(url);
    if (parsed.host !== "auth") return;
    const key       = parsed.searchParams.get("key")  ?? "";
    const battletag = parsed.searchParams.get("name") ?? "";
    if (!key) return;
    setSettings({ apiKey: key, battletag });
    emit("auth:success", { battletag });
    setupAutoSync();
    triggerSync().catch(() => null);
    mainWindow?.show();
    mainWindow?.focus();
  } catch { /* malformed URL */ }
}

// ── Window ─────────────────────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 900,
    minHeight: 600,
    resizable: true,
    movable: true,
    backgroundColor: "#0a0b0f",
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#12141c", symbolColor: "#ffffff", height: 36 },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      sandbox: false,
    },
    show: false,
    icon: join(__dirname, "../../resources/icon.png"),
  });

  mainWindow.on("ready-to-show", () => mainWindow?.show());
  mainWindow.on("close", (e) => {
    if (tray) { e.preventDefault(); mainWindow?.hide(); }
  });

  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
    mainWindow.webContents.openDevTools({ mode: "detach" });
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// ── Tray ───────────────────────────────────────────────────────────────────────

function createTray() {
  const icon = nativeImage.createFromPath(join(__dirname, "../../resources/tray.png"))
    .resize({ width: 16, height: 16 });
  tray = new Tray(icon);
  tray.setToolTip("Keystone Trust");
  tray.on("click", () => { mainWindow?.show(); mainWindow?.focus(); });
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "Ouvrir Keystone Trust", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { label: "Sync maintenant",        click: () => triggerSync() },
    { type: "separator" },
    { label: "Quitter", click: () => { tray = null; app.quit(); } },
  ]));
}

// ── Run ID ─────────────────────────────────────────────────────────────────────
// Stable ID derived from immutable run facts: no UUIDs, no external dependencies.

function makeRunId(run: LogRun): string {
  return `${run.mapId}_${run.keystoneLevel}_${run.endTime.getTime()}`;
}

// ── Upload ─────────────────────────────────────────────────────────────────────

async function uploadLogRun(run: LogRun): Promise<{ ok: boolean; error?: string }> {
  const { apiKey, apiUrl, wowPath, accountName } = getSettings();
  if (!apiKey) return { ok: false, error: "No API key" };
  try {
    const dungeonName = normalizeDungeonName(run.dungeonName, run.mapId);

    // Auto-detect the main player from SavedVariables (most recent run's playerName+realm).
    const playerInfo = (wowPath && accountName)
      ? readPlayerFromSavedVars(wowPath, accountName)
      : null;
    const mainKey = playerInfo
      ? `${playerInfo.playerName}-${playerInfo.realm}`.toLowerCase()
      : null;

    let mainGuid: string | null = null;
    for (const [guid, info] of run.combatants) {
      if (mainKey && info.nameRealm.toLowerCase() === mainKey) {
        mainGuid = guid;
        break;
      }
    }
    if (!mainGuid && run.combatants.size > 0) {
      mainGuid = [...run.combatants.keys()][0];
    }

    const mainInfo    = mainGuid ? run.combatants.get(mainGuid) : null;
    const nameParts   = (mainInfo?.nameRealm ?? "").split("-");
    const playerName  = nameParts[0]                  || characterName  || "";
    const realm       = nameParts.slice(1).join("-")  || characterRealm || "";
    const region      = playerInfo?.region || "eu";
    const wowClass    = mainInfo ? specIdToClass(mainInfo.specId)    : "";
    const spec        = mainInfo ? normalizeSpecName("", mainInfo.specId) : "";
    const role        = mainInfo ? specIdToRole(mainInfo.specId)     : "DPS";

    const playerData = [...run.combatants.entries()].map(([guid, info]) => {
      const stats  = run.stats.get(guid);
      const parts  = info.nameRealm.split("-");
      return {
        name:  parts[0]               ?? "",
        realm: parts.slice(1).join("-") ?? "",
        guid,
        // specId is uploaded so the SITE can map class/spec server-side (new specs need no client release).
        specId: info.specId,
        class: specIdToClass(info.specId),
        spec:  normalizeSpecName("", info.specId),
        role:  specIdToRole(info.specId),
        ilvl:  0,
        damageDone:           stats?.damageDone           ?? 0,
        healingDone:          stats?.healingDone           ?? 0,
        damageTaken:          stats?.damageTaken           ?? 0,
        avoidableDamageTaken: stats?.avoidableDamageTaken  ?? 0,
        effectiveHealing:     stats?.healingEffective      ?? 0,
        overhealingDone:      stats ? (stats.healingDone - stats.healingEffective) : 0,
        absorbs:              stats?.absorbs               ?? 0,
        // Damage taken per enemy spell (top 40 by total) → server sums avoidable via curated list.
        damageTakenBySpell:   stats
          ? [...stats.damageTakenBySpell.entries()]
              .map(([spellId, v]) => ({ spellId, name: v.name, total: v.total }))
              .sort((a, b) => b.total - a.total)
              .slice(0, 40)
          : [],
        interrupts:    Array.from({ length: stats?.interruptCount ?? 0 }, () => ({ ts: 0, spellId: 0 })),
        dispels:       Array.from({ length: stats?.dispelCount    ?? 0 }, () => ({ ts: 0, spellId: 0 })),
        deaths:        Array.from({ length: stats?.deathCount     ?? 0 }, () => ({ ts: 0 })),
        crowdControls:  [],
        defensives:     [],
        offHeals:       [],
        damageBySpell:  [],
        healingBySpell: [],
        cooldownUsage:  {},
      };
    });

    const payload = {
      // Real client version (CI sets package.json from the git tag → app.getVersion()
      // returns e.g. "1.2.41"). Stored on AddonRun.addonVersion so we can tell which
      // parser produced a run — legacy buggy uploads carry the old literal "log".
      addonVersion:  app.getVersion(),
      playerName:    playerName  || "Unknown",
      realm:         realm       || "Unknown",
      region,
      wowClass:      wowClass    || "UNKNOWN",
      spec:          spec        || wowClass || "Unknown",
      role,
      dungeonId:     run.mapId,
      dungeonName,
      keystoneLevel: run.keystoneLevel,
      affixes:       run.affixIds.map(String),   // server expects string[]
      completed:     run.completed,
      inTime:        run.inTime,
      durationSecs:  run.durationSecs,
      combatTimeSecs: run.combatTimeSecs,
      runDate:       run.endTime.toISOString(),
      party:         playerData,
    };

    const bodyString = JSON.stringify(payload);
    const sig = createHmac("sha256", apiKey).update(bodyString).digest("hex");

    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 30_000);
    const res = await fetch(`${apiUrl}/api/addon/run-complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-kt-api-key": apiKey,
        "x-kt-sig":     sig,
      },
      body: bodyString,
      signal: abort.signal,
    }).finally(() => clearTimeout(timer));

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      return { ok: false, error: text };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Benchmark download ─────────────────────────────────────────────────────────

async function downloadBenchmarks(wowPath: string, accountName: string): Promise<void> {
  const { apiKey, apiUrl } = getSettings();
  if (!apiKey) return;

  try {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 120_000);

    emit("sync:status", { status: "downloading", message: "Téléchargement des benchmarks…", pct: 0 });

    const res = await fetch(`${apiUrl}/api/addon/all-benchmarks`, {
      method: "GET",
      headers: { "x-kt-api-key": apiKey },
      signal: abort.signal,
    });
    clearTimeout(timer);

    if (!res.ok || !res.body) return;

    // Stream the response body so we can report real download progress
    const contentLength = parseInt(res.headers.get("content-length") ?? "0") || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.length;
      const pct = contentLength > 0 ? Math.min(99, Math.round(received / contentLength * 100)) : -1;
      emit("sync:status", {
        status: "downloading",
        message: contentLength > 0
          ? `Benchmarks : ${Math.round(received / 1024)} KB / ${Math.round(contentLength / 1024)} KB`
          : `Benchmarks : ${Math.round(received / 1024)} KB reçus…`,
        pct: pct >= 0 ? pct : undefined,
      });
    }

    const text = new TextDecoder().decode(
      chunks.reduce((acc, c) => { const r = new Uint8Array(acc.length + c.length); r.set(acc); r.set(c, acc.length); return r; }, new Uint8Array(0))
    );
    const data = JSON.parse(text) as { benchmarks: Record<string, unknown>; aliases?: Record<string, string> };
    if (!data.benchmarks || !Object.keys(data.benchmarks).length) {
      emit("sync:status", { status: "idle", message: "" });
      return;
    }

    emit("sync:status", { status: "downloading", message: "Écriture du fichier addon…", pct: 99 });
    writeBenchmarkLua(wowPath, accountName, data.benchmarks as Parameters<typeof writeBenchmarkLua>[2], data.aliases ?? {});
    const count = Object.keys(data.benchmarks).length;
    setBenchmarkInfo(count);
    emit("benchmarks:info", getBenchmarkInfo());
    emit("sync:status", { status: "idle", message: `${count} profil(s) mis à jour — /reload en jeu pour voir les données` });
  } catch { emit("sync:status", { status: "idle", message: "" }); }
}

// ── Run list builder ───────────────────────────────────────────────────────────

function buildRunListFromLog(logRuns: LogRun[]) {
  const uploadedIds = new Set(getUploadedIds());
  const failedIds   = new Set(getFailedIds());
  return logRuns
    .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())
    .slice(0, 50)
    .map((r) => {
      const id = makeRunId(r);
      return {
        id,
        dungeonName:   r.dungeonName,
        keystoneLevel: r.keystoneLevel,
        durationSecs:  r.durationSecs,
        completed:     r.completed,
        inTime:        r.inTime,
        runDate:       r.endTime.toISOString(),
        affixes:       r.affixIds,
        playerCount:   r.combatants.size,
        syncStatus:    uploadedIds.has(id) ? "uploaded" : failedIds.has(id) ? "failed" : "pending",
      };
    });
}

// ── Sync ───────────────────────────────────────────────────────────────────────

async function triggerSync(): Promise<{ uploaded: number; failed: number; skipped: number }> {
  const { wowPath, apiKey } = getSettings();
  if (!apiKey) {
    emit("sync:status", { status: "error", message: "Clé API manquante — renseignez votre clé dans Paramètres." });
    return { uploaded: 0, failed: 0, skipped: 0 };
  }
  if (!wowPath) return { uploaded: 0, failed: 0, skipped: 0 };

  emit("sync:status", { status: "uploading", message: "Lecture du combat log…" });

  const logPath = getCombatLogPath(wowPath);
  const afterMs = getLastLogRunEndTimeMs();

  // Fast scan: only parse runs that may be newer than our last upload watermark.
  const newRuns = await parseRunsFromLog(logPath, afterMs);

  const uploadedIds = new Set(getUploadedIds());
  const pending = newRuns.filter((r) => {
    if (uploadedIds.has(makeRunId(r))) return false;
    return CURRENT_SEASON_DUNGEONS.has(normalizeDungeonName(r.dungeonName, r.mapId));
  });
  const skipped = newRuns.length - pending.length;

  let uploaded = 0, failed = 0;
  let authError = false;
  let maxEndTimeMs = afterMs;
  for (const run of pending) {
    const runId = makeRunId(run);
    emit("sync:status", { status: "uploading", message: `Upload de ${run.dungeonName} +${run.keystoneLevel}…` });
    const result = await uploadLogRun(run);
    if (result.ok) {
      markUploaded(runId, {
        dungeonName:   normalizeDungeonName(run.dungeonName, run.mapId),
        keystoneLevel: run.keystoneLevel,
        durationSecs:  run.durationSecs,
        completed:     run.completed,
        inTime:        run.inTime,
        runDate:       run.endTime.toISOString(),
        affixes:       run.affixIds,
        playerCount:   run.combatants.size,
      });
      uploaded++;
      if (run.endTime.getTime() > maxEndTimeMs) maxEndTimeMs = run.endTime.getTime();
    } else {
      markFailed(runId);
      failed++;
      if (result.error?.includes("401") || result.error?.includes("Unauthorized")) authError = true;
    }
    emit("run:status", { runId, ok: result.ok, error: result.error });
  }

  if (authError) {
    emit("sync:status", { status: "error", message: "Clé API invalide ou révoquée — vérifiez vos Paramètres." });
    return { uploaded, failed, skipped };
  }

  if (maxEndTimeMs > afterMs) setLastLogRunEndTimeMs(maxEndTimeMs);

  const statusMsg = uploaded > 0
    ? `${uploaded} run(s) uploadé(s)`
    : failed > 0
    ? `${failed} run(s) échoué(s)`
    : newRuns.length > 0
    ? "Tous les runs sont déjà synchronisés"
    : "Aucun run trouvé dans le combat log";

  emit("sync:status", { status: "idle", message: statusMsg });
  // Full scan for UI so the run list always shows complete history.
  const allRuns = afterMs > 0 ? await parseRunsFromLog(logPath) : newRuns;
  emit("runs:refresh", buildRunListFromLog(allRuns));

  // Benchmark download is now manual-only (via benchmarks:download IPC)
  // or via daily addon release. Not triggered automatically here.

  return { uploaded, failed, skipped };
}

function emit(channel: string, data: unknown) {
  mainWindow?.webContents.send(channel, data);
}

// ── Auto-sync ──────────────────────────────────────────────────────────────────

function setupAutoSync() {
  const { wowPath, autoSync } = getSettings();
  if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
  stopWatcher();
  if (!wowPath || !autoSync) return;

  // Watch the combat log file — it's written in real-time (no /reload needed)
  const logPath = getCombatLogPath(wowPath);
  startWatcher(logPath, () => {
    emit("sync:status", { status: "detecting", message: "Nouveau run détecté…" });
    setTimeout(() => triggerSync(), 2000);
  });

  autoSyncTimer = setInterval(() => triggerSync(), 5 * 60 * 1000);
}

// ── IPC handlers ───────────────────────────────────────────────────────────────

ipcMain.handle("settings:get", () => getSettings());

ipcMain.handle("settings:set", (_e, patch) => {
  setSettings(patch);
  setupAutoSync();
  return true;
});

ipcMain.handle("auth:logout", () => {
  setSettings({ apiKey: "", battletag: "" });
  stopWatcher();
  if (autoSyncTimer) { clearInterval(autoSyncTimer); autoSyncTimer = null; }
  return true;
});

ipcMain.handle("wow:detect",   ()                     => ({ path: detectWowPath() }));
ipcMain.handle("wow:accounts", (_e, wowPath: string)  => detectAccounts(wowPath));
ipcMain.handle("wow:browse",   async () => {
  const result = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("runs:list", async () => {
  const { wowPath } = getSettings();
  if (!wowPath) return [];
  const logPath = getCombatLogPath(wowPath);
  const logRuns = await parseRunsFromLog(logPath);
  return buildRunListFromLog(logRuns);
});

ipcMain.handle("sync:trigger", () => triggerSync());

ipcMain.handle("benchmarks:download", async () => {
  const { wowPath, accountName } = getSettings();
  if (!wowPath || !accountName) return { ok: false, error: "WoW path ou account name manquant." };
  await downloadBenchmarks(wowPath, accountName);
  return { ok: true };
});

ipcMain.handle("api:test", async () => {
  const { apiKey, apiUrl } = getSettings();
  if (!apiKey) return { ok: false };
  try {
    // Lightweight ping (API-key auth). The old snapshot endpoint rebuilt the entire
    // benchmark dataset for all 50k+ players on every call → timed out → false offline.
    const res = await fetch(`${apiUrl}/api/addon/ping`, {
      headers: { "x-kt-api-key": apiKey },
    });
    return { ok: res.ok };
  } catch { return { ok: false }; }
});

ipcMain.handle("sync:reset", async () => {
  resetSyncQueue();
  const { wowPath } = getSettings();
  if (!wowPath) return true;
  const logPath = getCombatLogPath(wowPath);
  const logRuns = await parseRunsFromLog(logPath);
  emit("runs:refresh", buildRunListFromLog(logRuns));
  return true;
});

ipcMain.handle("shell:open", (_e, url: string) => shell.openExternal(url));

// ── History (persistent uploaded runs) ────────────────────────────────────────

ipcMain.handle("history:list",      () => getUploadedRunsMeta());
ipcMain.handle("benchmarks:info",   () => getBenchmarkInfo());

// ── Manual log file import ────────────────────────────────────────────────────

ipcMain.handle("log:browse-file", async () => {
  const result = await dialog.showOpenDialog({
    title: "Sélectionner un fichier de combat log",
    filters: [{ name: "Combat Log", extensions: ["txt"] }],
    properties: ["openFile"],
  });
  return result.canceled ? null : result.filePaths[0];
});

ipcMain.handle("log:import-file", async (_e, filePath: string) => {
  if (!filePath) return [];
  try {
    const runs = await parseRunsFromLog(filePath);
    importedRuns.clear();
    const uploadedIds = new Set(getUploadedIds());
    const failedIds   = new Set(getFailedIds());
    return runs
      .sort((a, b) => b.endTime.getTime() - a.endTime.getTime())
      .map((r) => {
        const id = makeRunId(r);
        importedRuns.set(id, r);
        return {
          id,
          dungeonName:   r.dungeonName,
          keystoneLevel: r.keystoneLevel,
          durationSecs:  r.durationSecs,
          completed:     r.completed,
          inTime:        r.inTime,
          runDate:       r.endTime.toISOString(),
          affixes:       r.affixIds,
          playerCount:   r.combatants.size,
          syncStatus:    uploadedIds.has(id) ? "uploaded" : failedIds.has(id) ? "failed" : "pending",
        };
      });
  } catch (err) {
    console.error("log:import-file error:", err);
    return [];
  }
});

ipcMain.handle("log:upload-imported", async (_e, runId: string) => {
  const run = importedRuns.get(runId);
  if (!run) return { ok: false, error: "Run introuvable en cache — réanalyse le fichier." };
  const result = await uploadLogRun(run);
  if (result.ok) {
    markUploaded(runId, {
      dungeonName:   normalizeDungeonName(run.dungeonName, run.mapId),
      keystoneLevel: run.keystoneLevel,
      durationSecs:  run.durationSecs,
      completed:     run.completed,
      inTime:        run.inTime,
      runDate:       run.endTime.toISOString(),
      affixes:       run.affixIds,
      playerCount:   run.combatants.size,
    });
  } else {
    markFailed(runId);
  }
  return result;
});

// ── App lifecycle ──────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  const startUrl = process.argv.find((a) => a.startsWith("kt://"));
  if (startUrl) handleDeepLink(startUrl);

  createWindow();
  createTray();
  setupAutoSync();

  if (getSettings().apiKey) {
    triggerSync().catch(() => null);
  }

  if (!is.dev) {
    autoUpdater.autoDownload        = true;
    autoUpdater.autoInstallOnAppQuit = false;

    autoUpdater.on("checking-for-update",  () => emit("updater:status", { status: "checking" }));
    autoUpdater.on("update-available",     (i) => emit("updater:status", { status: "available", version: i.version }));
    autoUpdater.on("update-not-available", () => emit("updater:status", { status: "current" }));
    autoUpdater.on("download-progress",    (p) => emit("updater:status", { status: "downloading", pct: Math.round(p.percent) }));
    autoUpdater.on("update-downloaded",    (i) => {
      emit("updater:status", { status: "ready", version: i.version });
      emit("updater:ready", null);
    });
    autoUpdater.on("error", (err) => emit("updater:status", { status: "error", message: err.message }));

    autoUpdater.checkForUpdates().catch(() => null);
    setInterval(() => autoUpdater.checkForUpdates().catch(() => null), 60 * 60 * 1000);
  }

  // Force-destroy all windows before quitAndInstall so the process exits immediately.
  // With oneClick:false, NSIS runs the old uninstaller which can't delete the exe if
  // the Electron process is still alive → error code 2. Destroying windows (not closing)
  // bypasses the beforeunload dialog and lets the OS reclaim the file handle instantly.
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("logs:get",   () => [...appLogs]);
  ipcMain.handle("logs:clear", () => { appLogs.length = 0; });

  ipcMain.handle("updater:install", () => {
    BrowserWindow.getAllWindows().forEach((w) => w.destroy());
    autoUpdater.quitAndInstall(true, true);
  });
  ipcMain.handle("updater:check",   () => { if (!is.dev) autoUpdater.checkForUpdates().catch(() => null); });
});

app.on("window-all-closed", (e: Event) => e.preventDefault());
app.on("activate", () => { if (!mainWindow?.isVisible()) mainWindow?.show(); });

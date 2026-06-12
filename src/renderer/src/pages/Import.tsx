import { useState } from "react";
import { FolderOpen, FileText, Upload, CheckCircle, XCircle, Clock, AlertCircle, RefreshCw } from "lucide-react";
import type { RunSummary } from "../types";
import { useLocale, t } from "../i18n";

type ImportRun = RunSummary & { uploading?: boolean };

function fmt(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(iso: string, locale: string) {
  return new Date(iso).toLocaleDateString(locale, { day: "2-digit", month: "short", year: "numeric" });
}

export default function Import() {
  const { m, locale } = useLocale();
  const imp = m.import;

  const [filePath,  setFilePath]  = useState("");
  const [parsing,   setParsing]   = useState(false);
  const [runs,      setRuns]      = useState<ImportRun[] | null>(null);
  const [parseErr,  setParseErr]  = useState("");
  const [uploading, setUploading] = useState(false);

  async function browse() {
    const path = await window.kt.log.browseFile() as string | null;
    if (path) { setFilePath(path); setRuns(null); setParseErr(""); }
  }

  async function analyse() {
    if (!filePath) return;
    setParsing(true);
    setParseErr("");
    setRuns(null);
    try {
      const list = await window.kt.log.importFile(filePath) as ImportRun[];
      if (list.length === 0) setParseErr(imp.noRuns);
      else setRuns(list);
    } catch {
      setParseErr(imp.readError);
    }
    setParsing(false);
  }

  async function uploadOne(runId: string) {
    setRuns((prev) => prev?.map((r) => r.id === runId ? { ...r, uploading: true } : r) ?? null);
    const res = await window.kt.log.uploadImported(runId) as { ok: boolean; error?: string };
    setRuns((prev) => prev?.map((r) =>
      r.id === runId ? { ...r, uploading: false, syncStatus: res.ok ? "uploaded" : "failed" } : r
    ) ?? null);
  }

  async function uploadAll() {
    if (!runs) return;
    const pending = runs.filter((r) => r.syncStatus === "pending");
    setUploading(true);
    for (const run of pending) await uploadOne(run.id);
    setUploading(false);
  }

  const pending  = runs?.filter((r) => r.syncStatus === "pending").length  ?? 0;
  const uploaded = runs?.filter((r) => r.syncStatus === "uploaded").length ?? 0;
  const failed   = runs?.filter((r) => r.syncStatus === "failed").length   ?? 0;

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">{imp.title}</h1>
        <p className="text-xs text-gray-500 mt-0.5">{imp.subtitle}</p>
      </div>

      {/* File picker */}
      <div className="card p-4 space-y-3">
        <p className="text-xs font-medium text-gray-400">{imp.fileLabel}</p>
        <div className="flex gap-2">
          <div className="flex-1 flex items-center gap-2 bg-surface-700 border border-surface-500 rounded-lg px-3 py-2">
            <FileText size={13} className="text-gray-500 shrink-0" />
            <input
              type="text"
              value={filePath}
              onChange={(e) => { setFilePath(e.target.value); setRuns(null); setParseErr(""); }}
              placeholder={imp.filePlaceholder}
              className="flex-1 bg-transparent text-xs text-white outline-none placeholder:text-gray-600 font-mono"
            />
          </div>
          <button
            onClick={browse}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-surface-500 bg-surface-700 hover:bg-surface-600 text-gray-300 text-xs font-medium transition-colors"
          >
            <FolderOpen size={13} />
            {imp.browse}
          </button>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <button
            onClick={analyse}
            disabled={!filePath || parsing}
            className="btn-primary flex items-center gap-1.5 text-sm"
          >
            {parsing
              ? <><RefreshCw size={13} className="animate-spin" />{imp.analysing}</>
              : <><FileText size={13} />{imp.analyse}</>}
          </button>
          {parseErr && (
            <div className="flex items-center gap-1.5 text-xs text-trust-danger">
              <AlertCircle size={12} />
              {parseErr}
            </div>
          )}
        </div>
      </div>

      {/* Results */}
      {runs && runs.length > 0 && (
        <div className="space-y-3">
          {/* Summary bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4 text-xs">
              <span className="text-gray-400">{t(imp.runsFound, { n: runs.length })}</span>
              {uploaded > 0 && <span className="text-trust-certified flex items-center gap-1"><CheckCircle size={11} />{uploaded} {imp.upload.toLowerCase()}</span>}
              {pending  > 0 && <span className="text-accent-gold   flex items-center gap-1"><Clock       size={11} />{pending} à uploader</span>}
              {failed   > 0 && <span className="text-trust-danger  flex items-center gap-1"><XCircle     size={11} />{failed} {imp.retry.toLowerCase()}</span>}
            </div>
            {pending > 0 && (
              <button
                onClick={uploadAll}
                disabled={uploading}
                className="btn-primary flex items-center gap-1.5 text-xs"
              >
                {uploading
                  ? <><RefreshCw size={12} className="animate-spin" />{imp.uploading}</>
                  : <><Upload size={12} />{t(imp.uploadAll, { n: pending })}</>}
              </button>
            )}
          </div>

          {/* Run list */}
          <div className="space-y-2">
            {runs.map((run) => (
              <div
                key={run.id}
                className={`card p-3 flex items-center gap-3 transition-opacity ${
                  run.syncStatus === "uploaded" ? "opacity-60" : ""
                }`}
              >
                {/* Status icon */}
                <div className="shrink-0">
                  {run.uploading
                    ? <RefreshCw size={16} className="text-accent-purple animate-spin" />
                    : run.syncStatus === "uploaded"
                    ? <CheckCircle size={16} className="text-trust-certified" />
                    : run.syncStatus === "failed"
                    ? <XCircle size={16} className="text-trust-danger" />
                    : <Clock size={16} className="text-accent-gold" />}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-white truncate">{run.dungeonName}</span>
                    <span className="text-xs font-mono text-accent-purple font-bold shrink-0">+{run.keystoneLevel}</span>
                    {run.inTime && (
                      <span className="text-[10px] px-1.5 py-0.5 bg-trust-certified/10 text-trust-certified border border-trust-certified/20 rounded shrink-0">
                        {imp.inTime}
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] text-gray-500 mt-0.5 flex items-center gap-2">
                    <span>{fmtDate(run.runDate, locale)}</span>
                    {run.durationSecs && <span>· {fmt(run.durationSecs)}</span>}
                    <span>· {t(imp.players, { n: run.playerCount })}</span>
                  </div>
                </div>

                {/* Upload button */}
                {run.syncStatus !== "uploaded" && (
                  <button
                    onClick={() => uploadOne(run.id)}
                    disabled={run.uploading || uploading}
                    className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-surface-500 bg-surface-700 hover:bg-surface-600 text-gray-300 text-xs font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    <Upload size={11} />
                    {run.syncStatus === "failed" ? imp.retry : imp.upload}
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state before analysis */}
      {!runs && !parsing && !parseErr && (
        <div className="text-center py-16 text-gray-600">
          <FileText size={40} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">{imp.emptyHint}</p>
          <p className="text-xs mt-1 text-gray-700">
            {imp.logPathHint}<br />
            <span className="font-mono text-gray-600">
              World of Warcraft\_retail_\Logs\WoWCombatLog.txt
            </span>
          </p>
        </div>
      )}
    </div>
  );
}

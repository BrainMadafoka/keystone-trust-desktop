import { CheckCircle, Clock, XCircle, Users } from "lucide-react";
import type { RunSummary } from "../types";

interface Props { run: RunSummary; }

function formatDuration(secs?: number): string {
  if (!secs) return "—";
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" }) +
    " " + d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

const STATUS_ICON = {
  uploaded: <CheckCircle size={14} className="text-trust-certified" />,
  pending:  <Clock       size={14} className="text-accent-gold" />,
  failed:   <XCircle     size={14} className="text-trust-danger" />,
};

const STATUS_LABEL = {
  uploaded: "Uploadé",
  pending:  "En attente",
  failed:   "Échec",
};

export default function RunCard({ run }: Props) {
  return (
    <div className="card p-4 hover:border-surface-500 transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded font-mono ${
              run.inTime ? "bg-trust-certified/20 text-trust-certified" : "bg-trust-danger/20 text-trust-danger"
            }`}>
              +{run.keystoneLevel}
            </span>
            <span className="text-sm font-semibold text-white truncate">{run.dungeonName}</span>
          </div>
          <div className="text-[11px] text-gray-500 mt-1">
            {formatDate(run.runDate)} · {formatDuration(run.durationSecs)}
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {STATUS_ICON[run.syncStatus]}
          <span className="text-[11px] text-gray-400">{STATUS_LABEL[run.syncStatus]}</span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-3 text-[11px] text-gray-500">
        <div className="flex items-center gap-1">
          <Users size={11} />
          <span>{run.playerCount} joueurs</span>
        </div>
        {!run.inTime && (
          <span className="text-trust-danger">Hors délai</span>
        )}
      </div>
    </div>
  );
}

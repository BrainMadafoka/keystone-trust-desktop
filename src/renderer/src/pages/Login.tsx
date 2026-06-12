import { useState } from "react";
import { Shield, ExternalLink, Loader, ChevronDown, ChevronUp } from "lucide-react";

interface Props {
  apiUrl: string;
}

export default function Login({ apiUrl }: Props) {
  const [waiting, setWaiting]     = useState(false);
  const [showManual, setShowManual] = useState(false);
  const [manualKey, setManualKey]  = useState("");
  const [error, setError]          = useState("");

  async function handleConnect() {
    setWaiting(true);
    setError("");
    await window.kt.shell.open(`${apiUrl}/client-connect`);
    // Spinner stays until auth:success arrives (handled by App.tsx)
  }

  async function handleManualSubmit() {
    const key = manualKey.trim();
    if (!key) return;
    setError("");
    // Save the key via settings:set — the renderer will reload and exit login
    await window.kt.settings.set({ apiKey: key });
    // Trigger a reload
    window.location.reload();
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-surface-900 px-6">
      <div className="w-full max-w-sm space-y-8 text-center">

        {/* Logo */}
        <div className="flex flex-col items-center gap-4">
          <div className="relative">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-purple to-accent-blue flex items-center justify-center shadow-glow-purple">
              <Shield size={36} className="text-white" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Keystone Trust</h1>
            <p className="text-sm text-gray-500 mt-1">Sync Client</p>
          </div>
        </div>

        {/* Card */}
        <div className="card p-6 space-y-5 text-left">
          <div>
            <p className="text-sm font-medium text-white">Connexion requise</p>
            <p className="text-xs text-gray-500 mt-1">
              Connectez-vous avec votre compte Keystone Trust pour commencer à synchroniser vos runs.
            </p>
          </div>

          {!waiting ? (
            <button
              onClick={handleConnect}
              className="w-full btn-primary flex items-center justify-center gap-2 py-2.5"
            >
              <ExternalLink size={15} />
              Se connecter via Battle.net
            </button>
          ) : (
            <div className="space-y-2">
              <div className="w-full flex items-center justify-center gap-3 py-2.5 rounded-lg border border-accent-purple/30 bg-accent-purple/10 text-accent-purple text-sm">
                <Loader size={15} className="animate-spin" />
                En attente de confirmation dans le navigateur…
              </div>
              <button
                onClick={() => setWaiting(false)}
                className="w-full text-xs text-gray-500 hover:text-gray-300 transition-colors py-1"
              >
                Annuler
              </button>
            </div>
          )}

          {/* Manual fallback */}
          <div>
            <button
              onClick={() => setShowManual((v) => !v)}
              className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-400 transition-colors"
            >
              {showManual ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
              Entrer une clé manuellement
            </button>

            {showManual && (
              <div className="mt-3 space-y-2">
                <input
                  className="input w-full text-xs"
                  placeholder="Colle ta clé API ici…"
                  value={manualKey}
                  onChange={(e) => setManualKey(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleManualSubmit()}
                />
                {error && <p className="text-[11px] text-trust-danger">{error}</p>}
                <button
                  onClick={handleManualSubmit}
                  disabled={!manualKey.trim()}
                  className="btn-primary w-full text-xs py-1.5"
                >
                  Confirmer
                </button>
              </div>
            )}
          </div>
        </div>

        <p className="text-[11px] text-gray-700">
          Pas encore de compte ?{" "}
          <button
            onClick={() => window.kt.shell.open(`${apiUrl}/`)}
            className="text-accent-purple hover:text-violet-400 underline"
          >
            Créer un compte sur Keystone Trust
          </button>
        </p>
      </div>
    </div>
  );
}

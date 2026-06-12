import { useState, useEffect } from "react";
import { CheckCircle, Loader, FolderOpen, RefreshCw, ToggleLeft, ToggleRight, LogOut } from "lucide-react";
import type { Settings as SettingsType } from "../types";
import { useLocale, LOCALES } from "../i18n";

interface Props {
  settings: SettingsType | null;
  apiOk: boolean | null;
  onSave: (patch: Partial<SettingsType>) => Promise<void>;
  onCheckApi: () => void;
  onLogout: () => Promise<void>;
}

export default function Settings({ settings, onSave, onCheckApi, onLogout }: Props) {
  const { m, locale, setLocale } = useLocale();
  const s = m.settings;

  const [form, setForm]           = useState<Partial<SettingsType>>({});
  const [accounts, setAccounts]   = useState<{ id: string; label: string }[]>([]);
  const [saving, setSaving]       = useState(false);
  const [saved, setSaved]         = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    if (settings) setForm(settings);
  }, [settings]);

  useEffect(() => {
    if (form.wowPath) loadAccounts(form.wowPath);
  }, [form.wowPath]);

  async function loadAccounts(path: string) {
    const list = await window.kt.wow.accounts(path);
    setAccounts(list as { id: string; label: string }[]);
  }

  async function detectWow() {
    setDetecting(true);
    const result = await window.kt.wow.detect();
    const r = result as { path: string | null };
    if (r.path) setForm((f) => ({ ...f, wowPath: r.path! }));
    setDetecting(false);
  }

  async function browse() {
    const path = await window.kt.wow.browse();
    if (path) setForm((f) => ({ ...f, wowPath: path as string }));
  }

  async function save() {
    setSaving(true);
    await onSave(form);
    onCheckApi();
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function logout() {
    setLoggingOut(true);
    await onLogout();
  }

  const set = (key: keyof SettingsType, value: unknown) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <div className="p-6 max-w-2xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold text-white">{s.title}</h1>
        <p className="text-xs text-gray-500 mt-0.5">{s.subtitle}</p>
      </div>

      {/* Language — placed first so it's always visible without scrolling */}
      <section className="card p-5">
        <Field label={s.language}>
          <select
            className="input"
            value={locale}
            onChange={(e) => {
              setLocale(e.target.value as typeof locale);
              set("locale", e.target.value);
            }}
          >
            {LOCALES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
        </Field>
      </section>

      {/* WoW path */}
      <section className="card p-5 space-y-4">
        <div>
          <h2 className="text-sm font-semibold text-white">{s.wowSection}</h2>
          <p className="text-xs text-gray-500 mt-0.5">{s.wowSectionDesc}</p>
        </div>

        <Field label={s.retailFolder}>
          <div className="flex gap-2">
            <input
              className="input flex-1"
              value={form.wowPath ?? ""}
              onChange={(e) => set("wowPath", e.target.value)}
              placeholder="C:\Program Files (x86)\World of Warcraft\_retail_"
            />
            <button onClick={browse} className="btn-ghost px-2.5" title="Parcourir">
              <FolderOpen size={14} />
            </button>
            <button onClick={detectWow} disabled={detecting} className="btn-ghost px-2.5" title="Détecter">
              <RefreshCw size={14} className={detecting ? "animate-spin" : ""} />
            </button>
          </div>
        </Field>

        <Field label={s.account}>
          {accounts.length > 0 ? (
            <select
              className="input"
              value={form.accountName ?? ""}
              onChange={(e) => set("accountName", e.target.value)}
            >
              <option value="">{s.selectAccount}</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
            </select>
          ) : (
            <input
              className="input"
              value={form.accountName ?? ""}
              onChange={(e) => set("accountName", e.target.value)}
              placeholder={s.accountPlaceholder}
            />
          )}
        </Field>

        {form.wowPath && form.accountName && (
          <div className="text-[11px] text-gray-600 bg-surface-700 rounded-lg px-3 py-2 font-mono break-all">
            {form.wowPath}\WTF\Account\{form.accountName}\SavedVariables\KeystoneTrust.lua
          </div>
        )}
      </section>

      {/* Auto-sync */}
      <section className="card p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-medium text-white">{s.autoSync}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.autoSyncDesc}</div>
          </div>
          <button
            onClick={() => set("autoSync", !form.autoSync)}
            className={`transition-colors ${form.autoSync ? "text-accent-purple" : "text-gray-600"}`}
          >
            {form.autoSync ? <ToggleRight size={32} /> : <ToggleLeft size={32} />}
          </button>
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn-primary flex items-center gap-2">
          {saving
            ? <><Loader size={14} className="animate-spin" /> {s.saving}</>
            : saved
            ? <><CheckCircle size={14} /> {s.saved}</>
            : s.save}
        </button>
        <span className="text-xs text-gray-600">{s.immediate}</span>
      </div>

      {/* Danger zone */}
      <section className="card p-5 border border-surface-600 space-y-4">
        <h2 className="text-sm font-semibold text-gray-400">{s.accountSection}</h2>
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-white">
              {s.connectedAs} <span className="font-medium text-accent-purple">{settings?.battletag || "—"}</span>
            </div>
            <div className="text-xs text-gray-500 mt-0.5">{s.logoutHint}</div>
          </div>
          <button
            onClick={logout}
            disabled={loggingOut}
            className="flex items-center gap-2 text-sm text-trust-danger hover:text-red-400 transition-colors border border-trust-danger/30 hover:border-red-400/30 rounded-lg px-3 py-1.5"
          >
            <LogOut size={14} />
            {loggingOut ? s.loggingOut : s.logout}
          </button>
        </div>
        <div className="flex items-center justify-between border-t border-surface-600 pt-3">
          <div>
            <div className="text-sm text-white">{s.resetQueue}</div>
            <div className="text-xs text-gray-500 mt-0.5">{s.resetQueueDesc}</div>
          </div>
          <button
            onClick={async () => { await window.kt.sync.reset(); }}
            className="text-sm text-gray-400 hover:text-white transition-colors border border-surface-500 hover:border-gray-400 rounded-lg px-3 py-1.5"
          >
            {s.reset}
          </button>
        </div>
      </section>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      {children}
    </div>
  );
}

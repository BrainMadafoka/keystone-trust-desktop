import { createElement, createContext, useContext, useState, useEffect, type ReactNode } from "react";
import en, { type DesktopMessages } from "./en";
import fr from "./fr";
import de from "./de";
import es from "./es";
import it from "./it";
import pt from "./pt";
import ru from "./ru";
import ko from "./ko";
import zhTW from "./zh-TW";
import zhCN from "./zh-CN";

export type Locale = "de" | "en" | "es" | "fr" | "it" | "pt" | "ru" | "ko" | "zh-TW" | "zh-CN";

export const LOCALES: { code: Locale; label: string }[] = [
  { code: "de",    label: "Deutsch" },
  { code: "en",    label: "English" },
  { code: "es",    label: "Español" },
  { code: "fr",    label: "Français" },
  { code: "it",    label: "Italiano" },
  { code: "pt",    label: "Português" },
  { code: "ru",    label: "Русский" },
  { code: "ko",    label: "한국어" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "zh-CN", label: "简体中文" },
];

const ALL: Record<Locale, DesktopMessages> = { de, en, es, fr, it, pt, ru, ko, "zh-TW": zhTW, "zh-CN": zhCN };

export function getMessages(locale: string): DesktopMessages {
  return ALL[locale as Locale] ?? en;
}

// ── Simple interpolation: t("hello {n} world", { n: 5 }) ─────────────────────
export function t(str: string, vars?: Record<string, string | number>): string {
  if (!vars) return str;
  return str.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

// ── Context ───────────────────────────────────────────────────────────────────
interface LocaleCtx {
  locale:    Locale;
  m:         DesktopMessages;
  setLocale: (l: Locale) => void;
}

const Ctx = createContext<LocaleCtx>({ locale: "en", m: en, setLocale: () => {} });

export function useLocale(): LocaleCtx { return useContext(Ctx); }

// ── Provider ──────────────────────────────────────────────────────────────────
export function LocaleProvider({ initialLocale, children }: { initialLocale?: string; children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>((initialLocale as Locale) || "en");

  // Sync when initialLocale changes (settings loaded async)
  useEffect(() => {
    if (initialLocale && ALL[initialLocale as Locale]) {
      setLocaleState(initialLocale as Locale);
    }
  }, [initialLocale]);

  const setLocale = (l: Locale) => {
    setLocaleState(l);
    window.kt.settings.set({ locale: l });
  };

  return createElement(Ctx.Provider, { value: { locale, m: getMessages(locale), setLocale } }, children);
}

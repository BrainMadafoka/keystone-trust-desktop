import Store from "electron-store";
import { safeStorage } from "electron";

export interface StoredRun {
  id:            string;
  dungeonName:   string;
  keystoneLevel: number;
  durationSecs:  number;
  completed:     boolean;
  inTime:        boolean;
  runDate:       string;
  affixes:       number[];
  playerCount:   number;
  uploadedAt:    string;
}

interface StoreSchema {
  apiKeyEncrypted: string;
  apiUrl: string;
  battletag: string;
  wowPath: string;
  accountName: string;
  autoSync: boolean;
  uploadedRunIds: string[];
  failedRunIds: string[];
  characterName: string;
  characterRealm: string;
  characterRegion: string;
  lastLogRunEndTimeMs: number;
  uploadedRunsMeta: StoredRun[];
  benchmarkCount: number;
  benchmarkLastUpdated: string; // ISO date or ""
  locale: string;
}

// Use the www subdomain directly — the apex (wowkeystonetrust.com) 301-redirects to
// www, and that cross-origin redirect can drop the x-kt-api-key header in Electron's
// fetch, causing the client to show "Offline". Hitting www avoids the redirect entirely.
export const PROD_URL = "https://www.wowkeystonetrust.com";

const store = new Store<StoreSchema>({
  defaults: {
    apiKeyEncrypted: "",
    apiUrl: PROD_URL,
    battletag: "",
    wowPath: "",
    accountName: "",
    autoSync: true,
    uploadedRunIds: [],
    failedRunIds: [],
    characterName: "",
    characterRealm: "",
    characterRegion: "eu",
    lastLogRunEndTimeMs: 0,
    uploadedRunsMeta: [],
    benchmarkCount: 0,
    benchmarkLastUpdated: "",
    locale: "en",
  },
});

// Always enforce production URL — the store may have kept a dev/staging URL
// from a previous session (localhost, vercel preview, etc.).
store.set("apiUrl", PROD_URL);

export default store;

function encryptKey(key: string): string {
  if (!key) return "";
  try {
    return safeStorage.encryptString(key).toString("base64");
  } catch {
    return "";
  }
}

function decryptKey(enc: string): string {
  if (!enc) return "";
  try {
    return safeStorage.decryptString(Buffer.from(enc, "base64"));
  } catch {
    return "";
  }
}

type SettingsPatch = Partial<{
  apiKey: string;
  apiUrl: string;
  battletag: string;
  wowPath: string;
  accountName: string;
  autoSync: boolean;
  characterName: string;
  characterRealm: string;
  characterRegion: string;
}>;

export function getSettings() {
  return {
    apiKey:          decryptKey(store.get("apiKeyEncrypted")),
    apiUrl:          store.get("apiUrl"),
    battletag:       store.get("battletag"),
    wowPath:         store.get("wowPath"),
    accountName:     store.get("accountName"),
    autoSync:        store.get("autoSync"),
    characterName:   store.get("characterName"),
    characterRealm:  store.get("characterRealm"),
    characterRegion: store.get("characterRegion"),
    locale:          store.get("locale"),
  };
}

export function setSettings(patch: SettingsPatch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === "apiKey") {
      store.set("apiKeyEncrypted", encryptKey(v as string));
    } else {
      store.set(k as keyof StoreSchema, v as StoreSchema[keyof StoreSchema]);
    }
  }
}

export function markUploaded(runId: string, meta?: Omit<StoredRun, "id" | "uploadedAt">) {
  const ids = store.get("uploadedRunIds");
  if (!ids.includes(runId)) store.set("uploadedRunIds", [...ids, runId]);
  const failed = store.get("failedRunIds").filter((id) => id !== runId);
  store.set("failedRunIds", failed);

  if (meta) {
    const existing = store.get("uploadedRunsMeta");
    if (!existing.find((r) => r.id === runId)) {
      const entry: StoredRun = { id: runId, ...meta, uploadedAt: new Date().toISOString() };
      store.set("uploadedRunsMeta", [entry, ...existing].slice(0, 2000)); // max 2000 runs
    }
  }
}

export function getUploadedRunsMeta(): StoredRun[] {
  return store.get("uploadedRunsMeta");
}

export function setBenchmarkInfo(count: number) {
  store.set("benchmarkCount", count);
  store.set("benchmarkLastUpdated", new Date().toISOString());
}

export function getBenchmarkInfo(): { count: number; lastUpdated: string } {
  return {
    count:       store.get("benchmarkCount"),
    lastUpdated: store.get("benchmarkLastUpdated"),
  };
}

export function markFailed(runId: string) {
  const ids = store.get("failedRunIds");
  if (!ids.includes(runId)) store.set("failedRunIds", [...ids, runId]);
}

export function getUploadedIds(): string[] { return store.get("uploadedRunIds"); }
export function getFailedIds():   string[] { return store.get("failedRunIds"); }
export function resetSyncQueue() {
  store.set("uploadedRunIds", []);
  store.set("failedRunIds", []);
  store.set("lastLogRunEndTimeMs", 0);
}

export function getLastLogRunEndTimeMs(): number { return store.get("lastLogRunEndTimeMs"); }
export function setLastLogRunEndTimeMs(ms: number) {
  if (ms > store.get("lastLogRunEndTimeMs")) store.set("lastLogRunEndTimeMs", ms);
}

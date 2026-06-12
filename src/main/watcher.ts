import { watch, FSWatcher } from "chokidar";
import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join } from "path";
import { parseSavedVars, type KTSavedVars } from "./luaParser";

let watcher: FSWatcher | null = null;

// Common WoW installation paths on Windows
const COMMON_WOW_PATHS = [
  "C:\\Program Files (x86)\\World of Warcraft\\_retail_",
  "C:\\Program Files\\World of Warcraft\\_retail_",
  "D:\\World of Warcraft\\_retail_",
  "D:\\Games\\World of Warcraft\\_retail_",
  "E:\\World of Warcraft\\_retail_",
];

export function detectWowPath(): string | null {
  for (const p of COMMON_WOW_PATHS) {
    if (existsSync(join(p, "WTF"))) return p;
  }
  return null;
}

export interface AccountInfo {
  id:         string;   // folder name used as stored value e.g. "120534635#1"
  label:      string;   // human-readable label e.g. "Brainmadzz, Artigura (120534635#1)"
  characters: string[]; // all character names found across realms
}

export function detectAccounts(wowPath: string): AccountInfo[] {
  const wtfAccount = join(wowPath, "WTF", "Account");
  if (!existsSync(wtfAccount)) return [];
  try {
    const accountDirs = readdirSync(wtfAccount, { withFileTypes: true })
      .filter((d) => d.isDirectory() && d.name !== "SavedVariables");

    return accountDirs.map((d) => {
      const accountPath = join(wtfAccount, d.name);
      const characters: string[] = [];

      try {
        // Realm folders sit directly inside the account folder
        const realmDirs = readdirSync(accountPath, { withFileTypes: true })
          .filter((r) => r.isDirectory() && r.name !== "SavedVariables");

        for (const realm of realmDirs) {
          const realmPath = join(accountPath, realm.name);
          try {
            const charDirs = readdirSync(realmPath, { withFileTypes: true })
              .filter((c) => c.isDirectory());
            characters.push(...charDirs.map((c) => c.name));
          } catch { /* skip unreadable realm */ }
        }
      } catch { /* skip unreadable account */ }

      const label = characters.length > 0
        ? `${characters.slice(0, 3).join(", ")}${characters.length > 3 ? ` +${characters.length - 3}` : ""} (${d.name})`
        : d.name;

      return { id: d.name, label, characters };
    });
  } catch { return []; }
}

export function getSavedVarsPath(wowPath: string, accountName: string): string {
  return join(wowPath, "WTF", "Account", accountName, "SavedVariables", "KeystoneTrust.lua");
}

export function readSavedVars(wowPath: string, accountName: string): KTSavedVars | null {
  const filePath = getSavedVarsPath(wowPath, accountName);
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath, "utf-8");
    return parseSavedVars(content);
  } catch { return null; }
}

export function startWatcher(
  filePath: string,
  onChange: () => void
): void {
  stopWatcher();
  if (!existsSync(filePath)) return;

  watcher = watch(filePath, { persistent: true, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 1000 } });
  watcher.on("change", onChange);
}

export function stopWatcher(): void {
  watcher?.close();
  watcher = null;
}

export type SyncStatus    = "idle" | "detecting" | "uploading" | "downloading" | "error";
export type RunSyncStatus = "uploaded" | "pending" | "failed";

export interface RunSummary {
  id:            string;
  dungeonName:   string;
  keystoneLevel: number;
  durationSecs?: number;
  completed:     boolean;
  inTime:        boolean;
  runDate:       string;
  affixes:       number[];
  playerCount:   number;
  syncStatus:    RunSyncStatus;
}

export interface Settings {
  apiKey:          string;
  apiUrl:          string;
  battletag:       string;
  wowPath:         string;
  accountName:     string;
  autoSync:        boolean;
  characterName:   string;
  characterRealm:  string;
  characterRegion: string;
  locale:          string;
}

export interface SyncState {
  status:  SyncStatus;
  message: string;
  pct?:    number; // 0-100 during "downloading"
}

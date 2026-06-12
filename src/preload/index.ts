import { contextBridge, ipcRenderer } from "electron";

const api = {
  settings: {
    get: ()                              => ipcRenderer.invoke("settings:get"),
    set: (patch: Record<string, unknown>) => ipcRenderer.invoke("settings:set", patch),
  },
  auth: {
    logout: () => ipcRenderer.invoke("auth:logout"),
  },
  wow: {
    detect:   ()             => ipcRenderer.invoke("wow:detect"),
    accounts: (path: string) => ipcRenderer.invoke("wow:accounts", path),
    browse:   ()             => ipcRenderer.invoke("wow:browse"),
  },
  runs: {
    list: () => ipcRenderer.invoke("runs:list"),
  },
  sync: {
    trigger: () => ipcRenderer.invoke("sync:trigger"),
    reset:   () => ipcRenderer.invoke("sync:reset"),
  },
  api: {
    test: () => ipcRenderer.invoke("api:test"),
  },
  shell: {
    open: (url: string) => ipcRenderer.invoke("shell:open", url),
  },
  updater: {
    install: () => ipcRenderer.invoke("updater:install"),
    check:   () => ipcRenderer.invoke("updater:check"),
  },
  app: {
    version: () => ipcRenderer.invoke("app:version"),
  },
  benchmarks: {
    download: () => ipcRenderer.invoke("benchmarks:download"),
    info:     () => ipcRenderer.invoke("benchmarks:info"),
  },
  history: {
    list: () => ipcRenderer.invoke("history:list"),
  },
  log: {
    browseFile:     ()                 => ipcRenderer.invoke("log:browse-file"),
    importFile:     (path: string)     => ipcRenderer.invoke("log:import-file", path),
    uploadImported: (runId: string)    => ipcRenderer.invoke("log:upload-imported", runId),
  },
  logs: {
    get:   () => ipcRenderer.invoke("logs:get"),
    clear: () => ipcRenderer.invoke("logs:clear"),
  },
  on: (channel: string, fn: (...args: unknown[]) => void) => {
    const listener = (_: unknown, ...args: unknown[]) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
};

contextBridge.exposeInMainWorld("kt", api);

declare global {
  interface Window { kt: typeof api; }
}

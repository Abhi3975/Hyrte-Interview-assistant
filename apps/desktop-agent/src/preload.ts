import { contextBridge, ipcRenderer } from 'electron';

/**
 * Secure bridge between the renderer status window and the main process.
 * Exposes only a minimal, read-only surface (no Node access in the renderer).
 */
contextBridge.exposeInMainWorld('agent', {
  getStatus: () => ipcRenderer.invoke('agent:status'),
  onDetection: (cb: (d: unknown) => void) =>
    ipcRenderer.on('agent:detection', (_e, d) => cb(d)),
});

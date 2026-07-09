import { app, BrowserWindow, clipboard, ipcMain, powerMonitor } from 'electron';
import * as path from 'node:path';
import { scanProcesses } from './detectors';
import { EventEmitterClient, AgentConfig } from './emitter';

/**
 * InterviewAI desktop proctoring agent — main process.
 *
 * Runs alongside the browser exam. On a fixed cadence it scans running
 * processes for remote-access / overlay / screen-recording tools and watches
 * the clipboard, emitting signed events to the backend risk engine. It shows a
 * small status window so the candidate always knows monitoring is active
 * (transparency by design) — it never blocks input or renders verdicts.
 */

// Config is injected by the launcher (deep link / env) when the candidate
// starts a proctored session. Env fallback keeps local testing simple.
function loadConfig(): AgentConfig {
  return {
    apiBaseUrl: process.env.INTERVIEWAI_API ?? 'http://localhost:4000',
    webhookSecret: process.env.PROCTOR_WEBHOOK_SECRET ?? 'change-me-proctor-secret',
    sessionId: process.env.INTERVIEWAI_SESSION ?? '',
  };
}

let win: BrowserWindow | null = null;
let scanTimer: ReturnType<typeof setInterval> | null = null;
let lastClipboard = '';

function createWindow(): void {
  win = new BrowserWindow({
    width: 320,
    height: 180,
    resizable: false,
    alwaysOnTop: true,
    title: 'InterviewAI Agent',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function startMonitoring(config: AgentConfig): void {
  const emitter = new EventEmitterClient(config);

  const tick = async () => {
    // 1. Process scan.
    const detections = await scanProcesses();
    for (const d of detections) {
      await emitter.emit({ type: d.type, severity: d.severity, payload: { process: d.processName } });
      win?.webContents.send('agent:detection', d);
    }

    // 2. Clipboard change (possible paste-in of external answers).
    const clip = clipboard.readText();
    if (clip && clip !== lastClipboard) {
      lastClipboard = clip;
      await emitter.emit({ type: 'CLIPBOARD_USAGE', severity: 'LOW', payload: { length: clip.length } });
    }
  };

  // Scan every 8s — frequent enough to catch tools, light on CPU.
  scanTimer = setInterval(() => void tick(), 8000);
  void tick();

  // Device wake/unlock can indicate session hand-off.
  powerMonitor.on('unlock-screen', () => void emitter.emit({ type: 'DEVICE_CHANGE', severity: 'LOW' }));
}

app.whenReady().then(() => {
  const config = loadConfig();
  createWindow();
  if (config.sessionId) startMonitoring(config);

  ipcMain.handle('agent:status', () => ({ session: config.sessionId, monitoring: Boolean(config.sessionId) }));

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (scanTimer) clearInterval(scanTimer);
  if (process.platform !== 'darwin') app.quit();
});

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';

const run = promisify(exec);

/**
 * Native OS monitoring detectors.
 *
 * These enumerate running processes and match them against curated denylists
 * of known remote-access tools, screen-recording/sharing software, and AI
 * "overlay" assistants. The agent only reports what it observes as evidence —
 * it never blocks or accuses. Matching is by process name, case-insensitive.
 */

export type DetectionType =
  | 'REMOTE_ACCESS_TOOL'
  | 'SCREEN_RECORDING_TOOL'
  | 'OVERLAY_APP'
  | 'SUSPICIOUS_PROCESS';

export interface Detection {
  type: DetectionType;
  severity: 'MEDIUM' | 'HIGH' | 'CRITICAL';
  processName: string;
}

// Known remote-desktop / remote-access software.
const REMOTE_ACCESS = [
  'teamviewer', 'anydesk', 'rustdesk', 'chrome remote', 'remotepc',
  'vnc', 'realvnc', 'tightvnc', 'ultravnc', 'logmein', 'splashtop',
  'ammyy', 'aeroadmin', 'dwservice', 'parsec',
];

// Screen recording / sharing tools.
const SCREEN_TOOLS = [
  'obs', 'obs64', 'screenflow', 'camtasia', 'bandicam', 'snagit',
  'quicktime', 'zoom', 'discord', 'msteams', 'screen recorder', 'loom',
];

// AI "overlay" / hidden-assistant tools that sit atop the exam window.
const OVERLAY_AI = [
  'cluely', 'interviewcoder', 'leetcode whisper', 'copilot overlay',
  'ai overlay', 'invisible', 'ghostwriter', 'aihelper',
];

function match(name: string, list: string[]): boolean {
  const n = name.toLowerCase();
  return list.some((needle) => n.includes(needle));
}

/** List running process names for the current OS. */
async function listProcesses(): Promise<string[]> {
  try {
    if (platform() === 'win32') {
      const { stdout } = await run('tasklist /fo csv /nh');
      return stdout
        .split('\n')
        .map((line) => line.split('","')[0]?.replace(/^"/, '').trim() ?? '')
        .filter(Boolean);
    }
    // macOS / Linux
    const { stdout } = await run('ps -axo comm');
    return stdout.split('\n').slice(1).map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

export async function scanProcesses(): Promise<Detection[]> {
  const procs = await listProcesses();
  const detections: Detection[] = [];
  const seen = new Set<string>();

  for (const proc of procs) {
    const key = proc.toLowerCase();
    if (seen.has(key)) continue;

    if (match(proc, REMOTE_ACCESS)) {
      seen.add(key);
      detections.push({ type: 'REMOTE_ACCESS_TOOL', severity: 'CRITICAL', processName: proc });
    } else if (match(proc, OVERLAY_AI)) {
      seen.add(key);
      detections.push({ type: 'OVERLAY_APP', severity: 'CRITICAL', processName: proc });
    } else if (match(proc, SCREEN_TOOLS)) {
      seen.add(key);
      detections.push({ type: 'SCREEN_RECORDING_TOOL', severity: 'HIGH', processName: proc });
    }
  }
  return detections;
}

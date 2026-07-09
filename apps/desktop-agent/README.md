# InterviewAI Desktop Agent

An Electron proctoring agent that runs alongside the browser exam and provides
the **native OS monitoring layer** the browser cannot: enumerating running
processes and watching the clipboard, then emitting **signed** events to the
backend risk engine.

## What it detects

| Signal | How |
|--------|-----|
| `REMOTE_ACCESS_TOOL` | Process scan vs. denylist (TeamViewer, AnyDesk, RustDesk, VNC, Parsec, …) |
| `OVERLAY_APP` | AI overlay / hidden-assistant tools (Cluely, InterviewCoder, …) |
| `SCREEN_RECORDING_TOOL` | OBS, Camtasia, Loom, screen-share in Zoom/Teams/Discord |
| `CLIPBOARD_USAGE` | Clipboard content changes during the exam |
| `DEVICE_CHANGE` | Screen unlock / possible hand-off |

## Design principles

- **Transparency**: a small always-on-top window tells the candidate monitoring
  is active. It never hides.
- **Evidence, not enforcement**: the agent reports; it never blocks input or
  accuses. The backend risk engine weights and decays every signal.
- **Zero-trust transport**: events are HMAC-SHA256 signed with the shared
  `PROCTOR_WEBHOOK_SECRET` and posted to `POST /api/proctoring/webhook` — the
  same contract any external proctor provider uses.

## Run (dev)

```bash
cd apps/desktop-agent
npm install
INTERVIEWAI_API=http://localhost:4000 \
INTERVIEWAI_SESSION=<sessionId> \
PROCTOR_WEBHOOK_SECRET=<same-as-backend> \
npm run dev
```

## Package

```bash
npm run dist   # electron-builder → .dmg / .exe / .AppImage
```

## Architecture

```
 main.ts ──┬── detectors.ts   (process scan, denylists)
           ├── emitter.ts      (HMAC-signed webhook POST)
           ├── clipboard/power watchers
           └── renderer/       (status window, preload bridge — no Node access)
```

> Not part of the root npm workspace install by default in CI (Electron is a
> heavy dependency). Install it standalone as shown above.

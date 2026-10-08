# Antigravity prompt — strict proctoring, Ally latency, Koyo-style login

Paste everything below the line into Antigravity, with this repo
(`Hyrte-int-ass`, Turborepo: `apps/web` Next.js, `apps/api` NestJS, Prisma)
open as the workspace.

---

You are working in the HYRTE monorepo: `apps/web` (Next.js App Router,
Tailwind, Zustand auth store at `apps/web/src/store/auth.ts`) and `apps/api`
(NestJS, Prisma, OpenAI via `apps/api/src/ai/ai.service.ts`, ElevenLabs TTS at
`apps/api/src/voice/speech/elevenlabs.tts.ts`). The product is a proctored,
voice-first AI interview room modelled on Koyo (https://koyo.newtonschool.co).
The AI interviewer is called **Ally**. The main room is
`apps/web/src/app/candidate/interview/page.tsx` (~2000 lines); client
proctoring lives in `apps/web/src/lib/proctoring.ts`; server risk scoring in
`apps/api/src/proctoring/`.

Do three pieces of work, in this order. Each one is its own commit. Don't
rewrite working code you weren't asked to touch, and don't swap the stack
(no Clerk, Socket.IO rewrite or Vercel move). Match the existing code style
and comment density.

Before you write any code, open https://koyo.newtonschool.co in the browser
and walk through it: landing → role gallery → sign-up/login → pre-interview
lobby → live room. Write down how its login screen, lobby and proctoring
warnings are laid out and what they say. **Use it only as a UX reference.**
Don't copy Newton School's name, logo, colours, illustrations or copy text.
Everything keeps HYRTE branding.

## Task 1 — Fix Ally's speaking lag

### Root causes already found (confirm each one before you fix it)
1. **The frontend throws away streaming.** `speak()` in
   `candidate/interview/page.tsx` (around line 730) calls
   `fetch('/api/voice/speak')` and then `await res.blob()`. It waits for the
   **whole** MP3 before playback starts, so the backend's chunked stream does
   nothing.
2. **The slowest ElevenLabs model is in use.** `elevenlabs.tts.ts` uses
   `eleven_multilingual_v2` with `mp3_44100_128`. That is the
   highest-latency combination ElevenLabs offers.
3. **Everything runs one after another.** Candidate finishes → full LLM reply
   from `/practice/interview/turn` (no streaming) → full TTS request → full
   download → play. Ally can't start speaking until all four steps finish.

### Required fixes
- **Stream playback.** Replace the `res.blob()` path with progressive
  playback: `MediaSource` + `SourceBuffer('audio/mpeg')`, appending chunks from
  `res.body.getReader()` and calling `audio.play()` after the first chunk.
  Safari has no MSE for `audio/mpeg`, so detect support and fall back to the
  current blob path there. Keep the existing `speakTokenRef` race guard, the
  barge-in behaviour, `speakBrowser` fallback, mute handling and
  `setVoiceState('listening')` on end. All of them must keep working.
- **Low-latency TTS.** In `elevenlabs.tts.ts`, switch to `eleven_flash_v2_5`
  (or `eleven_turbo_v2_5`) and `output_format=mp3_22050_32`, and add
  `optimize_streaming_latency=3`. Make the model an env var
  (`ELEVENLABS_MODEL_ID`) with flash as the default. Keep the per-mood
  `MOOD_VOICE_SETTINGS`.
- **Sentence-level pipelining.** Make `/practice/interview/turn` support
  streaming (SSE, or a chunked `text/event-stream` response) behind a flag. The
  old JSON contract must keep working, because `hyrte/session/[id]/interview`
  and tests depend on it. On the client, as soon as the first full sentence
  arrives, send it to TTS and start playing it while later sentences are still
  generating. Queue the following sentences so the audio is gapless. Keep the
  final message text identical to what the non-streamed path produced, and
  keep the `hintLevel`, `mood` and `degraded` fields (send them in a final SSE
  event).
- **Prewarm.** Pre-open the TTS connection at room start. Cache the fixed
  lines (greeting, "take your time", the silence prompts from
  `@interviewai/conversation`) so they play instantly.
- **Instrument it.** Log, per turn: candidate-stopped → LLM first token → first
  audio byte → audio playing. Show it in a dev-only overlay
  (`?debugLatency=1`).

### Acceptance
- Median time from the candidate finishing to Ally's first audible word is
  **≤ 1.5 s** on a normal connection, down from the current multi-second gap.
  Measure it with the overlay over 10 turns and report the before/after
  numbers.
- No regression in barge-in, mute, the echo guard (the mic stays off while
  Ally speaks) or the coding-tab lock that opens and closes with Ally's
  speech.

## Task 2 — Full proctoring: only the interview tab allowed

Be honest about browser limits in the code comments and in the UI copy.
**A web page cannot close, block or see other tabs.** What it can do is
(a) require full-screen + whole-monitor screen share, (b) detect every focus
loss immediately, (c) warn, escalate and auto-terminate, and (d) record
evidence. Build all four. Stopping a tab from being opened at all needs a
lockdown client, so do (e) as an optional, separate piece.

### Build in `apps/web/src/lib/proctoring.ts` and the interview room
1. **Mandatory gate before start.** The room can't start until all of these
   are true: camera on, mic on, `getDisplayMedia` with
   `displaySurface === 'monitor'` (already partly at ~line 1273, so make it
   mandatory, with no "skip"), `document.documentElement.requestFullscreen()`
   active, exactly one screen (`window.screen.isExtended === false` where
   supported; otherwise use the Window Management API
   `getScreenDetails()` where permitted), and no second HYRTE interview tab
   open (see 4).
2. **Focus-loss detection.** Watch all of `visibilitychange`, `window` `blur`,
   `pagehide`, `fullscreenchange` and `document.hasFocus()` polling every
   500 ms. If the screen-share track ends (`track.onended`), treat it as a
   CRITICAL violation. Record the duration of every focus loss, not just the
   fact that it happened.
3. **Strike policy (strict by default, as recruiter assessments already are).**
   - 1st tab switch / fullscreen exit: a full-screen blocking modal ("You left
     the interview tab"), timer keeps running, Ally pauses, and the candidate
     must click "Return to full screen" to continue.
   - 2nd: final-warning modal, plus a recruiter-visible HIGH flag.
   - 3rd, any single focus loss over 15 s, or screen-share stopped: **auto-end
     the interview**. Submit it with the existing `/practice/session/:id/complete`
     path, `integrity.terminated = true` and a reason. Show the candidate a
     "Interview ended due to proctoring violations" screen.
   - Put the thresholds in one config object, mirroring
     `apps/api/src/proctoring/risk-weights.ts`.
4. **Single-tab lock.** Use a `BroadcastChannel('hyrte-interview')` plus a
   `localStorage` heartbeat lock. If a second tab opens the interview (or any
   HYRTE page while an interview is live), the new tab shows "Interview already
   open in another tab" and the original records a `MULTIPLE_TABS` violation.
5. **Input lockdown inside the tab.** Block right-click, copy/cut/paste
   outside the code editor (paste into the editor counts as an AI-assist
   signal; that already exists, so keep it), text selection on question text,
   DevTools shortcuts (F12, Cmd/Ctrl+Shift+I/J/C, Cmd+Opt+I), view-source
   (Cmd/Ctrl+U), print and save (Cmd/Ctrl+P/S), and add a `beforeunload`
   confirmation. Detect DevTools opening with the window outer/inner size
   heuristic and log it as a violation.
6. **Evidence.** Stream every violation to the backend the same way
   `bumpFlag()` already does. Add new `ProctorType` values (`MULTIPLE_TABS`,
   `SCREEN_SHARE_STOPPED`, `DEVTOOLS_OPEN`, `MULTI_MONITOR`,
   `FOCUS_LOST_LONG`) on both web and API. Update the API DTO validator so
   they aren't rejected, add weights in `risk-weights.ts`, and capture a webcam
   + screen frame at the moment of each HIGH/CRITICAL violation into the
   existing S3 recording flow. Show these on
   `apps/web/src/app/recruiter/proctoring/[sessionId]/page.tsx` as a timeline.
7. **Live HUD.** Keep the Koyo-style live flags (Eye Shift, Switched Tabs,
   AI-Assist, Second Voice) and add a strike counter ("Warnings 1/3").
8. **(e) Optional lockdown client, separate commit.** Add a minimal Chrome
   extension (Manifest V3) under `apps/lockdown-extension/` that, while an
   interview is active (it gets a signed session token from the page via
   `externally_connectable`), uses `chrome.tabs` / `chrome.windows` to close
   or refocus any other tab or window and reports attempts to the API. The
   interview page shows an "Extension required" step when the recruiter's
   assessment has `requireLockdown: true`. Document Safe Exam Browser as the
   alternative for high-stakes use.

### Acceptance
- Add or extend tests under `apps/api/test/` (next to `proctoring-strict.spec.ts`
  and `proctoring-policy.spec.ts`) for the new types, weights and the
  termination rule.
- Manually verify in Chrome **and** Safari, over HTTPS (CloudFront: camera,
  mic and screen share need a secure context): switching tabs 3 times ends the
  interview, stopping the share ends it, a second tab is refused, and Esc out
  of fullscreen produces the blocking modal.

## Task 3 — Koyo-style login

Use the existing backend; most of it is already there: `auth/request-otp`,
`auth/verify-otp`, the passwordless `AuthService.otpLogin`, `OtpService`, the
Twilio provider at `apps/api/src/auth/sms/twilio-sms.provider.ts`, and
`/signup` (phone-first OTP). `/login` (`apps/web/src/app/login/page.tsx`) is
still the old email + password form. That's the gap.

- Rebuild `/login` to work like Koyo's: a split layout with a product/benefit
  panel on one side and the auth card on the other. **Phone number + OTP is
  the primary path**, using a country-code picker and a 6-box OTP input with
  auto-advance, paste-to-fill, a 30 s resend countdown and auto-submit on the
  6th digit. Add a **"Continue with Google"** button (NextAuth/Google OAuth or a
  NestJS Passport Google strategy, issuing the same JWT pair as `otpLogin`).
  Keep "Login with email & password" as a secondary link for recruiters.
- Merge login and sign-up into one flow, as Koyo does: entering a phone number
  that doesn't exist yet moves straight to a "Tell us your name" step after
  OTP verification. `/signup` keeps working, either redirecting into the same
  flow or sharing its components.
- Preserve `?next=` so that the role gallery's "Try Interview now" →
  login → lands the candidate in `/candidate/interview?topic=N`.
- Move OTP storage from memory to the database or Redis, so it survives
  multiple ECS tasks. Rate-limit request-otp to 3 per 10 minutes per number
  and per IP. Allow 5 verify attempts, then lock. Return `devCode` **only**
  when `NODE_ENV !== 'production'`.
- Accessibility: label every input, and the OTP boxes have to work with screen
  readers and `autocomplete="one-time-code"`.
- **Don't** build anything that logs users in with Newton School / Koyo
  accounts. There's no public provider for that, and pretending otherwise
  would imitate another company. "Login through Koyo" here means the same UX
  pattern, under HYRTE branding.

### Acceptance
- Phone OTP login, Google login and the email fallback each end with a valid
  session and the correct redirect for CANDIDATE vs recruiter roles.
- An unknown number goes through name capture and gets a CANDIDATE account.

## Definition of done (all tasks)
- `npm run build` and the API test suite pass.
- Verify live, not by reading the code. The deploy script can go green while
  ECS keeps serving the old task revision, so after `infra/deploy-new-account.sh`
  confirm the new task-definition revision is the one RUNNING, then retest on
  the CloudFront URL.
- Finish with a short report: what changed per task, the before/after latency
  numbers, the test results, and anything you couldn't do (with the reason).

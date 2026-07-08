# AI Voice Interview — realtime architecture

## Goal

A human-like AI interviewer that conducts a complete interview autonomously:
introduces itself, verifies identity, reads the résumé, asks personalized and
adaptive questions, generates unlimited contextual follow-ups, and evaluates.

## Realtime pipeline

```
 candidate mic ──► [browser WS] ──► voice-ws gateway ──► STT provider (stream)
                                          │                     │ transcript chunks
                                          │◄────────────────────┘
                                          ▼
                                   FollowUpEngine (AI router)
                                          │ interviewer text + assessment
                                          ▼
                                     TTS provider (stream)
 candidate speaker ◄── [browser WS] ◄─────┘ audio chunks
```

- **STT**: Deepgram / AssemblyAI / OpenAI Realtime — behind `STTProvider`.
- **LLM**: `FollowUpEngine` uses the AI router (defaults to Claude for nuanced
  conversational judgment); swappable per request.
- **TTS**: ElevenLabs / Cartesia / OpenAI — behind `TTSProvider`.

Interfaces live in `apps/api/src/voice/speech/speech.interface.ts`. The
turn-decision logic is fully implemented and exposed over REST
(`POST /api/voice/intro`, `POST /api/voice/turn`) so the conversation flow is
testable without audio; the WebSocket gateway wraps it for streaming.

## Follow-up engine

`follow-up-engine.service.ts` takes the running transcript + candidate context
(résumé summary, skills, projects) and returns:

```jsonc
{
  "action": "follow_up | next_question | challenge | conclude",
  "interviewerText": "...",           // spoken, no markdown
  "nextDifficulty": "EASY|MEDIUM|HARD|EXPERT",
  "assessment": { "quality": 0-100, "confidence": 0-1, "isWeak": bool, "gaps": [] }
}
```

Example ladder — "Explain the React Virtual DOM" → if weak → "Can you explain
reconciliation?" → "What happens when state changes?" → "How does React optimize
rendering?" The engine generates these dynamically from the detected *gaps*, so
follow-ups are unlimited and contextual rather than scripted.

## Adaptive difficulty

The engine raises difficulty when answers are strong and lowers it when the
candidate struggles (`nextDifficulty`), producing an
`EASY→MEDIUM→HARD→EXPERT` (or reverse) trajectory over the session.

## Résumé-aware interviewing

On session start the résumé is parsed (skills/projects/experience) and folded
into the system prompt, so the interviewer asks project-specific questions
("Explain the architecture", "Why this model?", "How did you cut false
positives?").

## Multi-language

`SpeechLanguage` supports English, Hindi, Hinglish, Marathi, Tamil, Telugu. The
recruiter selects the language; it drives both the STT/TTS config and the
interviewer's spoken language.

## Proctoring integration

The voice agent receives live proctoring notices (via the `proctoring:<session>`
Redis channel) and can address them verbally — "Your face isn't visible, please
look at the camera" / "Please remove the phone from the interview area." After
the risk engine escalates to the 3rd warning, the session auto-terminates and
the agent concludes. Pass `proctoringNotice` to `POST /api/voice/turn`.

## Scale

Voice sockets run on a dedicated `voice-ws` gateway tier (sticky sessions at the
ALB). Turn state is kept in Redis so any gateway pod can resume a session;
transcripts and audio are streamed to S3. Kafka carries voice-analytics events
(silence, interruptions, latency, speaking duration) to the analytics consumer.

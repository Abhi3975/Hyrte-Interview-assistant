'use client';

/**
 * Conversational, proctored AI interview room.
 *
 * The AI interviewer (persona lives server-side in /practice/interview/turn)
 * greets the candidate, takes their introduction, asks one question at a time
 * with context, gives progressive hints, reviews code, and ends with a full
 * report. The candidate replies by typing or speaking; a coding tab compiles
 * & runs real code (or SQL). Webcam + client-side proctoring run throughout,
 * and the whole session is recorded to the DB for later review.
 */

import { Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuthStore } from '@/store/auth';
import { api } from '@/lib/api';
import { ThemeToggle } from '@/components/theme-toggle';
import { MicIcon, SpeakerIcon, ShieldIcon, AlertIcon, CheckIcon, XIcon, CodeIcon } from '@/components/icons';

const TOPICS: { label: string; category: string; topic: string; blurb: string }[] = [
  { label: 'Software Engineer', category: 'DSA', topic: 'Data Structures and Algorithms', blurb: 'DSA, problem solving & complexity' },
  { label: 'Frontend (React)', category: 'FRONTEND', topic: 'React', blurb: 'React, JS, browser & UI' },
  { label: 'Backend (Node)', category: 'BACKEND', topic: 'Node.js', blurb: 'APIs, Node.js, databases' },
  { label: 'Python', category: 'BACKEND', topic: 'Python', blurb: 'Python, OOP & scripting' },
  { label: 'Java', category: 'BACKEND', topic: 'Java', blurb: 'Java, JVM & OOP' },
  { label: 'System Design', category: 'SYSTEM_DESIGN', topic: 'System Design', blurb: 'Scalability & architecture' },
  { label: 'SQL / Data Analyst', category: 'SQL', topic: 'SQL', blurb: 'SQL, queries & modelling' },
  { label: 'DevOps', category: 'DEVOPS', topic: 'DevOps and CI/CD', blurb: 'CI/CD, containers & cloud' },
  { label: 'AI / ML', category: 'AI_ML', topic: 'Machine Learning', blurb: 'ML, models & maths' },
  { label: 'Data Analytics', category: 'DATA_ANALYTICS', topic: 'Data Analytics', blurb: 'Analysis & insight' },
  { label: 'Product Manager', category: 'PRODUCT_MANAGEMENT', topic: 'Product Management', blurb: 'Product sense & metrics' },
  { label: 'HR / Behavioral', category: 'HR', topic: 'Behavioral', blurb: 'Behavioural & culture fit' },
];
const DIFFICULTIES = ['EASY', 'MEDIUM', 'HARD', 'EXPERT'] as const;
const QUESTION_COUNTS = [3, 5, 8, 10];
const INTERVIEW_TYPES: { id: 'mixed' | 'theory' | 'coding'; label: string }[] = [
  { id: 'mixed', label: 'Mixed' },
  { id: 'theory', label: 'Theory only' },
  { id: 'coding', label: 'Coding only' },
];

// ── Guided setup wizard data ──
const SWE_T = ['JavaScript', 'TypeScript', 'React', 'Next.js', 'Node.js', 'Express', 'NestJS', 'Python', 'Java', 'Spring Boot', 'Go', 'REST APIs', 'GraphQL', 'Microservices', 'OOP', 'Design Patterns', 'System Design'];
const AI_T = ['Machine Learning', 'Deep Learning', 'NLP', 'Computer Vision', 'LLM', 'Prompt Engineering', 'OpenAI API', 'LangChain', 'RAG', 'Vector Databases'];
const DA_T = ['SQL', 'Excel', 'Power BI', 'Tableau', 'Python', 'Pandas', 'NumPy', 'Statistics', 'Data Visualization', 'ETL', 'Data Cleaning'];
const FIN_T = ['Financial Accounting', 'Corporate Finance', 'Investment Banking', 'Equity Research', 'Financial Modeling', 'Valuation', 'Risk Management', 'Taxation', 'Banking'];

interface CatDef { label: string; cat: string; topics: string[] }
const CATEGORIES: CatDef[] = [
  { label: 'Software Engineering', cat: 'DSA', topics: SWE_T },
  { label: 'Frontend Development', cat: 'FRONTEND', topics: ['JavaScript', 'TypeScript', 'React', 'Next.js', 'Angular', 'Vue', 'HTML/CSS', 'Redux', 'Web Performance', 'Accessibility'] },
  { label: 'Backend Development', cat: 'BACKEND', topics: ['Node.js', 'Express', 'NestJS', 'Python', 'Django', 'Java', 'Spring Boot', 'Go', 'REST APIs', 'GraphQL', 'Microservices', 'Authentication'] },
  { label: 'Full Stack Development', cat: 'FULLSTACK', topics: SWE_T },
  { label: 'Mobile Development', cat: 'FRONTEND', topics: ['React Native', 'Flutter', 'Swift', 'Kotlin', 'Android', 'iOS'] },
  { label: 'DevOps', cat: 'DEVOPS', topics: ['Docker', 'Kubernetes', 'CI/CD', 'Terraform', 'AWS', 'Linux', 'Monitoring'] },
  { label: 'Cloud Computing', cat: 'DEVOPS', topics: ['AWS', 'Azure', 'GCP', 'Serverless', 'Networking', 'IAM'] },
  { label: 'Data Structures & Algorithms', cat: 'DSA', topics: ['Arrays', 'Strings', 'Hash Maps', 'Two Pointers', 'Sliding Window', 'Binary Search', 'Trees', 'Graphs', 'Dynamic Programming', 'Backtracking', 'Greedy'] },
  { label: 'System Design', cat: 'SYSTEM_DESIGN', topics: ['Scalability', 'Load Balancing', 'Caching', 'Databases', 'Message Queues', 'Microservices', 'Rate Limiting', 'CAP Theorem'] },
  { label: 'Machine Learning', cat: 'AI_ML', topics: AI_T },
  { label: 'Artificial Intelligence', cat: 'AI_ML', topics: AI_T },
  { label: 'Data Science', cat: 'AI_ML', topics: ['Python', 'Statistics', 'Machine Learning', 'Pandas', 'Feature Engineering', 'Model Evaluation'] },
  { label: 'Data Analytics', cat: 'DATA_ANALYTICS', topics: DA_T },
  { label: 'Business Intelligence', cat: 'DATA_ANALYTICS', topics: ['Power BI', 'Tableau', 'SQL', 'Data Warehousing', 'ETL', 'KPIs'] },
  { label: 'Cyber Security', cat: 'BACKEND', topics: ['Network Security', 'Cryptography', 'OWASP', 'Penetration Testing', 'IAM', 'Incident Response'] },
  { label: 'Database Engineering', cat: 'DATABASE', topics: ['SQL', 'PostgreSQL', 'MySQL', 'MongoDB', 'Redis', 'Indexing', 'Transactions', 'Normalization'] },
  { label: 'UI/UX', cat: 'FRONTEND', topics: ['Design Principles', 'Figma', 'Usability', 'Wireframing', 'Design Systems', 'Accessibility'] },
  { label: 'Product Management', cat: 'PRODUCT_MANAGEMENT', topics: ['Product Sense', 'Metrics', 'Prioritization', 'Roadmapping', 'A/B Testing', 'Stakeholders'] },
  { label: 'Project Management', cat: 'PRODUCT_MANAGEMENT', topics: ['Agile', 'Scrum', 'Risk', 'Stakeholders', 'Planning', 'Delivery'] },
  { label: 'QA Testing', cat: 'BACKEND', topics: ['Manual Testing', 'Automation', 'Selenium', 'Test Cases', 'API Testing', 'Performance'] },
  { label: 'Finance', cat: 'FINANCE', topics: FIN_T },
  { label: 'Accounting', cat: 'FINANCE', topics: ['Financial Accounting', 'Bookkeeping', 'Auditing', 'Taxation', 'Balance Sheets'] },
  { label: 'Investment Banking', cat: 'FINANCE', topics: ['Valuation', 'M&A', 'Financial Modeling', 'DCF', 'LBO', 'Equity Research'] },
  { label: 'Human Resources', cat: 'HR', topics: ['Recruitment', 'Employee Relations', 'Compensation', 'HR Policy', 'Performance'] },
  { label: 'Marketing', cat: 'MBA', topics: ['Digital Marketing', 'SEO', 'Branding', 'Content', 'Analytics', 'Growth'] },
  { label: 'Sales', cat: 'MBA', topics: ['B2B Sales', 'Negotiation', 'CRM', 'Pipeline', 'Objection Handling'] },
  { label: 'Operations', cat: 'MBA', topics: ['Supply Chain', 'Process Optimization', 'Logistics', 'Lean', 'Quality'] },
  { label: 'Consulting', cat: 'MBA', topics: ['Case Study', 'Guesstimates', 'Market Sizing', 'Frameworks', 'Problem Solving'] },
  { label: 'Customer Support', cat: 'HR', topics: ['Communication', 'Conflict Resolution', 'Product Knowledge', 'Empathy'] },
  { label: 'Healthcare', cat: 'MBA', topics: ['Clinical Knowledge', 'Patient Care', 'Ethics', 'Healthcare Systems'] },
  { label: 'Mechanical Engineering', cat: 'MBA', topics: ['Thermodynamics', 'Mechanics', 'Manufacturing', 'CAD', 'Materials'] },
  { label: 'Civil Engineering', cat: 'MBA', topics: ['Structures', 'Geotechnical', 'Construction', 'Surveying', 'Materials'] },
  { label: 'Electrical Engineering', cat: 'MBA', topics: ['Circuits', 'Power Systems', 'Electronics', 'Control Systems', 'Signals'] },
  { label: 'Chemical Engineering', cat: 'MBA', topics: ['Process Design', 'Thermodynamics', 'Reactions', 'Fluid Mechanics'] },
  { label: 'General Aptitude', cat: 'MBA', topics: ['Quantitative', 'Logical Reasoning', 'Verbal', 'Data Interpretation'] },
  { label: 'Behavioral Interview', cat: 'HR', topics: ['STAR Method', 'Teamwork', 'Conflict', 'Leadership', 'Failure', 'Strengths'] },
  { label: 'Leadership', cat: 'HR', topics: ['Team Management', 'Decision Making', 'Vision', 'Conflict', 'Delegation'] },
  { label: 'MBA', cat: 'MBA', topics: ['Strategy', 'Marketing', 'Finance', 'Operations', 'Case Study', 'Guesstimates'] },
  { label: 'Any Other', cat: 'MBA', topics: [] },
];
const W_TYPES = ['Coding Interview', 'Theoretical Interview', 'Mixed Interview', 'Case Study', 'Practical Scenario', 'Behavioral Interview'];
const typeToMode = (t: string): 'mixed' | 'theory' | 'coding' => (t === 'Coding Interview' ? 'coding' : t === 'Mixed Interview' ? 'mixed' : 'theory');
const THEORY_STYLES = ['Rapid Fire', 'Detailed Discussion', 'Real Company Interview', 'Concept Revision', 'Scenario Based'];
const EXPERIENCE = ['Fresher', '1-2 Years', '3-5 Years', '5-8 Years', 'Senior', 'Staff', 'Principal'];
const COMPANIES = ['Google', 'Amazon', 'Microsoft', 'Meta', 'Apple', 'Netflix', 'Uber', 'Stripe', 'Airbnb', 'Oracle', 'Salesforce', 'Deloitte', 'EY', 'KPMG', 'JPMorgan', 'Goldman Sachs', 'Startup', 'FAANG Mixed', 'Random'];
const DURATIONS = [10, 20, 30, 45, 60];
// P2 — config-driven language list. English + Hindi(+Mixed/Hinglish) are the
// only ones actually verified end-to-end (STT/TTS/prompting) today; the rest
// are real menu entries (not hidden) so the extensibility is honest and
// visible, but marked `live: false` and disabled until each is actually
// wired and tested — adding one for real later is a one-line change here,
// not a scattered one.
const LANGUAGES: { id: string; label: string; live: boolean }[] = [
  { id: 'English', label: 'English', live: true },
  { id: 'Hindi', label: 'Hindi', live: true },
  { id: 'Mixed', label: 'Hinglish (Mixed)', live: true },
  { id: 'Tamil', label: 'Tamil', live: false },
  { id: 'Telugu', label: 'Telugu', live: false },
  { id: 'Marathi', label: 'Marathi', live: false },
  { id: 'Bengali', label: 'Bengali', live: false },
  { id: 'Kannada', label: 'Kannada', live: false },
  { id: 'Gujarati', label: 'Gujarati', live: false },
  { id: 'Punjabi', label: 'Punjabi', live: false },
];

// P2 — round structure. Each wizard `wType` maps to an ordered sequence of
// rounds with a time-share of whatever's left after the intro. Deterministic
// (a client-side timer force-advances rounds — see roundStartedAtRef below),
// same "don't trust the LLM for guarantees" pattern as the intro cap.
type RoundType = 'hr' | 'technical' | 'role_scenario' | 'coding';
const ROUND_LABELS: Record<RoundType, string> = {
  hr: 'the behavioral/HR round',
  technical: 'the technical round',
  role_scenario: 'the role-scenario round',
  coding: 'the live coding round',
};
const ROUND_SEQUENCES: Record<string, { type: RoundType; share: number }[]> = {
  'Coding Interview': [{ type: 'technical', share: 0.3 }, { type: 'coding', share: 0.7 }],
  'Theoretical Interview': [{ type: 'hr', share: 0.2 }, { type: 'technical', share: 0.8 }],
  'Mixed Interview': [{ type: 'hr', share: 0.15 }, { type: 'technical', share: 0.35 }, { type: 'role_scenario', share: 0.2 }, { type: 'coding', share: 0.3 }],
  'Case Study': [{ type: 'role_scenario', share: 1 }],
  'Practical Scenario': [{ type: 'role_scenario', share: 1 }],
  'Behavioral Interview': [{ type: 'hr', share: 1 }],
};
/** Coding only makes sense for code-relevant categories — redistribute its share rather than schedule a round nobody can use. */
function computeRoundSequence(wType: string, codeEligible: boolean): { type: RoundType; share: number }[] {
  let seq = ROUND_SEQUENCES[wType] ?? ROUND_SEQUENCES['Mixed Interview'];
  if (!codeEligible) {
    const coding = seq.find((r) => r.type === 'coding');
    if (coding) {
      seq = seq.filter((r) => r.type !== 'coding');
      const totalRemaining = seq.reduce((s, r) => s + r.share, 0) || 1;
      seq = seq.map((r) => ({ ...r, share: r.share + (r.share / totalRemaining) * coding.share }));
    }
  }
  return seq;
}
const ROUND_INTRO_RESERVE_SEC = 90; // matches INTRO_CAP_MS below
/** P3 — silence during the candidate's own turn beyond this, without "give me a second" active, is flagged. */
const LONG_PAUSE_MS = 20_000;
const WIZARD_STEPS = ['Category', 'Topic', 'Type', 'Level', 'Company', 'Duration', 'Language', 'Review'];
const PERSONALITIES: { id: string; label: string }[] = [
  { id: 'friendly', label: 'Friendly' },
  { id: 'professional', label: 'Professional' },
  { id: 'strict', label: 'Strict' },
  { id: 'faang', label: 'FAANG' },
  { id: 'startup', label: 'Startup' },
  { id: 'pressure', label: 'High-pressure' },
];
const CODE_LANGUAGES = ['python', 'javascript', 'java', 'cpp', 'go', 'sql'];
const CODE_CATEGORIES = new Set(['DSA', 'BACKEND', 'FRONTEND', 'AI_ML', 'SQL', 'DATA_ANALYTICS']);
const SQL_CATEGORIES = new Set(['SQL']);

interface CodingTest { input: string; output: string; hidden: boolean }
interface CodingProblem { title: string; statement: string; inputFormat: string; outputFormat: string; starter: Record<string, string>; tests: CodingTest[] }
interface CaseResult { ordinal: number; passed: boolean; hidden: boolean; status: string; stderr?: string | null; expected?: string; actual?: string }
interface RunResult { passed: number; total: number; results: CaseResult[] }
// P5 — `ts` (wall-clock ms) on candidate turns lets the evaluation report
// deep-link into the session recording per question; optional since AI
// turns and older code paths don't need it.
interface Msg { role: 'ai' | 'you'; text: string; ts?: number }
interface Evaluation {
  overallScore: number; competencies: Record<string, number>;
  strengths: string[]; weaknesses: string[]; summary: string; recommendation: string;
  perQuestion?: { score: number; max: number; notes: string }[];
}
type Phase = 'setup' | 'lobby' | 'live' | 'evaluating' | 'result';
interface Flags {
  tabSwitch: number; eyeShift: number; multiFace: number; aiAssist: number; secondVoice: number; screen: number;
  // P3 — new detector modules.
  cameraOff: number; backgroundNoise: number; longPause: number; rapidAnswer: number; styleShift: number; devtools: number;
}
const ZERO_FLAGS: Flags = {
  tabSwitch: 0, eyeShift: 0, multiFace: 0, aiAssist: 0, secondVoice: 0, screen: 0,
  cameraOff: 0, backgroundNoise: 0, longPause: 0, rapidAnswer: 0, styleShift: 0, devtools: 0,
};
/**
 * P3 — mirrors the ProctorEventType enum (prisma/schema.prisma) for the
 * subset this room actually detects. Kept as a plain string union rather
 * than importing the Prisma enum (web app doesn't depend on @prisma/client)
 * — the backend DTO validates against the real enum, so a typo here would
 * fail loudly (400), not silently miscategorize.
 */
const FLAG_EVENT_MAP: Record<keyof Flags, { type: string; severity: 'LOW' | 'MEDIUM' | 'HIGH' }> = {
  tabSwitch: { type: 'TAB_SWITCH', severity: 'MEDIUM' },
  eyeShift: { type: 'LOOKING_AWAY', severity: 'LOW' },
  multiFace: { type: 'MULTIPLE_FACES', severity: 'HIGH' },
  aiAssist: { type: 'COPY_PASTE', severity: 'HIGH' },
  secondVoice: { type: 'AUDIO_ADDITIONAL_VOICE', severity: 'MEDIUM' },
  screen: { type: 'FULLSCREEN_EXIT', severity: 'HIGH' },
  cameraOff: { type: 'CAMERA_OFF', severity: 'HIGH' },
  backgroundNoise: { type: 'AUDIO_ANOMALY', severity: 'LOW' },
  longPause: { type: 'LONG_PAUSE', severity: 'LOW' },
  rapidAnswer: { type: 'RAPID_ANSWER', severity: 'MEDIUM' },
  styleShift: { type: 'STYLE_SHIFT', severity: 'LOW' },
  devtools: { type: 'DEVTOOLS_OPEN', severity: 'MEDIUM' },
};
// The intro/small-talk phase gets a hard wall-clock cap — after this many ms
// we force Ally to wrap it up (deterministically, not just via prompt wording)
// and unlock the Coding tab regardless of what she says next.
const INTRO_CAP_MS = 90_000;
/** Dynamic prosody — browser SpeechSynthesis has no style/stability levers like ElevenLabs, so rate/pitch is the only lever available on the fallback path (see speakBrowser). */
const BROWSER_MOOD_PARAMS: Record<string, { rate: number; pitch: number }> = {
  neutral: { rate: 1.0, pitch: 1.2 },
  warm: { rate: 0.95, pitch: 1.15 },
  curious: { rate: 1.03, pitch: 1.28 },
  firm: { rate: 1.0, pitch: 1.1 },
};
/**
 * Real-time voice — backchanneling. Short, fixed (never LLM-generated —
 * that would add latency, defeating the purpose) acknowledgement clips
 * played immediately once the candidate finishes talking, filling the dead
 * air while the real interviewer reply is still generating. Deliberately
 * routed through a separate, disposable Audio element (not the shared
 * speak()/audioRef/speakTokenRef machinery) so it can never interfere with
 * voiceState transitions — see playBackchannel below.
 */
const BACKCHANNEL_PHRASES = ['Mm-hmm.', 'I see.', 'Got it.', 'Right.', 'Okay.'];

function useHydratedAuth() {
  const { user } = useAuthStore();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return { user, hydrated };
}

function InterviewRoomInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, hydrated } = useHydratedAuth();

  const topicParam = Number(params.get('topic'));
  const hasTopicParam = Number.isInteger(topicParam) && topicParam >= 0 && topicParam < TOPICS.length;

  // Recruiter-assigned assessment: launched from /interview/<code> with config.
  const assessmentId = params.get('assessment') || null;
  const aCat = params.get('cat'); const aRole = params.get('role'); const aDiff = params.get('diff'); const aDur = params.get('dur');
  const assessmentTopic = assessmentId && aCat ? { label: aRole || 'Interview', category: aCat, topic: aRole || aCat, blurb: '' } : null;
  const resumeContextRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (assessmentId && typeof window !== 'undefined') {
      resumeContextRef.current = sessionStorage.getItem(`resume:${assessmentId}`) ?? undefined;
    }
  }, [assessmentId]);

  const [phase, setPhase] = useState<Phase>(assessmentId || hasTopicParam ? 'lobby' : 'setup');
  const [topicIdx, setTopicIdx] = useState(hasTopicParam ? topicParam : 0);
  const [difficulty, setDifficulty] = useState<(typeof DIFFICULTIES)[number]>((aDiff as any) || 'MEDIUM');
  const [durationMin, setDurationMin] = useState(aDur ? Number(aDur) : 20);
  const [numQuestions, setNumQuestions] = useState(5);
  const [personality, setPersonality] = useState('professional');
  const [interviewType, setInterviewType] = useState<'mixed' | 'theory' | 'coding'>('mixed');
  // Guided setup wizard
  const [wStep, setWStep] = useState(0);
  const [wCatIdx, setWCatIdx] = useState<number | null>(null);
  const [wTopic, setWTopic] = useState('');
  const [wType, setWType] = useState('Mixed Interview');
  const [codingCount, setCodingCount] = useState(2);
  const [theoryStyle, setTheoryStyle] = useState('Detailed Discussion');
  const [experience, setExperience] = useState('Fresher');
  const [company, setCompany] = useState('Random');
  const [language, setLanguage] = useState('English');
  const [wizardTopic, setWizardTopic] = useState<{ label: string; category: string; topic: string; blurb: string } | null>(null);

  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceState, setVoiceState] = useState<'idle' | 'speaking' | 'listening'>('idle');
  const [micOn, setMicOn] = useState(true);
  const [muted, setMuted] = useState(false);

  const [tab, setTab] = useState<'chat' | 'code'>('chat');
  const [coding, setCoding] = useState<CodingProblem | null>(null);
  const [codeLang, setCodeLang] = useState('python');
  const [codeSrc, setCodeSrc] = useState('');
  const [codeResult, setCodeResult] = useState<RunResult | null>(null);
  const [codeRunning, setCodeRunning] = useState(false);

  const [flags, setFlags] = useState<Flags>(ZERO_FLAGS);
  const [remaining, setRemaining] = useState(durationMin * 60);
  const [result, setResult] = useState<Evaluation | null>(null);
  const [report, setReport] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  // P3 §7 — consent is mandatory: gates the Start button, and the exact
  // moment it was checked is what gets logged server-side (consentedAt).
  const [consented, setConsented] = useState(false);
  const consentedAtRef = useRef<string | null>(null);
  // AI interviewer checklist — "kill your apps before entering the
  // interview." No web page can actually close another tab or terminate
  // another application (there is no browser API for it — this is a
  // deliberate security boundary, not a gap), so the honest equivalent is
  // an explicit, individually-confirmed pre-flight checklist the candidate
  // must complete before Start unlocks, same pattern proctored platforms
  // like Koyo use. The real technical backstop is what already exists:
  // fullscreen-exit / tab-switch now end the session on the 2nd occurrence
  // (see HARD_STRIKE_TYPES in proctoring.service.ts) — this screen sets
  // the expectation, that enforces it.
  const [preflight, setPreflight] = useState({ tabs: false, apps: false, space: false });
  const preflightReady = preflight.tabs && preflight.apps && preflight.space;
  // P3 §4 — camera-off specifically PAUSES (not just flags) per the spec's
  // own example: "interview pauses with a warning if camera turns off."
  const [cameraPaused, setCameraPaused] = useState(false);
  // P3 — real-time violation stream surfaces server-issued warnings back to
  // the candidate (the same messages ProctoringService.issueWarning already
  // has, now actually reaching this room instead of only existing for the
  // recruiter-assessment room).
  const [proctorNotice, setProctorNotice] = useState<string | null>(null);
  const lastWarningLevelRef = useRef(0);
  // Multi-agent panel doc — reverse interview: "Before we wrap up, I'd like
  // to give you an opportunity to interview us." Triggered by a voluntary
  // end (manual button or timer expiry) — never by a proctoring termination,
  // which stays punitive and immediate (endInterview() is called directly
  // there, bypassing this). The offer message itself is a fixed string, not
  // an LLM call — same "deterministic structural transition" discipline as
  // the intro/round caps elsewhere in this room.
  const [reverseInterviewMode, setReverseInterviewMode] = useState(false);
  const [reverseQuestionsAsked, setReverseQuestionsAsked] = useState(0);
  const REVERSE_INTERVIEW_MAX_QUESTIONS = 3;
  // Mirrors for the voice/VAD auto-send callback (defined once via a stable
  // useCallback — see startListening below), same pattern as sendingRef.
  const reverseInterviewModeRef = useRef(false);
  const reverseQuestionsAskedRef = useRef(0);
  useEffect(() => { reverseInterviewModeRef.current = reverseInterviewMode; }, [reverseInterviewMode]);
  useEffect(() => { reverseQuestionsAskedRef.current = reverseQuestionsAsked; }, [reverseQuestionsAsked]);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const displayStreamRef = useRef<MediaStream | null>(null);
  const fsHandlerRef = useRef<(() => void) | null>(null);
  // P4 — session recording. mediaRecorderRef captures a canvas-composited
  // screen + camera-PiP + mic-audio stream (see setupRecording below);
  // chunksRef accumulates Blob parts in memory until session end, then one
  // combined Blob is PUT to a presigned S3 URL. recordingUploadUrlRef is
  // fetched once, right after the session is created — null means the
  // backend has no bucket configured, so recording is skipped entirely
  // (same graceful-degrade shape as OTP/email/SMS elsewhere in this app).
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const recordingUploadUrlRef = useRef<string | null>(null);
  const recordingCompositeCleanupRef = useRef<(() => void) | null>(null);
  const recognitionRef = useRef<any>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const endedRef = useRef(false);
  const sessionIdRef = useRef<string | null>(null);
  const messagesRef = useRef<Msg[]>([]);
  const lastAiTsRef = useRef(0);
  const behaviorRef = useRef<{ turns: { thinkingMs: number; words: number }[]; hints: number }>({ turns: [], hints: 0 });
  const [behavior, setBehavior] = useState<{ avgThinkingSec: number; avgWords: number; hintsUsed: number; responses: number; tabSwitches: number } | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const voiceStateRef = useRef(voiceState);
  const flagCooldown = useRef<Record<string, number>>({});
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // P3 — longPause: last time the candidate's own turn produced real speech
  // input, reset on every candidate turn sent; styleShift: a rolling
  // baseline of the candidate's own answer complexity, established from
  // their first few real answers, compared against later ones.
  const lastSpeechAtRef = useRef<number>(0);
  const answerComplexityBaselineRef = useRef<number[]>([]);
  const sendingRef = useRef(false);
  const micOnRef = useRef(micOn);
  const introStartedAtRef = useRef<number | null>(null);
  const introForceSentRef = useRef(false);
  const forceAdvanceConsumedRef = useRef(false);
  const [introForced, setIntroForced] = useState(false);
  // P2 — round structure. roundIndex advances deterministically on a
  // per-round timer (started once the intro completes, not before); the
  // pending flag mirrors introForced's shape exactly, one flag consumed per
  // forced advance.
  const roundStartedAtRef = useRef<number | null>(null);
  const roundForceSentRef = useRef(false);
  const roundAdvanceConsumedRef = useRef(false);
  const [roundIndex, setRoundIndex] = useState(0);
  const [roundForced, setRoundForced] = useState(false);
  const [thinking, setThinking] = useState(false); // "give me a second" — suppresses VAD auto-send without penalty
  const thinkingRef = useRef(false);
  // Real neural TTS (ElevenLabs, via POST /voice/speak) — see the speak()
  // callback below. audioRef holds the currently-playing clip; speakTokenRef
  // is a monotonic race guard so a superseded, still-in-flight speak() call
  // detects it lost the race and doesn't also start playback (mirrors HYRTE's
  // hyrte/session/[id]/interview/page.tsx, which fixed this exact class of
  // echo/overlap bug first).
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const speakTokenRef = useRef(0);
  /** Separate from audioRef/speakTokenRef on purpose — see playBackchannel. */
  const backchannelAudioRef = useRef<HTMLAudioElement | null>(null);

  const topic = wizardTopic ?? assessmentTopic ?? TOPICS[topicIdx];
  useEffect(() => { messagesRef.current = messages; }, [messages]);
  useEffect(() => { voiceStateRef.current = voiceState; }, [voiceState]);
  useEffect(() => { sendingRef.current = sending; }, [sending]);
  useEffect(() => { micOnRef.current = micOn; }, [micOn]);
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);
  const cameraPausedRef = useRef(false);
  useEffect(() => { cameraPausedRef.current = cameraPaused; }, [cameraPaused]);
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, sending]);

  useEffect(() => {
    if (hydrated && !user) {
      const nextPath = `/candidate/interview${hasTopicParam ? `?topic=${topicParam}` : ''}`;
      router.replace(`/signup?next=${encodeURIComponent(nextPath)}`);
    }
  }, [hydrated, user, router, hasTopicParam, topicParam]);

  const teardown = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    try { recognitionRef.current?.stop?.(); } catch {}
    recognitionRef.current = null;
    try { window.speechSynthesis?.cancel(); } catch {}
    if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {} audioRef.current = null; }
    if (backchannelAudioRef.current) { try { backchannelAudioRef.current.pause(); } catch {} backchannelAudioRef.current = null; }
    audioCtxRef.current?.close?.().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    displayStreamRef.current?.getTracks().forEach((t) => t.stop());
    displayStreamRef.current = null;
    if (fsHandlerRef.current) { document.removeEventListener('fullscreenchange', fsHandlerRef.current); fsHandlerRef.current = null; }
    try { if (document.fullscreenElement) document.exitFullscreen?.(); } catch {}
  }, []);
  useEffect(() => () => teardown(), [teardown]);

  // Warm up the speech-synthesis voice list so Ally's voice is ready.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const h = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.('voiceschanged', h);
    return () => window.speechSynthesis.removeEventListener?.('voiceschanged', h);
  }, []);

  function bumpFlag(key: keyof Flags, cooldownMs = 1500) {
    const now = Date.now();
    if (now - (flagCooldown.current[key] ?? 0) < cooldownMs) return;
    flagCooldown.current[key] = now;
    setFlags((f) => ({ ...f, [key]: f[key] + 1 }));

    // P3 — real-time violation event stream: previously every flag only
    // lived in this React state until the session completed (or was lost
    // entirely if the tab closed first) — completeSession then wrote one
    // aggregate ProctorEvent per type. Now each violation is persisted +
    // risk-scored the moment it happens, via the same ProctoringService
    // that already backs the recruiter-assessment room; a failed POST here
    // never disrupts the interview itself (candidate-facing UX always wins
    // over telemetry delivery).
    const sid = sessionIdRef.current;
    const map = FLAG_EVENT_MAP[key];
    if (!sid || !map) return;
    api
      .post<{ warningLevel: number; terminated: boolean; policy: string }>('/proctoring/events', {
        sessionId: sid,
        type: map.type,
        severity: map.severity,
      })
      .then((res) => {
        // Lockdown violations (leaving fullscreen, switching tabs) get their
        // own honest, specific wording — the backend's hard-strike override
        // (proctoring.service.ts's HARD_STRIKE_TYPES) ends the session on the
        // 2nd occurrence, so the candidate should know exactly why, not read
        // the same generic "unusual activity" text used for ambient noise.
        const isLockdownViolation = key === 'screen' || key === 'tabSwitch';
        if (res.terminated) {
          setProctorNotice(
            isLockdownViolation
              ? 'Your interview has ended — you left the interview window or exited fullscreen more than once.'
              : 'Your session has been ended due to repeated integrity violations.',
          );
          endInterview();
          return;
        }
        if (res.warningLevel > 0 && res.warningLevel > lastWarningLevelRef.current) {
          lastWarningLevelRef.current = res.warningLevel;
          setProctorNotice(
            isLockdownViolation
              ? 'Stay in fullscreen and on this tab for the rest of the interview — leaving again will end your session immediately.'
              : res.warningLevel >= 2
                ? 'Final warning — further violations may pause or end your session.'
                : 'We noticed unusual activity. Please stay focused on the interview.',
          );
        }
      })
      .catch(() => {});
  }

  /**
   * P4 — session recording. Composites the screen-share track (full frame)
   * with the camera track as a picture-in-picture overlay onto a canvas,
   * captures THAT as a video stream (the standard technique for combining
   * two independent MediaStreams into one recording), adds the candidate's
   * mic audio, and records the whole thing with MediaRecorder. Chunks
   * accumulate in memory (recorder.start(10_000) — 10s granularity) and
   * upload as one Blob at session end; a real, known limitation: a browser
   * crash mid-session loses whatever wasn't uploaded yet, since nothing is
   * streamed incrementally to S3 in this pass. Silently does nothing if
   * either stream is missing or the backend has no bucket configured
   * (recordingUploadUrlRef stays null) — recording is enhancement, never a
   * requirement for the interview itself to work.
   */
  function setupRecording(sessionId: string) {
    try {
      const screenStream = displayStreamRef.current;
      const camStream = streamRef.current;
      if (!screenStream || !camStream || typeof MediaRecorder === 'undefined') return;

      const canvas = document.createElement('canvas');
      canvas.width = 1280; canvas.height = 720;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const screenVideo = document.createElement('video');
      screenVideo.srcObject = screenStream; screenVideo.muted = true; screenVideo.playsInline = true;
      screenVideo.play().catch(() => {});
      const camVideo = document.createElement('video');
      camVideo.srcObject = camStream; camVideo.muted = true; camVideo.playsInline = true;
      camVideo.play().catch(() => {});

      // setInterval, not requestAnimationFrame: rAF fully stops in a
      // backgrounded tab (verified live — a browser-automation session with
      // document.hidden=true never painted a single frame, confirming this
      // is a real behavior, not a hypothetical). A candidate briefly
      // switching tabs (already flagged separately as tabSwitch) shouldn't
      // also silently freeze their recording for that whole span — setInterval
      // keeps running in background tabs too (throttled to ~1/sec by the
      // browser in the worst case, but never fully paused like rAF is).
      const draw = () => {
        try {
          ctx.drawImage(screenVideo, 0, 0, canvas.width, canvas.height);
          const pipW = 200, pipH = 150, pad = 12;
          ctx.drawImage(camVideo, canvas.width - pipW - pad, canvas.height - pipH - pad, pipW, pipH);
        } catch {}
      };
      const drawInterval = setInterval(draw, 1000 / 15);
      draw();

      const canvasStream = (canvas as HTMLCanvasElement & { captureStream: (fps?: number) => MediaStream }).captureStream(15);
      const micTrack = camStream.getAudioTracks()[0];
      const combined = new MediaStream([...canvasStream.getVideoTracks(), ...(micTrack ? [micTrack] : [])]);

      const mimeType = ['video/webm;codecs=vp8,opus', 'video/webm'].find((t) => MediaRecorder.isTypeSupported?.(t)) || 'video/webm';
      const recorder = new MediaRecorder(combined, { mimeType });
      chunksRef.current = [];
      recorder.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      recorder.start(10_000);
      mediaRecorderRef.current = recorder;
      recordingCompositeCleanupRef.current = () => { clearInterval(drawInterval); };

      // Fetch the upload URL now, in parallel with the rest of the room
      // loading — ready well before it's actually needed at session end.
      api.post<{ uploadUrl: string | null }>(`/practice/session/${sessionId}/recording-upload-url`)
        .then((res) => { recordingUploadUrlRef.current = res.uploadUrl; })
        .catch(() => { recordingUploadUrlRef.current = null; });
    } catch {}
  }

  /** Stops the recorder, combines the accumulated chunks, and PUTs the result to S3 — never blocks or fails the interview's own completion. */
  async function finishRecordingAndUpload(sessionId: string) {
    const recorder = mediaRecorderRef.current;
    if (recorder) {
      try {
        await new Promise<void>((resolve) => {
          recorder.onstop = () => resolve();
          if (recorder.state !== 'inactive') recorder.stop(); else resolve();
        });
      } catch {}
    }
    recordingCompositeCleanupRef.current?.();
    recordingCompositeCleanupRef.current = null;
    mediaRecorderRef.current = null;

    const uploadUrl = recordingUploadUrlRef.current;
    if (!uploadUrl || chunksRef.current.length === 0) return;
    try {
      const blob = new Blob(chunksRef.current, { type: 'video/webm' });
      chunksRef.current = [];
      await fetch(uploadUrl, { method: 'PUT', headers: { 'content-type': 'video/webm' }, body: blob });
      await api.post(`/practice/session/${sessionId}/recording-complete`);
    } catch {}
  }

  /** Last-resort fallback only — robotic by nature, used only if the real ElevenLabs call fails (network issue, TTS temporarily unavailable). */
  const speakBrowser = useCallback((clean: string, token: number, mood: string) => {
    const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;
    if (!synth) { if (speakTokenRef.current === token) { lastSpeechAtRef.current = Date.now(); setVoiceState('listening'); } return; }
    const u = new SpeechSynthesisUtterance(clean);
    // Prefer a LOCAL female English voice — remote/network voices often play
    // silently. Fall back to any local English voice, then the system default.
    const voices = synth.getVoices();
    const en = voices.filter((v) => v.lang?.toLowerCase().startsWith('en'));
    const local = en.filter((v) => (v as any).localService !== false);
    const femaleNames = ['samantha', 'karen', 'moira', 'tessa', 'fiona', 'victoria', 'serena', 'zira', 'aria', 'female'];
    const pick = local.find((v) => femaleNames.some((n) => v.name.toLowerCase().includes(n)))
      ?? local[0] ?? en[0];
    if (pick) u.voice = pick;
    const params = BROWSER_MOOD_PARAMS[mood] ?? BROWSER_MOOD_PARAMS.neutral;
    u.rate = params.rate;
    u.pitch = params.pitch;
    u.onend = () => { if (speakTokenRef.current === token) { lastSpeechAtRef.current = Date.now(); setVoiceState('listening'); } };
    u.onerror = () => { if (speakTokenRef.current === token) { lastSpeechAtRef.current = Date.now(); setVoiceState('listening'); } };
    if (speakTokenRef.current !== token) return; // a superseding speak() call already won the race
    try { synth.resume(); } catch {}
    synth.cancel();
    // Small delay avoids the Chrome bug where speak() right after cancel() is dropped.
    setTimeout(() => {
      if (speakTokenRef.current !== token) return;
      try { synth.speak(u); } catch { if (speakTokenRef.current === token) setVoiceState('listening'); }
    }, 60);
  }, []);

  /**
   * Real neural synthesis (ElevenLabs, via POST /voice/speak) — browser
   * SpeechSynthesis is a hard ceiling on how human it can ever sound, no
   * amount of pitch/rate tuning changes that, so it's a fallback only (see
   * speakBrowser above), not the primary path. Ported from HYRTE's
   * hyrte/session/[id]/interview/page.tsx, which already carries this fix —
   * this room (the main product surface) had been left on browser TTS the
   * whole time.
   */
  const speak = useCallback(async (text: string, mood: string = 'neutral') => {
    // Stop anything already playing/queued BEFORE deciding whether to speak
    // at all, and mint a token so a slower, now-superseded call can tell it
    // lost the race and must not also start playback. Also stop a
    // still-playing backchannel clip (rare — it's short and usually finishes
    // well before the real reply arrives, but defensive here costs nothing).
    if (audioRef.current) { try { audioRef.current.pause(); audioRef.current.currentTime = 0; } catch {} audioRef.current = null; }
    if (backchannelAudioRef.current) { try { backchannelAudioRef.current.pause(); } catch {} backchannelAudioRef.current = null; }
    try { window.speechSynthesis?.cancel(); } catch {}
    const token = ++speakTokenRef.current;
    // strip emoji/markdown for cleaner TTS
    const clean = text.replace(/[#*`_>]/g, '').replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '');
    if (muted) { setVoiceState('listening'); return; }
    setVoiceState('speaking');
    try {
      const authToken = useAuthStore.getState().accessToken;
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ text: clean, mood }),
      });
      if (speakTokenRef.current !== token) return; // superseded while the network call was in flight
      if (!res.ok) throw new Error(`tts ${res.status}`);
      const blob = await res.blob();
      if (speakTokenRef.current !== token) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); if (speakTokenRef.current === token) { lastSpeechAtRef.current = Date.now(); setVoiceState('listening'); } };
      audio.onerror = () => { URL.revokeObjectURL(url); if (speakTokenRef.current === token) speakBrowser(clean, token, mood); };
      await audio.play();
    } catch {
      if (speakTokenRef.current === token) speakBrowser(clean, token, mood);
    }
  }, [muted, speakBrowser]);

  /**
   * Fires immediately once the candidate's turn is submitted, before the
   * real (slower) interviewer reply comes back — a short "mm-hmm"/"I see"
   * clip so the candidate hears the interviewer is actually there during the
   * LLM round-trip, instead of dead air. Never awaited by its caller
   * (fire-and-forget) and fails silently — this is a decorative UX cue, not
   * essential, and must never block or error out the real turn submission.
   */
  const playBackchannel = useCallback(async () => {
    if (muted || voiceStateRef.current !== 'listening') return;
    try {
      const authToken = useAuthStore.getState().accessToken;
      const phrase = BACKCHANNEL_PHRASES[Math.floor(Math.random() * BACKCHANNEL_PHRASES.length)];
      const res = await fetch('/api/voice/speak', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(authToken ? { authorization: `Bearer ${authToken}` } : {}) },
        body: JSON.stringify({ text: phrase, mood: 'neutral' }),
      });
      if (!res.ok) return;
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      backchannelAudioRef.current = audio;
      audio.onended = () => URL.revokeObjectURL(url);
      audio.onerror = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch {
      // decorative only — never surfaces an error
    }
  }, [muted]);

  const startListening = useCallback(() => {
    const Ctor = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!Ctor || !micOnRef.current) return;
    try { recognitionRef.current?.stop?.(); } catch {}
    const rec = new Ctor();
    rec.continuous = true; rec.interimResults = true; rec.lang = 'en-US';
    let finalChunk = '';
    rec.onresult = (e: any) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalChunk += r[0].transcript + ' '; else interim += r[0].transcript;
      }
      const text = (finalChunk + interim).trim();
      const words = text.split(/\s+/).filter(Boolean).length;
      setInput(text);
      if (text) lastSpeechAtRef.current = Date.now();
      // P2 — patient listening: "give me a second" (thinkingRef) suppresses
      // the ~1s VAD auto-send entirely, no penalty — the candidate resumes
      // it explicitly (see the toggle button) rather than a timeout deciding
      // for them.
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        if (text && words >= 1 && !sendingRef.current && !thinkingRef.current && voiceStateRef.current === 'listening') {
          submitTextRef.current?.(text);
          finalChunk = '';
        }
      }, 1000);
    };
    rec.onerror = () => {};
    recognitionRef.current = rec;
    try { rec.start(); } catch {}
  }, []);

  // Mic runs ONLY on the candidate's turn — never while Ally speaks (otherwise
  // the mic hears her through the speakers and cuts her off / makes her silent).
  useEffect(() => {
    if (phase !== 'live') return;
    if (voiceState === 'listening' && micOn && tab === 'chat') startListening();
    else { const r = recognitionRef.current; recognitionRef.current = null; try { r?.stop?.(); } catch {} }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceState, phase, micOn, tab, startListening]);

  // P2 — round structure. Computed once (wType/category don't change after
  // the wizard is done, i.e. for the whole 'live' phase), so it's safe for
  // the timer effect below to close over it directly — only roundIndex
  // itself needs a ref, since it changes during the session and the effect's
  // deps are intentionally just [phase] (same reasoning as introStartedAtRef
  // above: don't restart the interval every render).
  const activeRoundSequence = useMemo(() => computeRoundSequence(wType, CODE_CATEGORIES.has(topic.category)), [wType, topic.category]);
  const roundIndexRef = useRef(0);
  useEffect(() => { roundIndexRef.current = roundIndex; }, [roundIndex]);

  // timer
  useEffect(() => {
    if (phase !== 'live') return;
    const iv = setInterval(() => {
      // P3 §4 — camera-off genuinely PAUSES: the countdown itself stops
      // ticking while the camera is off, not just a flag in the background.
      if (!cameraPausedRef.current) {
        setRemaining((r) => { if (r <= 1) { clearInterval(iv); offerReverseInterview(); return 0; } return r - 1; });
      }
      if (introStartedAtRef.current && !introForceSentRef.current && Date.now() - introStartedAtRef.current >= INTRO_CAP_MS) {
        introForceSentRef.current = true;
        setIntroForced(true);
      }
      if (roundStartedAtRef.current && !roundForceSentRef.current) {
        const idx = roundIndexRef.current;
        const roundEligibleSec = Math.max(30, durationMin * 60 - ROUND_INTRO_RESERVE_SEC);
        const share = activeRoundSequence[idx]?.share ?? 0;
        const budgetSec = share * roundEligibleSec;
        const elapsedSec = (Date.now() - roundStartedAtRef.current) / 1000;
        if (elapsedSec >= budgetSec && idx < activeRoundSequence.length - 1) {
          roundForceSentRef.current = true;
          setRoundForced(true);
        }
      }
      // P3 — long unnatural pause: only during the candidate's own turn, and
      // only when they haven't opted into "give me a second" (P2's
      // thinkingRef) — using that affordance is explicitly never penalized.
      if (voiceStateRef.current === 'listening' && !thinkingRef.current && lastSpeechAtRef.current && Date.now() - lastSpeechAtRef.current >= LONG_PAUSE_MS) {
        bumpFlag('longPause', LONG_PAUSE_MS);
      }
    }, 1000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);


  // proctoring: tab / focus
  useEffect(() => {
    if (phase !== 'live') return;
    const onHidden = () => { if (document.hidden) bumpFlag('tabSwitch'); };
    const onBlur = () => bumpFlag('tabSwitch');
    document.addEventListener('visibilitychange', onHidden);
    window.addEventListener('blur', onBlur);
    return () => { document.removeEventListener('visibilitychange', onHidden); window.removeEventListener('blur', onBlur); };
  }, [phase]);

  // proctoring: face/gaze via FaceDetector
  useEffect(() => {
    if (phase !== 'live') return;
    const FD = (window as any).FaceDetector;
    if (!FD || !videoRef.current) return;
    const detector = new FD({ fastMode: true, maxDetectedFaces: 3 });
    let stop = false;
    const loop = async () => {
      if (stop || !videoRef.current) return;
      try {
        const faces = await detector.detect(videoRef.current);
        if (faces.length === 0) bumpFlag('eyeShift', 4000);
        else if (faces.length > 1) bumpFlag('multiFace', 4000);
        else {
          const box = faces[0].boundingBox;
          const cx = box.x + box.width / 2; const w = videoRef.current.videoWidth || 640;
          if (cx < w * 0.28 || cx > w * 0.72) bumpFlag('eyeShift', 4000);
        }
      } catch {}
      setTimeout(loop, 1200);
    };
    loop();
    return () => { stop = true; };
  }, [phase]);

  // P3 §4 — camera-off detector. Distinct from FaceDetector's "no face in
  // frame" above (eyeShift) — this watches the actual hardware TRACK state
  // (disabled/muted/ended), which is what the spec's own example means by
  // "interview pauses with a warning if camera turns off." Polling + event
  // listeners together because `track.enabled` toggling doesn't reliably
  // fire mute/unmute across browsers.
  useEffect(() => {
    if (phase !== 'live') return;
    const track = streamRef.current?.getVideoTracks()?.[0];
    if (!track) return;
    const check = () => {
      const off = !track.enabled || track.readyState === 'ended' || (track as any).muted;
      setCameraPaused(off);
      if (off) bumpFlag('cameraOff', 3000);
    };
    track.addEventListener('ended', check);
    track.addEventListener('mute', check);
    track.addEventListener('unmute', check);
    const iv = setInterval(check, 2000);
    return () => { track.removeEventListener('ended', check); track.removeEventListener('mute', check); track.removeEventListener('unmute', check); clearInterval(iv); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  // P3 — devtools-open heuristic: a real, documented (if imperfect) window-
  // size-delta technique — an open devtools panel measurably shrinks
  // inner vs outer window dimensions. Not claimed to be foolproof (spec's
  // own "signal, never verdict" framing applies here too).
  useEffect(() => {
    if (phase !== 'live') return;
    const THRESHOLD = 160;
    const iv = setInterval(() => {
      const widthDelta = window.outerWidth - window.innerWidth;
      const heightDelta = window.outerHeight - window.innerHeight;
      if (widthDelta > THRESHOLD || heightDelta > THRESHOLD) bumpFlag('devtools', 10_000);
    }, 2000);
    return () => clearInterval(iv);
  }, [phase]);

  const integrity = useMemo(() => {
    const p =
      flags.tabSwitch * 6 + flags.eyeShift * 3 + flags.multiFace * 12 + flags.aiAssist * 10 + flags.secondVoice * 8 + flags.screen * 10 +
      flags.cameraOff * 10 + flags.backgroundNoise * 3 + flags.longPause * 2 + flags.rapidAnswer * 6 + flags.styleShift * 4 + flags.devtools * 8;
    return Math.max(0, 100 - p);
  }, [flags]);

  // Intro is structurally done once Ally has spoken twice (greeting, then the
  // post-intro "here's today's focus" message) — or once the hard time cap
  // below forces it, whichever comes first. The Coding tab stays gated until then.
  const introComplete = introForced || messages.filter((m) => m.role === 'ai').length >= 2;

  // Round tracking starts the moment the intro completes, not before — the
  // intro's own cap already governs that phase.
  useEffect(() => {
    if (introComplete && roundStartedAtRef.current === null) {
      roundStartedAtRef.current = Date.now();
    }
  }, [introComplete]);

  // ── conversational turn ──
  const sendTurn = useCallback(async (candidateText?: string, opts?: { end?: boolean; behaviorSummary?: string; reverseInterviewQuestion?: boolean }) => {
    const base = messagesRef.current.slice();
    if (candidateText && candidateText.trim()) {
      const trimmed = candidateText.trim();
      base.push({ role: 'you', text: trimmed, ts: Date.now() });
      // Behavior signals: thinking time (since the AI finished) + answer length.
      const thinkingMs = lastAiTsRef.current ? Date.now() - lastAiTsRef.current : 0;
      const words = trimmed.split(/\s+/).filter(Boolean).length;
      behaviorRef.current.turns.push({ thinkingMs, words });
      // P2 — hint usage is now a server-authoritative signal (see hintLevel
      // below), not a client-side guess from the CANDIDATE's own wording.

      // P3 — rapid answer: a real, honestly-scoped latency-implausibility
      // heuristic (not claiming to read "perplexity" — that needs an LLM
      // call per turn this pass doesn't add). A long answer arriving far
      // faster than a human could genuinely compose/speak it, distinct from
      // (and complementary to) the existing paste-event detector, which
      // only fires on an actual clipboard paste — this catches content that
      // arrived implausibly fast some other way (e.g. read aloud from a
      // second screen).
      if (words >= 30 && thinkingMs > 0 && thinkingMs < 3000) bumpFlag('rapidAnswer', 10_000);

      // P3 — style shift: a coarse, text-only proxy (average word length)
      // for a sudden shift in the candidate's own answer complexity vs
      // their own established baseline. Deliberately NOT claiming to detect
      // accent or genuine "read-like" audio delivery — that needs real
      // audio prosody analysis, not feasible client-side with available
      // browser APIs, so it's honestly not attempted here (see the
      // STYLE_SHIFT schema comment).
      if (words >= 5) {
        const letters = trimmed.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
        const avgWordLen = letters.length ? letters.reduce((s, w) => s + w.length, 0) / letters.length : 0;
        const baseline = answerComplexityBaselineRef.current;
        if (baseline.length >= 2) {
          const baseAvg = baseline.reduce((a, b) => a + b, 0) / baseline.length;
          if (baseAvg > 0 && Math.abs(avgWordLen - baseAvg) / baseAvg > 0.6) bumpFlag('styleShift', 10_000);
        }
        if (baseline.length < 6) baseline.push(avgWordLen);
      }
    }
    setMessages(base);
    setInput('');
    setSending(true);
    // Real-time voice — backchanneling: fire immediately (fire-and-forget,
    // never awaited) so it plays while the real reply is still generating.
    // Only for a genuine mid-interview candidate answer — not the initial
    // empty-transcript kickoff call, and not the closing turn (which already
    // has its own deterministic "putting your report together" messaging).
    if (candidateText && candidateText.trim() && !opts?.end) void playBackchannel();
    const shouldForceAdvance = introForced && !forceAdvanceConsumedRef.current && !opts?.end;
    if (shouldForceAdvance) forceAdvanceConsumedRef.current = true;
    // P2 — round structure: only fires once intro-advance is out of the way
    // (never both in the same turn — the intro cap and round cap govern
    // different phases and shouldn't compete for the same reply).
    const shouldForceRoundAdvance = !shouldForceAdvance && roundForced && !roundAdvanceConsumedRef.current && !opts?.end;
    if (shouldForceRoundAdvance) roundAdvanceConsumedRef.current = true;
    const idx = roundIndexRef.current;
    const nextRound = shouldForceRoundAdvance ? activeRoundSequence[idx + 1] : undefined;
    try {
      const res = await api.post<{ text: string; hintLevel?: number; mood?: string }>('/practice/interview/turn', {
        jobRole: topic.label, category: topic.category, difficulty, topic: topic.topic,
        count: numQuestions, personality, mode: interviewType, experience, company, language, style: theoryStyle,
        candidateName: user?.fullName?.split(' ')[0], resumeContext: resumeContextRef.current,
        transcript: base.map((m) => ({ role: m.role === 'ai' ? 'interviewer' : 'candidate', content: m.text })),
        end: opts?.end ?? false, behaviorSummary: opts?.behaviorSummary,
        reverseInterviewQuestion: opts?.reverseInterviewQuestion ?? false,
        forceAdvance: shouldForceAdvance,
        currentRound: activeRoundSequence[idx] ? { type: activeRoundSequence[idx].type, label: ROUND_LABELS[activeRoundSequence[idx].type] } : undefined,
        nextRoundLabel: nextRound ? ROUND_LABELS[nextRound.type] : undefined,
        forceRoundAdvance: shouldForceRoundAdvance,
      });
      if (typeof res.hintLevel === 'number') behaviorRef.current.hints++;
      if (shouldForceRoundAdvance) {
        // Advance to the next round and restart its own timer, mirroring the
        // intro cap's own reset-per-phase shape.
        setRoundIndex((i) => Math.min(i + 1, activeRoundSequence.length - 1));
        roundStartedAtRef.current = Date.now();
        roundForceSentRef.current = false;
        roundAdvanceConsumedRef.current = false;
        setRoundForced(false);
      }
      if (opts?.end) return res.text;
      setMessages((m) => [...m, { role: 'ai', text: res.text }]);
      speak(res.text, res.mood);
      lastAiTsRef.current = Date.now();
      return res.text;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The interviewer could not respond.');
      return '';
    } finally {
      setSending(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topic, difficulty, numQuestions, personality, interviewType, experience, company, language, theoryStyle, user, speak, playBackchannel, introForced, roundForced, activeRoundSequence]);
  /**
   * Shared candidate-text dispatch — routes through the reverse-interview
   * branch when active. Both the Send button (via onSend) and the voice/VAD
   * auto-send path (via submitTextRef, since that callback is defined once
   * with startListening's stable useCallback and would otherwise close over
   * a stale reverseInterviewMode) go through this single place, so a
   * candidate asking their reverse-interview questions by voice gets the
   * same flag + question cap as one who types them.
   */
  function submitText(text: string) {
    if (!text.trim() || sendingRef.current) return;
    if (reverseInterviewModeRef.current) {
      if (reverseQuestionsAskedRef.current >= REVERSE_INTERVIEW_MAX_QUESTIONS) return;
      setReverseQuestionsAsked((n) => n + 1);
      sendTurn(text, { reverseInterviewQuestion: true });
      return;
    }
    sendTurn(text);
  }
  const submitTextRef = useRef(submitText);
  useEffect(() => { submitTextRef.current = submitText; });

  function onSend() {
    submitText(input);
  }

  async function runCode() {
    if (!coding) return;
    setCodeRunning(true); setCodeResult(null);
    try {
      const res = await api.post<RunResult>('/practice/coding/run', { language: codeLang, code: codeSrc, tests: coding.tests });
      setCodeResult(res);
    } catch (err) { setError(err instanceof Error ? err.message : 'Code run failed'); }
    finally { setCodeRunning(false); }
  }

  function shareCode() {
    const pass = codeResult ? `(${codeResult.passed}/${codeResult.total} tests passed)` : '(not run yet)';
    setTab('chat');
    sendTurn(`Here is my ${codeLang} solution ${pass}. Please review it:\n\n${codeSrc}`);
  }

  async function start() {
    // P3 §7 — consent is mandatory, enforced here (not just a disabled
    // button — a defensive re-check in case anything ever calls start()
    // directly). consentedAtRef is set the moment the checkbox is checked,
    // not "now", so it's the real moment consent was given, not the moment
    // the room happened to finish loading camera/mic.
    if (!consented || !consentedAtRef.current) {
      setError('Please confirm you consent to monitoring before starting.');
      return;
    }
    // Unlock speech synthesis inside the click gesture — otherwise the first
    // spoken line (which fires after async awaits) is blocked and stays silent.
    try {
      const synth = window.speechSynthesis;
      if (synth) { synth.cancel(); const warm = new SpeechSynthesisUtterance(' '); warm.volume = 0; synth.speak(warm); }
    } catch {}
    setError(''); setLoading(true);
    setFlags(ZERO_FLAGS); setMessages([]); setInput(''); setReport('');
    endedRef.current = false;
    introStartedAtRef.current = null;
    introForceSentRef.current = false;
    forceAdvanceConsumedRef.current = false;
    setIntroForced(false);
    // P3 — reset detector state for a fresh session.
    answerComplexityBaselineRef.current = [];
    lastSpeechAtRef.current = 0;
    lastWarningLevelRef.current = 0;
    setProctorNotice(null);
    setCameraPaused(false);
    // P4 — reset recording state for a fresh session.
    chunksRef.current = [];
    recordingUploadUrlRef.current = null;
    mediaRecorderRef.current = null;
    recordingCompositeCleanupRef.current = null;
    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(window.isSecureContext ? 'Camera/microphone are not available in this browser.' : 'Camera & mic need a secure (HTTPS) connection. Open this site over https:// and allow permissions.');
      }
      // Require full-screen screen sharing — proctored exams monitor the whole
      // screen. Do this first while we still have the click gesture.
      if ((navigator.mediaDevices as any).getDisplayMedia) {
        try {
          const display = await (navigator.mediaDevices as any).getDisplayMedia({ video: { displaySurface: 'monitor' }, audio: false });
          displayStreamRef.current = display;
          const track = display.getVideoTracks()[0];
          // Warn if they shared just a tab/window instead of the whole screen.
          if (track && (track.getSettings?.().displaySurface && track.getSettings().displaySurface !== 'monitor')) {
            bumpFlag('screen', 8000);
          }
          track?.addEventListener('ended', () => { if (!endedRef.current) bumpFlag('screen', 0); });
        } catch {
          throw new Error('Screen sharing is required for this proctored interview. Please click Start again and share your entire screen.');
        }
      }
      // Go fullscreen and flag if they leave it.
      try { await (document.documentElement as any).requestFullscreen?.(); } catch {}
      const onFsChange = () => { if (!document.fullscreenElement && !endedRef.current) bumpFlag('screen', 1500); };
      document.addEventListener('fullscreenchange', onFsChange);
      fsHandlerRef.current = onFsChange;

      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      streamRef.current = stream;
      try {
        const Ctx = (window as any).AudioContext ?? (window as any).webkitAudioContext;
        const ctx: AudioContext = new Ctx(); audioCtxRef.current = ctx;
        const src = ctx.createMediaStreamSource(stream); const analyser = ctx.createAnalyser();
        analyser.fftSize = 512; src.connect(analyser);
        const buf = new Uint8Array(analyser.frequencyBinCount); let loud = 0; let ambientHigh = 0;
        const meter = () => {
          if (endedRef.current) return;
          analyser.getByteTimeDomainData(buf);
          let sum = 0; for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
          const rms = Math.sqrt(sum / buf.length);
          if (voiceStateRef.current === 'speaking' && rms > 0.14) { loud++; if (loud > 25) { bumpFlag('secondVoice', 6000); loud = 0; } } else loud = Math.max(0, loud - 1);
          // P3 — background noise: a lower, longer-SUSTAINED threshold than
          // secondVoice's short loud burst — a fan, traffic, or room chatter
          // during the candidate's own turn, not a discrete second speaker.
          if (voiceStateRef.current === 'listening' && rms > 0.06 && rms <= 0.14) { ambientHigh++; if (ambientHigh > 150) { bumpFlag('backgroundNoise', 15_000); ambientHigh = 0; } } else ambientHigh = Math.max(0, ambientHigh - 1);
          requestAnimationFrame(meter);
        };
        meter();
      } catch {}

      try {
        const s = await api.post<{ sessionId: string }>('/practice/session', { category: topic.category, difficulty, topic: topic.topic, jobRole: topic.label, interviewId: assessmentId ?? undefined, consentedAt: consentedAtRef.current });
        sessionIdRef.current = s.sessionId;
        setupRecording(s.sessionId);
      } catch { sessionIdRef.current = null; }

      if (interviewType !== 'theory' && CODE_CATEGORIES.has(topic.category)) {
        const kind = SQL_CATEGORIES.has(topic.category) ? 'sql' : 'code';
        try {
          const prob = await api.post<CodingProblem>('/practice/coding/generate', { topic: topic.topic, difficulty, kind });
          if (prob?.tests?.length) {
            setCoding(prob);
            const langs = Object.keys(prob.starter ?? {});
            const lang = prob.starter?.python ? 'python' : langs[0] ?? 'python';
            setCodeLang(lang); setCodeSrc(prob.starter?.[lang] ?? '');
          }
        } catch {}
      }
      setRemaining(durationMin * 60);
      setPhase('live');
      introStartedAtRef.current = Date.now();
      sendTurn(); // AI greeting + asks for intro
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not access camera/microphone.');
      setPhase('lobby'); teardown();
    } finally { setLoading(false); }
  }

  useEffect(() => {
    if (phase === 'live' && videoRef.current && streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [phase]);

  function endInterview() { if (!endedRef.current) finalize(); }

  /** Multi-agent panel doc — offer the candidate a chance to ask questions before actually ending. Voluntary ends only; proctoring termination calls endInterview() directly. */
  function offerReverseInterview() {
    if (endedRef.current || reverseInterviewMode) return;
    setReverseInterviewMode(true);
    setMessages((m) => [
      ...m,
      { role: 'ai', text: "Before we wrap up, I'd like to give you a chance to ask me anything about the role, the team, or the company — up to a few questions. Or just click Finish whenever you're ready." },
    ]);
  }

  async function finalize() {
    if (endedRef.current) return;
    endedRef.current = true;
    setPhase('evaluating');
    try { recognitionRef.current?.stop?.(); } catch {}
    // P4 — stop recording and upload before teardown() releases the media
    // streams the compositor reads from; never blocks the report on a
    // failed upload (finishRecordingAndUpload swallows its own errors).
    if (sessionIdRef.current) await finishRecordingAndUpload(sessionIdRef.current);
    try {
      // Aggregate behavior signals from the conversation.
      const b = behaviorRef.current;
      const avgThinkingSec = b.turns.length ? Math.round(b.turns.reduce((a, t) => a + t.thinkingMs, 0) / b.turns.length / 1000) : 0;
      const avgWords = b.turns.length ? Math.round(b.turns.reduce((a, t) => a + t.words, 0) / b.turns.length) : 0;
      const beh = { avgThinkingSec, avgWords, hintsUsed: b.hints, responses: b.turns.length, tabSwitches: flags.tabSwitch };
      setBehavior(beh);
      const behaviorSummary = `${beh.responses} responses; avg thinking time ${avgThinkingSec}s; avg answer length ${avgWords} words; hints used ${b.hints}; tab switches ${flags.tabSwitch}; integrity ${integrity}/100`;
      const rep = await sendTurn(undefined, { end: true, behaviorSummary });
      if (rep) setReport(rep);
      // Build scored answers from the conversation (each candidate turn vs the preceding AI prompt).
      const convo = messagesRef.current;
      const answers: { prompt: string; response: string; occurredAt?: string }[] = [];
      for (let i = 0; i < convo.length; i++) {
        if (convo[i].role === 'you') {
          const prompt = i > 0 && convo[i - 1].role === 'ai' ? convo[i - 1].text : 'Interview discussion';
          const ts = convo[i].ts;
          answers.push({ prompt: prompt.slice(0, 500), response: convo[i].text, occurredAt: ts ? new Date(ts).toISOString() : undefined });
        }
      }
      if (coding && codeSrc.trim()) {
        answers.push({ prompt: `Coding challenge — ${coding.title}`, response: `Language: ${codeLang}\n${codeResult ? `[${codeResult.passed}/${codeResult.total} tests passed]` : '[not run]'}\n\n${codeSrc}` });
      }
      const payload = answers.length ? answers : [{ prompt: 'Interview', response: '(no answers recorded)' }];
      const evalRes = sessionIdRef.current
        ? await api.post<Evaluation>(`/practice/session/${sessionIdRef.current}/complete`, { category: topic.category, difficulty, jobRole: topic.label, answers: payload, flags, integrity, behavior: beh })
        : await api.post<Evaluation>('/practice/evaluate', { category: topic.category, difficulty, jobRole: topic.label, answers: payload });
      setResult(evalRes);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Evaluation failed.');
    } finally {
      teardown();
      setPhase('result');
    }
  }

  if (!hydrated || !user) return <div className="flex min-h-screen items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>;

  // ───────── SETUP ─────────
  if (phase === 'setup') {
    const cat = wCatIdx != null ? CATEGORIES[wCatIdx] : null;
    const canNext = wStep === 0 ? wCatIdx != null : wStep === 1 ? (wTopic.trim().length > 0 || (cat?.topics.length ?? 0) === 0) : true;
    const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) => (
      <button onClick={onClick} className={`rounded-full border px-3 py-1.5 text-sm transition ${active ? 'border-brand-500 bg-brand-500/10 text-brand-600' : 'border-black/10 hover:border-brand-500 dark:border-white/15'}`}>{children}</button>
    );
    function beginInterview() {
      const c = CATEGORIES[wCatIdx!];
      setWizardTopic({ label: c.label, category: c.cat, topic: wTopic.trim() || c.label, blurb: '' });
      setInterviewType(typeToMode(wType));
      setRemaining(durationMin * 60);
      if (wType === 'Coding Interview') setNumQuestions(codingCount);
      setPhase('lobby');
    }
    return (
      <div className="mx-auto max-w-3xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <div><h1 className="text-2xl font-bold">Welcome! 👋</h1><p className="mt-1 text-sm text-black/60 dark:text-white/60">Let&apos;s customize your interview.</p></div>
          <ThemeToggle />
        </div>
        {/* progress */}
        <div className="mb-6 flex flex-wrap gap-1.5">
          {WIZARD_STEPS.map((s, i) => (
            <div key={s} className={`h-1.5 flex-1 rounded-full ${i <= wStep ? 'bg-brand-500' : 'bg-black/10 dark:bg-white/10'}`} />
          ))}
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}

        <div className="card min-h-[340px]">
          {wStep === 0 && (<>
            <h2 className="font-semibold">Select the interview category</h2>
            <div className="mt-3 grid max-h-[360px] gap-2 overflow-y-auto sm:grid-cols-2 lg:grid-cols-3">
              {CATEGORIES.map((c, i) => (
                <button key={c.label} onClick={() => { setWCatIdx(i); setWTopic(''); }} className={`rounded-lg border px-3 py-2 text-left text-sm transition ${wCatIdx === i ? 'border-brand-500 bg-brand-500/10' : 'border-black/10 hover:border-brand-500 dark:border-white/15'}`}>{c.label}</button>
              ))}
            </div>
          </>)}
          {wStep === 1 && cat && (<>
            <h2 className="font-semibold">Which topic in {cat.label}?</h2>
            {cat.topics.length > 0 && <div className="mt-3 flex flex-wrap gap-2">{cat.topics.map((t) => <Chip key={t} active={wTopic === t} onClick={() => setWTopic(t)}>{t}</Chip>)}</div>}
            <input value={wTopic} onChange={(e) => setWTopic(e.target.value)} placeholder="…or type any topic" className="mt-3 w-full rounded-lg border border-black/10 bg-transparent px-3 py-2 text-sm outline-none focus:border-brand-500 dark:border-white/15" />
          </>)}
          {wStep === 2 && (<>
            <h2 className="font-semibold">What type of interview?</h2>
            <div className="mt-3 flex flex-wrap gap-2">{W_TYPES.map((t) => <Chip key={t} active={wType === t} onClick={() => setWType(t)}>{t}</Chip>)}</div>
            <div className="mt-4"><label className="text-xs font-medium text-black/60 dark:text-white/60">Difficulty</label>
              <div className="mt-1 flex flex-wrap gap-2">{DIFFICULTIES.map((d) => <Chip key={d} active={difficulty === d} onClick={() => setDifficulty(d)}>{d[0] + d.slice(1).toLowerCase()}</Chip>)}</div>
            </div>
            {wType === 'Coding Interview' && <div className="mt-4"><label className="text-xs font-medium text-black/60 dark:text-white/60">Coding problems</label>
              <div className="mt-1 flex gap-2">{[1, 2, 3, 5].map((n) => <Chip key={n} active={codingCount === n} onClick={() => setCodingCount(n)}>{n}</Chip>)}</div></div>}
            {(wType === 'Theoretical Interview' || wType === 'Mixed Interview') && <div className="mt-4"><label className="text-xs font-medium text-black/60 dark:text-white/60">Question style</label>
              <div className="mt-1 flex flex-wrap gap-2">{THEORY_STYLES.map((s) => <Chip key={s} active={theoryStyle === s} onClick={() => setTheoryStyle(s)}>{s}</Chip>)}</div></div>}
          </>)}
          {wStep === 3 && (<>
            <h2 className="font-semibold">Experience level</h2>
            <div className="mt-3 flex flex-wrap gap-2">{EXPERIENCE.map((e) => <Chip key={e} active={experience === e} onClick={() => setExperience(e)}>{e}</Chip>)}</div>
          </>)}
          {wStep === 4 && (<>
            <h2 className="font-semibold">Interview style (company)</h2>
            <div className="mt-3 flex flex-wrap gap-2">{COMPANIES.map((c) => <Chip key={c} active={company === c} onClick={() => setCompany(c)}>{c}</Chip>)}</div>
          </>)}
          {wStep === 5 && (<>
            <h2 className="font-semibold">Interview length</h2>
            <div className="mt-3 flex flex-wrap gap-2">{DURATIONS.map((m) => <Chip key={m} active={durationMin === m} onClick={() => { setDurationMin(m); setRemaining(m * 60); }}>{m} min</Chip>)}</div>
          </>)}
          {wStep === 6 && (<>
            <h2 className="font-semibold">Preferred language</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {LANGUAGES.map((l) =>
                l.live ? (
                  <Chip key={l.id} active={language === l.id} onClick={() => setLanguage(l.id)}>{l.label}</Chip>
                ) : (
                  <span key={l.id} title="Not live yet" className="cursor-not-allowed rounded-full border border-black/5 px-3 py-1.5 text-sm text-black/30 dark:border-white/5 dark:text-white/25">
                    {l.label} <span className="text-[10px] uppercase">soon</span>
                  </span>
                ),
              )}
            </div>
          </>)}
          {wStep === 7 && cat && (<>
            <h2 className="font-semibold">Review &amp; start</h2>
            <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
              <Review k="Category" v={cat.label} /><Review k="Topic" v={wTopic.trim() || cat.label} />
              <Review k="Type" v={wType} /><Review k="Difficulty" v={difficulty[0] + difficulty.slice(1).toLowerCase()} />
              {wType === 'Coding Interview' && <Review k="Coding problems" v={String(codingCount)} />}
              <Review k="Experience" v={experience} /><Review k="Company" v={company} />
              <Review k="Duration" v={`${durationMin} min`} /><Review k="Language" v={language} />
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-black/50 dark:text-white/50"><ShieldIcon width={14} height={14} /> Camera, mic & screen focus are monitored. Fresh questions are generated by AI when you start.</div>
          </>)}
        </div>

        <div className="mt-5 flex items-center justify-between">
          <button onClick={() => setWStep((s) => Math.max(0, s - 1))} disabled={wStep === 0} className="btn-ghost disabled:opacity-40">← Back</button>
          {wStep < WIZARD_STEPS.length - 1 ? (
            <button onClick={() => setWStep((s) => s + 1)} disabled={!canNext} className="btn-primary disabled:opacity-40">Next →</button>
          ) : (
            <button onClick={beginInterview} className="btn-primary">Start interview</button>
          )}
        </div>
      </div>
    );
  }

  // ───────── LOBBY ─────────
  if (phase === 'lobby') {
    return (
      <div className="min-h-screen bg-neutral-950 px-4 py-8 text-white">
        <div className="mx-auto grid max-w-4xl gap-5 md:grid-cols-2">
          <div className="rounded-2xl bg-white/5 p-6">
            <div className="text-lg font-bold">HYRTE</div>
            <div className="mt-1 text-sm text-white/60">{topic.label} · {difficulty[0] + difficulty.slice(1).toLowerCase()} · Demo Interview</div>
            <div className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Interview Team</div>
            <div className="mt-2 space-y-2">
              <div className="rounded-xl bg-white/5 p-3 flex items-center gap-3">
                <AiAvatar size={40} />
                <div><div className="font-semibold">Ally · AI Interviewer</div><div className="text-xs text-white/60">Senior Engineer</div></div>
              </div>
              <div className="rounded-xl bg-white/5 p-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-500/20 text-brand-300"><ShieldIcon width={18} height={18} /></div>
                  <div><div className="font-semibold">Proctor</div><div className="text-xs text-white/60">HYRTE Integrity</div></div>
                </div>
                <div className="mt-2 flex items-center gap-1.5 rounded-lg bg-amber-500/10 px-2 py-1 text-xs text-amber-400"><ShieldIcon width={12} height={12} /> Monitors your entire interview in real time</div>
              </div>
            </div>
            <div className="mt-6 text-xs font-semibold uppercase tracking-wide text-white/40">Interview Details</div>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <div className="rounded-xl bg-white/5 p-3"><div className="text-[10px] uppercase tracking-wide text-white/40">Time</div><div className="mt-0.5 font-semibold">{durationMin} mins</div></div>
              <div className="rounded-xl bg-white/5 p-3"><div className="text-[10px] uppercase tracking-wide text-white/40">Questions</div><div className="mt-0.5 font-semibold">{numQuestions}{CODE_CATEGORIES.has(topic.category) ? ' + coding' : ''}</div></div>
            </div>
          </div>
          <div className="flex flex-col justify-center rounded-2xl bg-white/5 p-6">
            <div className="flex items-center gap-3"><AiAvatar size={56} speaking /><div><h1 className="text-xl font-bold">Ready to start?</h1><p className="text-sm text-white/60">Ally will interview you live.</p></div></div>
            <p className="mt-4 text-sm text-white/60">Ally greets you, takes your intro, then asks {numQuestions} questions one at a time{CODE_CATEGORIES.has(topic.category) ? ' plus a live coding challenge' : ''} — with hints and feedback. Answer by speaking or typing.</p>
            <div className="mt-3 rounded-lg bg-amber-500/10 p-3 text-xs text-amber-300">
              <div className="font-semibold">Before you start — this is a proctored exam:</div>
              <ul className="mt-1 space-y-0.5">
                <li>• You&apos;ll be asked to <b>share your entire screen</b> and the app goes <b>fullscreen</b>.</li>
                <li>• <b>Close all other tabs and apps</b> — leaving fullscreen or switching away <b>ends your interview immediately</b> after one warning.</li>
                <li>• Camera, microphone, screen and focus are monitored throughout, including background noise, long pauses, and answer-pattern shifts.</li>
                <li>• If your camera turns off, the interview pauses until it&apos;s back on.</li>
              </ul>
            </div>
            {/* AI interviewer checklist — a real pre-flight gate, not just a bullet point above. */}
            <div className="mt-3 rounded-lg bg-white/5 p-3">
              <div className="text-xs font-semibold text-white/70">System check — confirm before starting:</div>
              <div className="mt-2 space-y-1.5">
                <label className="flex items-start gap-2 text-xs text-white/70">
                  <input type="checkbox" checked={preflight.tabs} onChange={(e) => setPreflight((p) => ({ ...p, tabs: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-white/30 bg-transparent" />
                  I have closed every other browser tab and window.
                </label>
                <label className="flex items-start gap-2 text-xs text-white/70">
                  <input type="checkbox" checked={preflight.apps} onChange={(e) => setPreflight((p) => ({ ...p, apps: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-white/30 bg-transparent" />
                  I have closed every other application (messaging, notes, email, second devices).
                </label>
                <label className="flex items-start gap-2 text-xs text-white/70">
                  <input type="checkbox" checked={preflight.space} onChange={(e) => setPreflight((p) => ({ ...p, space: e.target.checked }))} className="mt-0.5 h-4 w-4 rounded border-white/30 bg-transparent" />
                  I&apos;m in a quiet, private space with no one else in view.
                </label>
              </div>
            </div>
            {/* P3 §7 — a real, required consent gate, not just informational text. */}
            <label className="mt-3 flex items-start gap-2 text-xs text-white/70">
              <input
                type="checkbox"
                checked={consented}
                onChange={(e) => {
                  setConsented(e.target.checked);
                  consentedAtRef.current = e.target.checked ? new Date().toISOString() : null;
                }}
                className="mt-0.5 h-4 w-4 rounded border-white/30 bg-transparent"
              />
              I understand and consent to being monitored as described above.
            </label>
            {error && <p className="mt-3 rounded-lg bg-red-500/10 p-3 text-sm text-red-400">{error}</p>}
            <button
              onClick={start}
              disabled={loading || !consented || !preflightReady}
              title={!preflightReady ? 'Please complete the system check first' : !consented ? 'Please consent to monitoring first' : undefined}
              className="btn-primary mt-5 justify-center disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? 'Requesting camera & mic…' : 'Start interview'}
            </button>
            <button onClick={() => setPhase('setup')} className="mt-2 text-center text-xs text-white/50">← Change role or difficulty</button>
          </div>
        </div>
      </div>
    );
  }

  // ───────── EVALUATING ─────────
  if (phase === 'evaluating') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-brand-500 border-t-transparent" />
        <p className="text-sm text-black/60 dark:text-white/60">Ally is writing your interview report…</p>
      </div>
    );
  }

  // ───────── RESULT ─────────
  if (phase === 'result') {
    return (
      <div className="mx-auto max-w-4xl px-6 py-10">
        <div className="mb-6 flex items-center justify-between gap-2">
          <h1 className="text-2xl font-bold">Interview Report</h1>
          <div className="flex items-center gap-2">
            {/* P5 — this inline view is ephemeral (gone on refresh); the durable, shareable report (84-param framework, skill cards, per-question scorecard) lives at its own URL. */}
            {sessionIdRef.current && <a href={`/candidate/reports/${sessionIdRef.current}`} className="btn-ghost text-sm">Full report</a>}
            <button onClick={() => setPhase('setup')} className="btn-ghost text-sm">New interview</button>
          </div>
        </div>
        {error && <p className="mb-4 rounded-lg bg-red-500/10 p-3 text-sm text-red-500">{error}</p>}
        <div className="grid gap-5 md:grid-cols-[1fr_320px]">
          <div className="space-y-5">
            {report && (
              <div className="card">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50"><AiAvatar size={20} /> Ally&apos;s feedback</div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed">{report}</div>
              </div>
            )}
            {result && (
              <div className="card">
                <div className="text-xs font-semibold text-black/50 dark:text-white/50">Competencies</div>
                <div className="mt-2 space-y-2">
                  {Object.entries(result.competencies).map(([k, v]) => (
                    <div key={k}>
                      <div className="flex justify-between text-xs capitalize"><span>{k.replace(/([A-Z])/g, ' $1')}</span><span className="tabular-nums">{v}</span></div>
                      <div className="mt-0.5 h-1.5 rounded-full bg-black/10 dark:bg-white/10"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.min(100, v)}%` }} /></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-4">
            {result && (
              <div className="card text-center">
                <Gauge value={result.overallScore} />
                <div className="mt-1 text-xs font-semibold uppercase tracking-wide text-black/50 dark:text-white/50">Final score</div>
                <div className={`mt-2 inline-block rounded-full px-3 py-1 text-xs font-semibold ${result.recommendation === 'HIRE' || result.recommendation === 'STRONG_HIRE' ? 'bg-emerald-500/15 text-emerald-600' : result.recommendation.includes('NO') ? 'bg-red-500/15 text-red-600' : 'bg-amber-500/15 text-amber-600'}`}>{result.recommendation.replace('_', ' ')}</div>
                <Radar competencies={result.competencies} />
              </div>
            )}
            {behavior && (
              <div className="card">
                <div className="text-sm font-semibold">Behavior profile</div>
                <div className="mt-2 space-y-1 text-xs [&>div]:flex [&>div]:items-center [&>div]:justify-between [&_span:first-child]:text-black/60 dark:[&_span:first-child]:text-white/60 [&_span:last-child]:tabular-nums [&_span:last-child]:font-medium">
                  <div><span>Responses given</span><span>{behavior.responses}</span></div>
                  <div><span>Avg thinking time</span><span>{behavior.avgThinkingSec}s</span></div>
                  <div><span>Avg answer length</span><span>{behavior.avgWords} words</span></div>
                  <div><span>Hints used</span><span>{behavior.hintsUsed}</span></div>
                </div>
              </div>
            )}
            <div className="card">
              <div className="flex items-center gap-1.5 text-sm font-semibold"><ShieldIcon width={16} height={16} /> Integrity report</div>
              <div className="mt-1 text-2xl font-bold">{integrity}<span className="text-sm font-normal text-black/50 dark:text-white/50">/100</span></div>
              <div className="mt-2 space-y-1 text-xs">
                <FlagRow label="Tab switches" n={flags.tabSwitch} /><FlagRow label="Eye shift / away" n={flags.eyeShift} />
                <FlagRow label="Multiple faces" n={flags.multiFace} /><FlagRow label="Paste / AI-assist" n={flags.aiAssist} /><FlagRow label="Second voice" n={flags.secondVoice} /><FlagRow label="Screen / fullscreen exits" n={flags.screen} />
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ───────── LIVE ─────────
  return (
    <div className="flex min-h-[100dvh] flex-col bg-neutral-950 text-white lg:h-screen">
      {/* P3 §4 — camera-off genuinely pauses the interview (timer stopped in
          the effect above), not just a background flag. Blocks interaction
          until the camera track is back on. */}
      {cameraPaused && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/90 p-6 text-center backdrop-blur-sm">
          <ShieldIcon width={40} height={40} className="text-amber-400" />
          <h2 className="text-xl font-bold">Camera required</h2>
          <p className="max-w-sm text-sm text-white/70">Your interview is paused because your camera appears to be off or unavailable. Turn it back on to continue — the timer isn&apos;t running while paused.</p>
        </div>
      )}
      {proctorNotice && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/15 px-4 py-2 text-sm text-amber-300">
          <span className="flex items-center gap-1.5"><ShieldIcon width={14} height={14} /> {proctorNotice}</span>
          <button onClick={() => setProctorNotice(null)} className="text-xs underline">Dismiss</button>
        </div>
      )}
      <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <span className="font-semibold">{topic.label} · Interview</span>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs text-emerald-400"><ShieldIcon width={12} height={12} /> Proctoring Enabled</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="tabular-nums rounded-lg bg-white/10 px-3 py-1 text-sm font-medium">{fmt(remaining)}</span>
          <button onClick={reverseInterviewMode ? endInterview : offerReverseInterview} className="rounded-lg bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-700">{reverseInterviewMode ? 'Finish Interview' : 'End Interview'}</button>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-1 gap-3 p-3 lg:grid-cols-[1fr_300px] lg:overflow-hidden">
        {/* conversation / coding */}
        <div className="flex min-h-0 flex-col gap-3">
          <div className="flex gap-1 rounded-xl bg-white/5 p-1 text-sm">
            <button onClick={() => setTab('chat')} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === 'chat' ? 'bg-white/15 font-medium' : 'text-white/60'}`}>Interview</button>
            {coding && (
              introComplete ? (
                <button onClick={() => setTab('code')} className={`flex-1 rounded-lg px-3 py-1.5 ${tab === 'code' ? 'bg-white/15 font-medium' : 'text-white/60'}`}>Coding {codeResult && <span className={codeResult.passed === codeResult.total ? 'text-emerald-400' : 'text-amber-400'}>· {codeResult.passed}/{codeResult.total}</span>}</button>
              ) : (
                <button disabled title="Finish your introduction with Ally first" className="flex-1 cursor-not-allowed rounded-lg px-3 py-1.5 text-white/25">Coding 🔒</button>
              )
            )}
          </div>

          {tab === 'code' && coding ? (
            <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row">
              <div className="overflow-y-auto rounded-xl bg-white/5 p-4 lg:w-72">
                <div className="text-xs font-semibold uppercase tracking-wide text-white/50">Coding Challenge</div>
                <h3 className="mt-2 font-semibold">{coding.title}</h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/80">{coding.statement}</p>
                <div className="mt-3 space-y-2">
                  {coding.tests.filter((t) => !t.hidden).map((t, i) => (
                    <div key={i} className="rounded-lg bg-black/30 p-2 text-xs font-mono"><div className="text-white/40">Sample {i + 1}</div><div className="mt-1 grid grid-cols-2 gap-2"><div><div className="text-white/40">in</div><pre className="whitespace-pre-wrap text-white/80">{t.input}</pre></div><div><div className="text-white/40">out</div><pre className="whitespace-pre-wrap text-white/80">{t.output}</pre></div></div></div>
                  ))}
                </div>
              </div>
              <div className="flex min-h-0 flex-1 flex-col rounded-xl bg-white/5">
                <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                  <div className="flex items-center gap-2 text-sm"><CodeIcon width={16} height={16} /> Editor
                    <select value={codeLang} onChange={(e) => { setCodeLang(e.target.value); setCodeSrc(coding.starter?.[e.target.value] ?? codeSrc); }} className="rounded-md border border-white/15 bg-transparent px-1.5 py-0.5 text-xs">
                      {Object.keys(coding.starter ?? {}).filter((l) => CODE_LANGUAGES.includes(l)).map((l) => <option key={l} value={l} className="bg-neutral-900">{l}</option>)}
                    </select>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={runCode} disabled={codeRunning} className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-medium hover:bg-emerald-700 disabled:opacity-60">{codeRunning ? 'Running…' : '▶ Run'}</button>
                    <button onClick={shareCode} className="rounded-lg bg-white/10 px-2.5 py-1 text-xs hover:bg-white/20">Ask Ally to review</button>
                  </div>
                </div>
                <textarea value={codeSrc} onChange={(e) => setCodeSrc(e.target.value)} onPaste={() => bumpFlag('aiAssist', 800)} spellCheck={false} placeholder="Write your solution…" className="min-h-0 flex-1 resize-none bg-transparent p-3 font-mono text-sm outline-none placeholder:text-white/30" />
                {codeResult && (
                  <div className="max-h-32 overflow-y-auto border-t border-white/10 p-3 text-xs">
                    <div className="mb-1 font-medium">{codeResult.passed}/{codeResult.total} tests passed</div>
                    {codeResult.results.map((r) => (
                      <div key={r.ordinal} className="flex items-center gap-1 border-t border-white/5 py-1">
                        <span className={`inline-flex items-center gap-1 ${r.passed ? 'text-emerald-400' : 'text-red-400'}`}>{r.passed ? <CheckIcon width={12} height={12} /> : <XIcon width={12} height={12} />}{r.hidden ? `Hidden #${r.ordinal + 1}` : `Sample #${r.ordinal + 1}`} · {r.status}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="min-h-0 flex-1 overflow-y-auto rounded-xl bg-white/5 p-4">
                {messages.length === 0 && !sending && <div className="flex h-full items-center justify-center text-sm text-white/40">Connecting you with Ally…</div>}
                <div className="space-y-3">
                  {messages.map((m, i) => (
                    <div key={i} className={`flex gap-2 ${m.role === 'you' ? 'justify-end' : 'justify-start'}`}>
                      {m.role === 'ai' && <AiAvatar size={28} />}
                      <div className={`max-w-[78%] whitespace-pre-wrap rounded-2xl px-4 py-2 text-sm leading-relaxed ${m.role === 'ai' ? 'bg-white/10' : 'bg-brand-500 text-white'}`}>{m.text}</div>
                    </div>
                  ))}
                  {sending && <div className="flex gap-2"><AiAvatar size={28} /><div className="rounded-2xl bg-white/10 px-4 py-2 text-sm text-white/60">Ally is thinking…</div></div>}
                  <div ref={chatEndRef} />
                </div>
              </div>
              <div className="rounded-xl bg-white/5 p-2">
                <div className="mb-1.5 flex items-center gap-2 px-1 text-xs text-white/50">
                  {voiceState === 'speaking' ? <><SpeakerIcon width={14} height={14} className="text-brand-400" /> Ally is speaking…</> : voiceState === 'listening' ? thinking ? <><MicIcon width={14} height={14} className="text-amber-400" /> Taking your time — I won&apos;t auto-send</> : <><MicIcon width={14} height={14} className="text-emerald-400" /> Listening — speak or type</> : 'Ready'}
                  <button
                    onClick={() => setThinking((t) => !t)}
                    disabled={sending}
                    title="Pause hands-free auto-send while you think — no penalty"
                    className={`ml-auto rounded-md px-2 py-0.5 ${thinking ? 'bg-amber-500/30 text-amber-200' : 'bg-white/10 hover:bg-white/20'}`}
                  >
                    {thinking ? "I'm ready" : 'Give me a second'}
                  </button>
                  {!reverseInterviewMode && (
                    <button onClick={() => sendTurn('I\'m a bit stuck — can you explain the question and give me a hint?')} disabled={sending} className="rounded-md bg-white/10 px-2 py-0.5 hover:bg-white/20">I&apos;m stuck — explain</button>
                  )}
                </div>
                {reverseInterviewMode && (
                  <p className="mb-1.5 px-1 text-xs text-brand-300">
                    {reverseQuestionsAsked >= REVERSE_INTERVIEW_MAX_QUESTIONS
                      ? "You've used all your questions — click Finish Interview when ready."
                      : `Ask us anything (${REVERSE_INTERVIEW_MAX_QUESTIONS - reverseQuestionsAsked} question${REVERSE_INTERVIEW_MAX_QUESTIONS - reverseQuestionsAsked === 1 ? '' : 's'} left), or click Finish Interview.`}
                  </p>
                )}
                <div className="flex items-end gap-2">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); onSend(); } }}
                    onPaste={() => bumpFlag('aiAssist', 800)}
                    rows={2}
                    disabled={reverseInterviewMode && reverseQuestionsAsked >= REVERSE_INTERVIEW_MAX_QUESTIONS}
                    placeholder={reverseInterviewMode ? 'Ask a question about the role, team, or company…' : 'Type your answer, or just speak…'}
                    className="min-h-0 flex-1 resize-none rounded-lg bg-black/30 p-2 text-sm outline-none placeholder:text-white/30 disabled:opacity-50"
                  />
                  <div className="flex flex-col gap-1">
                    <button onClick={() => setMuted((m) => !m)} className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">{muted ? 'Unmute' : 'Mute'}</button>
                    <button onClick={() => setMicOn((m) => !m)} className="rounded-lg bg-white/10 px-2 py-1 text-xs hover:bg-white/20">{micOn ? 'Mic on' : 'Mic off'}</button>
                  </div>
                  <button onClick={onSend} disabled={sending || !input.trim() || (reverseInterviewMode && reverseQuestionsAsked >= REVERSE_INTERVIEW_MAX_QUESTIONS)} className="btn-primary text-sm disabled:opacity-50">Send</button>
                </div>
              </div>
            </>
          )}
        </div>

        {/* right column: AI + webcam + proctoring */}
        <div className="flex flex-col gap-3 overflow-y-auto">
          <div className="flex items-center gap-3 rounded-xl bg-white/5 p-3">
            <AiAvatar size={44} speaking={voiceState === 'speaking'} />
            <div><div className="text-sm font-semibold">Ally</div><div className="text-xs text-white/50">AI Interviewer · Senior Engineer</div></div>
          </div>
          <div className="relative aspect-video overflow-hidden rounded-xl bg-black">
            <video ref={videoRef} muted playsInline className="h-full w-full object-cover" />
            <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px]"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" /> REC</span>
          </div>
          <div className="rounded-xl bg-white/5 p-3">
            <div className="flex items-center justify-between"><span className="text-xs font-semibold uppercase tracking-wide text-white/50">Live signals</span><span className={`text-xs font-semibold ${integrity >= 80 ? 'text-emerald-400' : integrity >= 55 ? 'text-amber-400' : 'text-red-400'}`}>{integrity}/100</span></div>
            <div className="mt-2 space-y-1.5">
              <Signal label="Eye Shift" n={flags.eyeShift} tone="red" /><Signal label="Switched Tabs" n={flags.tabSwitch} tone="amber" />
              <Signal label="AI-Assist Detected" n={flags.aiAssist} tone="red" /><Signal label="Second Voice" n={flags.secondVoice} tone="amber" /><Signal label="Multiple Faces" n={flags.multiFace} tone="red" /><Signal label="Screen / Fullscreen" n={flags.screen} tone="red" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Review({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-black/5 p-2.5 dark:border-white/10">
      <div className="text-[10px] uppercase tracking-wide text-black/40 dark:text-white/40">{k}</div>
      <div className="mt-0.5 font-medium">{v}</div>
    </div>
  );
}

function Picker({ label, options, value, onChange, render }: { label: string; options: string[]; value: string; onChange: (v: string) => void; render: (v: string) => ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-medium text-black/60 dark:text-white/60">{label}</label>
      <div className="mt-1 flex gap-1">
        {options.map((o) => <button key={o} onClick={() => onChange(o)} className={`rounded-lg px-3 py-1.5 text-sm ${o === value ? 'bg-brand-500 text-white' : 'bg-black/5 dark:bg-white/10'}`}>{render(o)}</button>)}
      </div>
    </div>
  );
}

/** Illustrated AI-interviewer avatar (a friendly person), CSP-safe inline SVG. */
function AiAvatar({ size = 40, speaking = false }: { size?: number; speaking?: boolean }) {
  return (
    <span className={`relative inline-flex shrink-0 items-center justify-center rounded-full ${speaking ? 'ring-2 ring-emerald-400 ring-offset-2 ring-offset-neutral-900' : ''}`} style={{ width: size, height: size }}>
      <svg viewBox="0 0 64 64" width={size} height={size} className="rounded-full">
        <defs>
          <linearGradient id="aibg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6d5efc" /><stop offset="1" stopColor="#3b82f6" /></linearGradient>
        </defs>
        <rect width="64" height="64" rx="32" fill="url(#aibg)" />
        <circle cx="32" cy="26" r="11" fill="#f2d9c2" />
        <path d="M21 24a11 11 0 0 1 22 0c0-2-2-9-11-9s-11 7-11 9Z" fill="#3a2f2a" />
        <path d="M16 54c1-9 8-14 16-14s15 5 16 14a32 32 0 0 1-32 0Z" fill="#e2e8f0" />
        <path d="M26 27c1 1 3 1 4 0M34 27c1 1 3 1 4 0" stroke="#3a2f2a" strokeWidth="1.5" fill="none" strokeLinecap="round" />
      </svg>
      {speaking && <span className="absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400 ring-2 ring-neutral-900" />}
    </span>
  );
}

function fmt(sec: number) { const m = Math.floor(sec / 60).toString().padStart(2, '0'); const s = (sec % 60).toString().padStart(2, '0'); return `${m}:${s}`; }

function Signal({ label, n, tone }: { label: string; n: number; tone: 'red' | 'amber' }) {
  const active = n > 0; const color = tone === 'red' ? 'text-red-400' : 'text-amber-400';
  return (
    <div className={`flex items-center justify-between rounded-lg px-2 py-1.5 text-xs ${active ? 'bg-white/10' : 'bg-white/[0.03]'}`}>
      <span className={`inline-flex items-center gap-1.5 ${active ? color : 'text-white/40'}`}>{active ? <AlertIcon width={12} height={12} /> : <CheckIcon width={12} height={12} />}{label}</span>
      {active && <span className={`tabular-nums font-semibold ${color}`}>{n}</span>}
    </div>
  );
}

function FlagRow({ label, n }: { label: string; n: number }) {
  return <div className="flex items-center justify-between"><span className="text-black/60 dark:text-white/60">{label}</span><span className={`tabular-nums font-medium ${n > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{n}</span></div>;
}

function Gauge({ value }: { value: number }) {
  const angle = (Math.min(100, Math.max(0, value)) / 100) * 180;
  const r = 52, cx = 60, cy = 60; const rad = (d: number) => (d - 180) * (Math.PI / 180);
  const x = cx + r * Math.cos(rad(angle)); const y = cy + r * Math.sin(rad(angle));
  const color = value >= 75 ? '#10b981' : value >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <svg viewBox="0 0 120 70" className="mx-auto w-40">
      <path d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke="currentColor" strokeWidth="8" className="text-black/10 dark:text-white/10" strokeLinecap="round" />
      <path d={`M8 60 A52 52 0 0 1 ${x} ${y}`} fill="none" stroke={color} strokeWidth="8" strokeLinecap="round" />
      <text x="60" y="52" textAnchor="middle" className="fill-current text-[20px] font-bold">{value}</text>
    </svg>
  );
}

function Radar({ competencies }: { competencies: Record<string, number> }) {
  const entries = Object.entries(competencies); const n = entries.length;
  const cx = 90, cy = 90, R = 60, benchmark = 70;
  const point = (i: number, value: number) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; const rr = (Math.min(100, Math.max(0, value)) / 100) * R; return [cx + rr * Math.cos(a), cy + rr * Math.sin(a)] as const; };
  const poly = (fn: (i: number) => readonly [number, number]) => entries.map((_, i) => fn(i).join(',')).join(' ');
  return (
    <svg viewBox="0 0 180 180" className="mx-auto mt-3 w-full max-w-[200px]">
      {[0.33, 0.66, 1].map((f) => <polygon key={f} points={poly((i) => point(i, f * 100))} fill="none" stroke="currentColor" className="text-black/10 dark:text-white/15" strokeWidth="0.8" />)}
      <polygon points={poly((i) => point(i, benchmark))} fill="none" stroke="currentColor" className="text-black/30 dark:text-white/30" strokeWidth="1.2" strokeDasharray="3 2" />
      <polygon points={poly((i) => point(i, entries[i][1]))} fill="rgb(249 115 22 / 0.2)" stroke="#f97316" strokeWidth="1.6" />
      {entries.map(([k], i) => { const a = (Math.PI * 2 * i) / n - Math.PI / 2; const lx = cx + (R + 11) * Math.cos(a); const ly = cy + (R + 11) * Math.sin(a); return <text key={k} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-current text-[7px] capitalize text-black/50 dark:text-white/50">{k.replace(/([A-Z])/g, ' $1').trim().split(' ')[0]}</text>; })}
    </svg>
  );
}

export default function InterviewRoom() {
  return <Suspense fallback={<div className="flex min-h-screen items-center justify-center text-sm text-black/50 dark:text-white/50">Loading…</div>}><InterviewRoomInner /></Suspense>;
}

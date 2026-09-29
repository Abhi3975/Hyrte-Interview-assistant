/**
 * What the candidate is told about being assessed by a machine.
 *
 * Every serious AI-hiring product states this, and it is the one thing Koyo's
 * public interview screen carries that this product did not: "This interview
 * is being conducted by an AI. It can make mistakes. The final decision is
 * made by a human."
 *
 * It is not decoration. A person being evaluated for a job by software is
 * entitled to know that it is software, that it is fallible, and who actually
 * decides — and in several jurisdictions that is now law rather than courtesy
 * (NYC Local Law 144, the EU AI Act's high-risk employment provisions).
 *
 * Deliberately NOT a copy of the reference wording. Two differences, both
 * because the copied version would be false here:
 *
 *  - Koyo names a human invigilator ("Pratiksha will watch your complete
 *    interview recording"). HYRTE has no such person. Naming one would be a
 *    lie told to someone who cannot check it, so this says what is actually
 *    true: the recording is kept and a recruiter can review it.
 *
 *  - "The final decision is made by a human" is true of the hiring decision
 *    and NOT true of proctoring, which can end an interview automatically with
 *    no person involved. That exception is stated rather than buried, since it
 *    is the one automated decision that can actually go against the candidate
 *    while they are still sitting there.
 */
export function AiDisclosure({ variant = 'panel' }: { variant?: 'panel' | 'inline' }) {
  if (variant === 'inline') {
    return (
      <p className="text-[11px] leading-relaxed text-white/45">
        This interview is conducted by an AI. It can make mistakes. It does not decide whether you are hired — a person
        reviews this and makes that call.
      </p>
    );
  }

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="text-xs font-semibold text-white/70">Before you begin — how this is assessed</div>
      <ul className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-white/55">
        <li>
          This interview is <b className="text-white/75">conducted by an AI</b>, not a person. It can misunderstand you
          and it can be wrong.
        </li>
        <li>
          It does <b className="text-white/75">not decide whether you are hired.</b> It produces a recommendation with
          the evidence behind it, and a person makes the decision.
        </li>
        <li>
          Your recording and the signals collected during it are kept, and a recruiter can review them alongside that
          recommendation.
        </li>
        <li>
          One thing here <i>is</i> automatic: if proctoring detects you leaving the interview, it can end the session
          without anyone reviewing it first.
        </li>
      </ul>
    </div>
  );
}

/**
 * Who a generated message is written TO.
 *
 * Founder-reported, 30 Sep: "Team members call their own name to ask someone
 * else. John wants to ask Lisa about something but he (John) says 'Hey John,
 * I need you to do this'. Then Lisa responds to John."
 *
 * The cause is the same one that produced an escalation email FROM Alice
 * opening "Alice, this is now critical" — fixed once already, in one place,
 * and the same mistake was sitting in every other prompt that generates
 * person-to-person text. Each of them says "You are <name>" and "write this in
 * your own voice", and then never says who is being written to. The only name
 * in the prompt is the sender's, so that is the name the greeting reaches for.
 *
 * A prompt that names exactly one person will use that person's name. The fix
 * is not to ask more nicely; it is to make sure the recipient is named, and
 * named more prominently than the sender.
 */

/**
 * The rule appended to any prompt whose output is read by a named person.
 *
 * `recipientName` is who will read it. `senderName` is passed so the rule can
 * forbid it explicitly — naming the trap is what stops it, since "address the
 * recipient" alone still leaves the sender's name as the only one in context.
 */
export function addressingRule(recipientName: string, senderName: string): string {
  return (
    `\n\nWHO YOU ARE WRITING TO: ${recipientName}. This message will be read by ${recipientName}, not by you. ` +
    `If you open with a name or greeting it must be "${recipientName}" — never "${senderName}", which is your own ` +
    `name. Writing "Hi ${senderName}" here would mean greeting yourself, and it is the single most common way this ` +
    `goes wrong. Do not sign off with your own name either; the message already shows who sent it.`
  );
}

/**
 * Cheap post-hoc guard for the case the instruction still loses.
 *
 * Strips a self-addressed opener rather than rewriting the message, because
 * the rest of the sentence is usually fine — "Hey John, I need this by Friday"
 * sent to Lisa is only wrong in its first two words.
 *
 * Deliberately conservative: only touches a greeting at the very start, and
 * only when the name it greets is the sender's own. A message that legitimately
 * mentions the sender's name mid-sentence ("as John said earlier") is untouched.
 */
export function stripSelfAddress(text: string, senderName: string): string {
  const first = senderName.trim().split(/\s+/)[0];
  if (!first || first.length < 2) return text;
  const escaped = first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // "Hey John," / "Hi John -" / "John," at the very start, greeting included.
  const opener = new RegExp(`^\\s*(?:(?:hey|hi|hello|yo|dear)\\s+)?${escaped}\\s*[,:—–-]\\s*`, 'i');
  const stripped = text.replace(opener, '');
  if (stripped === text) return text;
  // Re-capitalise whatever now leads the sentence.
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

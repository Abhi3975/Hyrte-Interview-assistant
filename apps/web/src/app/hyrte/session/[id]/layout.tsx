import { HyrteSessionProvider } from '@/components/hyrte/session-provider';
import { HyrtePhaseGate } from '@/components/hyrte/phase-gate';
import { LiveToasts } from '@/components/hyrte/live-toasts';
import { IncomingMeeting } from '@/components/hyrte/incoming-meeting';

export default async function HyrteSessionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <HyrteSessionProvider sessionId={id}>
      <HyrtePhaseGate sessionId={id} />
      {children}
      {/* Refinements doc §4 — fixed-position, so an arriving message is visible
          from any screen in the workspace, not only the one it landed on. */}
      <LiveToasts />
      {/* §5 — "when the meeting starts it should come like a call." Mounted
          here so it reaches the candidate wherever they are, the way a call
          does, rather than only on the Meetings page. */}
      <IncomingMeeting sessionId={id} />
    </HyrteSessionProvider>
  );
}

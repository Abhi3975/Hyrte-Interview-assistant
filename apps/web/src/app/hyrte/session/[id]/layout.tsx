import { HyrteSessionProvider } from '@/components/hyrte/session-provider';
import { HyrtePhaseGate } from '@/components/hyrte/phase-gate';
import { LiveToasts } from '@/components/hyrte/live-toasts';

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
    </HyrteSessionProvider>
  );
}

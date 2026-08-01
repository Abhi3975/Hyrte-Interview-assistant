import { HyrteSessionProvider } from '@/components/hyrte/session-provider';
import { HyrtePhaseGate } from '@/components/hyrte/phase-gate';

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
    </HyrteSessionProvider>
  );
}

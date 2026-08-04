/** Hand-drawn line icons for the HYRTE agentic-OS shell — no external icon dependency. */
import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    width: 18,
    height: 18,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.75,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    ...props,
  };
}

export function GridIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  );
}

export function MailIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="2.5" y="4.5" width="19" height="15" rx="2" />
      <path d="m3 6 9 6 9-6" />
    </svg>
  );
}

export function ChatIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5h16v11H8l-4 4V5Z" />
    </svg>
  );
}

export function PipelineIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="5" height="16" rx="1.2" />
      <rect x="10" y="4" width="5" height="10" rx="1.2" />
      <rect x="17" y="4" width="4" height="7" rx="1.2" />
    </svg>
  );
}

export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 9.5h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function MeetingIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 20v-1c0-2.8 2.7-5 6-5s6 2.2 6 5v1" />
      <circle cx="18" cy="9" r="2.3" />
      <path d="M21 20v-.8c0-1.9-1.6-3.5-3.6-3.9" />
    </svg>
  );
}

export function BookIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5V4.5Z" />
      <path d="M4 19a2.5 2.5 0 0 1 2.5-2.5H20" />
    </svg>
  );
}

export function ChartIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 20V10M11 20V4M18 20v-7" />
      <path d="M2 20h20" />
    </svg>
  );
}

export function CrownIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="m3 17 2-9 5 4 2-6 2 6 5-4 2 9H3Z" />
      <path d="M3 20h18" />
    </svg>
  );
}

export function BellIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 9a6 6 0 1 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  );
}

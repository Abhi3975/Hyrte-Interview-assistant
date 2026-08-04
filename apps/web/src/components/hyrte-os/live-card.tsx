import type { ReactNode } from 'react';

export function LiveCard({
  microLabel,
  microLabelColor,
  title,
  children,
  footer,
  className,
}: {
  microLabel?: string;
  microLabelColor?: string;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`hos-card flex flex-col gap-2 p-4 ${className ?? ''}`}>
      {microLabel && (
        <span className="hos-micro-label" style={{ color: microLabelColor ?? 'var(--hos-accent)' }}>
          {microLabel}
        </span>
      )}
      {title && <span className="hos-card-title">{title}</span>}
      {children}
      {footer && <div className="mt-1 border-t pt-2" style={{ borderColor: 'var(--hos-border)' }}>{footer}</div>}
    </div>
  );
}

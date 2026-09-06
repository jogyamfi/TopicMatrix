import { AlertTriangle, CheckCircle2, CircleDashed, Clock } from 'lucide-react';
import { cn } from '../lib/utils';

// Health status must never be conveyed by colour alone (NF-4) — every status is an icon + text
// label pairing, established here at P6 and reused by every later phase (P7+).
export type HealthStatus = 'notStarted' | 'strong' | 'needsReview' | 'atRisk';

const CONFIG: Record<HealthStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  strong: { label: 'Strong', icon: CheckCircle2, className: 'text-health-strong' },
  needsReview: { label: 'Needs review', icon: Clock, className: 'text-health-needsReview' },
  atRisk: { label: 'At risk', icon: AlertTriangle, className: 'text-health-atRisk' },
  notStarted: { label: 'Not started', icon: CircleDashed, className: 'text-health-notStarted' },
};

export function HealthStatusBadge({
  status,
  className,
}: {
  status: HealthStatus;
  className?: string;
}): React.JSX.Element {
  const { label, icon: Icon, className: colorClass } = CONFIG[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-sm font-medium', colorClass, className)}>
      <Icon className="size-4" aria-hidden="true" />
      {label}
    </span>
  );
}

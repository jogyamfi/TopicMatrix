import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

/** Loading placeholder (P6 task 11) — used consistently instead of ad hoc spinners. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>): React.JSX.Element {
  return <div className={cn('animate-pulse rounded-md bg-muted', className)} {...props} />;
}

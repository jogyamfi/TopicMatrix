import { cn } from '../lib/utils';

// The session form's confidence scale (FR-4.5) — labelled 1-5, never numbers alone.
export const CONFIDENCE_LABELS: Record<number, string> = {
  1: 'Guessing',
  2: 'Somewhat know it',
  3: 'Mostly know it',
  4: 'Strong understanding',
  5: 'Expert level confidence',
};

export function ConfidenceScale({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="Confidence" className="flex gap-1.5">
      {[1, 2, 3, 4, 5].map((level) => (
        <button
          key={level}
          type="button"
          role="radio"
          aria-checked={value === level}
          title={`${level} — ${CONFIDENCE_LABELS[level]}`}
          onClick={() => onChange(level)}
          className={cn(
            'flex h-10 flex-1 flex-col items-center justify-center rounded-md border text-xs font-medium leading-tight',
            value === level
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-input bg-background hover:bg-accent',
          )}
        >
          <span className="text-sm font-semibold">{level}</span>
        </button>
      ))}
    </div>
  );
}

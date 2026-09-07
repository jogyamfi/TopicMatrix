import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { DATE_RANGE_PRESETS, type DateRangePreset } from '../lib/date-range';

/** FR-7.9's date-range selector, reused by every P9 chart that accepts a range. */
export function DateRangeSelector({
  value,
  onChange,
  label = 'Date range',
}: {
  value: DateRangePreset;
  onChange: (value: DateRangePreset) => void;
  label?: string;
}): React.JSX.Element {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DateRangePreset)}>
      <SelectTrigger className="w-40" aria-label={label}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DATE_RANGE_PRESETS.map((preset) => (
          <SelectItem key={preset.value} value={preset.value}>
            {preset.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

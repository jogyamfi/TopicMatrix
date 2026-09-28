import { useEffect, useId, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { topicSearchResponseSchema, type TopicSearchResult } from '@topicmatrix/shared';
import { apiFetch } from '../lib/api-client';
import { cn } from '../lib/utils';
import { Input } from './ui/input';

/** "Maths › Algebra" — where a search result sits, to tell same-named topics apart. */
export function topicLocation(result: TopicSearchResult): string {
  return [result.subjectName, ...result.ancestors].join(' › ');
}

function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

const NO_RESULTS: TopicSearchResult[] = [];

/** Topics matching `query` across every subject (`GET /topics/search`, R4), debounced. */
export function useTopicSearch(query: string): { results: TopicSearchResult[]; isFetching: boolean } {
  const q = useDebounced(query.trim(), 150);
  const search = useQuery({
    queryKey: ['topics', 'search', q],
    queryFn: () => apiFetch(`/topics/search?q=${encodeURIComponent(q)}`, topicSearchResponseSchema),
    enabled: q.length > 0,
    staleTime: 10_000,
  });
  return { results: (q.length > 0 && search.data?.topics) || NO_RESULTS, isFetching: search.isFetching };
}

/**
 * A search-as-you-type topic picker across all subjects (R4, U-11), following the ARIA
 * combobox pattern: focus stays in the input, arrow keys move the active option
 * (`aria-activedescendant`), Enter picks it, Escape clears.
 */
export function TopicCombobox({
  id,
  onSelect,
  placeholder = 'Search topics…',
  autoFocus = false,
  ariaLabel,
}: {
  id: string;
  onSelect: (result: TopicSearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
  /** When there's no visible `<Label htmlFor={id}>`. */
  ariaLabel?: string;
}): React.JSX.Element {
  const listboxId = useId();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const { results, isFetching } = useTopicSearch(query);
  const open = query.trim().length > 0;

  useEffect(() => setActive(0), [results]);

  const choose = (result: TopicSearchResult | undefined) => {
    if (!result) return;
    onSelect(result);
    setQuery('');
  };

  const optionId = (index: number) => `${listboxId}-option-${index}`;

  return (
    <div className="relative">
      <Input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        {...(ariaLabel ? { 'aria-label': ariaLabel } : {})}
        {...(open && results.length > 0 ? { 'aria-activedescendant': optionId(active) } : {})}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((i) => Math.min(i + 1, results.length - 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((i) => Math.max(i - 1, 0));
          } else if (e.key === 'Enter' && open) {
            e.preventDefault();
            choose(results[active]);
          } else if (e.key === 'Escape' && query) {
            e.preventDefault();
            e.stopPropagation(); // clear the search, don't close a surrounding dialog
            setQuery('');
          }
        }}
      />
      <ul
        id={listboxId}
        role="listbox"
        aria-label="Matching topics"
        className={cn(
          'mt-1 max-h-72 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md',
          !open && 'hidden',
        )}
      >
        {open && results.length === 0 ? (
          <li className="px-2 py-1.5 text-sm text-muted-foreground" role="presentation">
            {isFetching ? 'Searching…' : 'No matching topics'}
          </li>
        ) : null}
        {results.map((result, index) => (
          <li
            key={result.id}
            id={optionId(index)}
            role="option"
            aria-selected={index === active}
            // Pointer selection without stealing focus from the input.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => choose(result)}
            onMouseEnter={() => setActive(index)}
            className={cn(
              'cursor-pointer rounded-sm px-2 py-1.5 text-sm',
              index === active && 'bg-accent text-accent-foreground',
            )}
          >
            <span className="font-medium">{result.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{topicLocation(result)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

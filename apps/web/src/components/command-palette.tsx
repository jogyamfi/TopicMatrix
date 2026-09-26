import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search } from 'lucide-react';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from './ui/dialog';
import { TopicCombobox } from './topic-search';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent);

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))
  );
}

/**
 * Jump to any topic from anywhere (R4, U-11): Ctrl/⌘+K, or `/` when not typing, opens a topic
 * search across every subject; Enter goes to the chosen topic's page. The header button is the
 * same thing for pointer users and says which keys open it.
 */
export function CommandPalette(): React.JSX.Element {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const modK = (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k';
      const slash = event.key === '/' && !event.metaKey && !event.ctrlKey && !event.altKey && !isTyping(event.target);
      if (modK || slash) {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-2 text-muted-foreground"
        onClick={() => setOpen(true)}
        aria-keyshortcuts="Control+K Meta+K /"
      >
        <Search className="size-4" aria-hidden="true" />
        <span className="hidden sm:inline">Search topics</span>
        <span className="sr-only sm:hidden">Search topics</span>
        <kbd className="hidden rounded border px-1 text-xs sm:inline">{IS_MAC ? '⌘K' : 'Ctrl K'}</kbd>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="top-[20%] translate-y-0">
          <DialogHeader>
            <DialogTitle>Jump to a topic</DialogTitle>
            <DialogDescription>Search every subject; arrow keys to choose, Enter to open.</DialogDescription>
          </DialogHeader>
          <TopicCombobox
            id="command-palette-search"
            ariaLabel="Search topics"
            autoFocus
            onSelect={(topic) => {
              setOpen(false);
              navigate(`/subjects/${topic.subjectId}/topics/${topic.id}`);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

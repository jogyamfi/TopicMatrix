import { useState } from 'react';
import { Menu } from 'lucide-react';
import type { Role } from '@topicmatrix/shared';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogTitle } from '../ui/dialog';
import { NavLinks } from './sidebar';

/** The mobile equivalent of the desktop sidebar (P6 task 7: bottom/drawer nav on mobile) — a
 * Radix Dialog styled as a left drawer, so it gets focus-trapping/Escape-to-close for free. */
export function MobileNav({ role }: { role: Role }): React.JSX.Element {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="ghost"
        size="icon"
        className="md:hidden"
        aria-label="Open navigation menu"
        onClick={() => setOpen(true)}
      >
        <Menu />
      </Button>
      <DialogContent className="left-0 top-0 h-full max-w-xs -translate-x-0 -translate-y-0 rounded-none">
        <DialogTitle>TopicMatrix</DialogTitle>
        <NavLinks role={role} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

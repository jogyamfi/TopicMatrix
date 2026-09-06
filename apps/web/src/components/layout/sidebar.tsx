import { NavLink } from 'react-router-dom';
import { cn } from '../../lib/utils';
import { navItemsFor } from './nav-items';
import type { Role } from '@topicmatrix/shared';

export function NavLinks({ role, onNavigate }: { role: Role; onNavigate?: () => void }): React.JSX.Element {
  return (
    <nav className="flex flex-col gap-1" aria-label="Primary">
      {navItemsFor(role).map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground',
              isActive && 'bg-accent text-accent-foreground',
            )
          }
        >
          <Icon className="size-4" aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

export function Sidebar({ role }: { role: Role }): React.JSX.Element {
  return (
    <aside className="hidden w-56 shrink-0 border-r p-4 md:flex md:flex-col">
      <p className="mb-4 px-3 text-lg font-semibold">TopicMatrix</p>
      <NavLinks role={role} />
    </aside>
  );
}

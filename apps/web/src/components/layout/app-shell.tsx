import { Outlet } from 'react-router-dom';
import { useAuth } from '../../context/auth-context';
import { SkipLink } from '../skip-link';
import { ErrorBoundary } from '../error-boundary';
import { ThemeToggle } from '../theme-toggle';
import { UserMenu } from '../user-menu';
import { useRouteFocus } from '../../lib/use-route-focus';
import { Sidebar } from './sidebar';
import { MobileNav } from './mobile-nav';
import { Breadcrumbs } from './breadcrumbs';
import { TimezoneBanner } from '../timezone-banner';
import { CommandPalette } from '../command-palette';

/** The responsive app shell (P6 task 7): sidebar on desktop, drawer on mobile, a header slot
 * (breadcrumbs + theme + user menu), and a global error boundary wrapping every routed page. */
export function AppShell(): React.JSX.Element | null {
  const { user } = useAuth();
  const focusRef = useRouteFocus();
  if (!user) return null;

  return (
    <div className="flex min-h-screen">
      <SkipLink />
      <Sidebar role={user.role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between gap-4 border-b px-4">
          <div className="flex items-center gap-2">
            <MobileNav role={user.role} />
            <Breadcrumbs />
          </div>
          <div className="flex items-center gap-1">
            {user.mustChangePassword ? null : <CommandPalette />}
            <ThemeToggle />
            <UserMenu />
          </div>
        </header>
        {/* Settings are off-limits until a forced password change is done (FR-1.6). */}
        {user.mustChangePassword ? null : <TimezoneBanner userId={user.id} />}
        <main
          id="main-content"
          ref={focusRef}
          tabIndex={-1}
          className="flex-1 p-4 outline-none sm:p-6"
        >
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}

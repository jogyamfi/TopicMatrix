import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/auth-context';
import { Skeleton } from '../ui/skeleton';

function FullPageLoading(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <Skeleton className="h-8 w-48" />
    </div>
  );
}

/** Redirects unauthenticated users to /login, preserving the intended destination. Redirects
 * authenticated-but-must-change-password users to the forced change-password screen, which they
 * cannot navigate away from (FR-1.6) until it clears. */
export function ProtectedRoute(): React.JSX.Element {
  const { user, status } = useAuth();
  const location = useLocation();

  if (status === 'idle' || status === 'loading') return <FullPageLoading />;
  if (status === 'unauthenticated' || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  if (user.mustChangePassword && location.pathname !== '/change-password') {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

/** Blocks navigating away from every route except change-password while it's required
 * (mirrors the server's requirePasswordChanged middleware, FR-1.6). */
export function RequirePasswordChanged(): React.JSX.Element {
  const { user } = useAuth();
  if (user?.mustChangePassword) {
    return <Navigate to="/change-password" replace />;
  }
  return <Outlet />;
}

export function AdminRoute(): React.JSX.Element {
  const { user } = useAuth();
  if (user?.role !== 'ADMIN') {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}

/** Keeps an already-authenticated user off /login. */
export function PublicOnlyRoute(): React.JSX.Element {
  const { user, status } = useAuth();
  if (status === 'idle' || status === 'loading') return <FullPageLoading />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

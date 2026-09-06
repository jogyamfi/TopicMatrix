import { createContext, useCallback, useContext, useEffect, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { PublicUser } from '@topicmatrix/shared';
import { authStore } from '../lib/auth-store';
import type { AuthStatus } from '../lib/auth-store';

interface AuthContextValue {
  user: PublicUser | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<PublicUser>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const state = useSyncExternalStore(
    (onChange) => authStore.subscribe(onChange),
    () => authStore.getState(),
  );

  useEffect(() => {
    if (state.status === 'idle') {
      void authStore.bootstrap();
    }
    // Only ever runs once, on mount — `status` transitions out of 'idle' immediately after.
  }, []);

  const login = useCallback((email: string, password: string) => authStore.login(email, password), []);
  const logout = useCallback(() => authStore.logout(), []);

  const value: AuthContextValue = { user: state.user, status: state.status, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}

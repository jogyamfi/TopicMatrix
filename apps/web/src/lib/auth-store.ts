import { authResponseSchema, type PublicUser } from '@topicmatrix/shared';

// The access token lives ONLY here, in memory (SEC-2) — never localStorage/sessionStorage.
// A page reload always loses it; AuthProvider calls `authStore.bootstrap()` on mount to try to
// recover a session from the HttpOnly refresh cookie.
export type AuthStatus = 'idle' | 'loading' | 'authenticated' | 'unauthenticated';

export interface AuthState {
  accessToken: string | null;
  user: PublicUser | null;
  status: AuthStatus;
}

type Listener = (state: AuthState) => void;

class AuthStore {
  private state: AuthState = { accessToken: null, user: null, status: 'idle' };
  private listeners = new Set<Listener>();
  private refreshPromise: Promise<string | null> | null = null;
  // Bumped on every explicit login/logout/reset — guards against a slow, in-flight bootstrap
  // `refresh()` call (started on mount) resolving *after* a more recent explicit action and
  // clobbering its state with stale data (a real race: mount-time refresh vs. a fast manual
  // login on the same page).
  private epoch = 0;

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<AuthState>): void {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener(this.state);
  }

  /** Attempts to restore a session from the refresh cookie on app load. Never throws. */
  async bootstrap(): Promise<void> {
    this.setState({ status: 'loading' });
    const token = await this.refresh();
    if (!token) this.setState({ accessToken: null, user: null, status: 'unauthenticated' });
  }

  async login(email: string, password: string): Promise<PublicUser> {
    this.epoch += 1;
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw new Error(body?.error?.message ?? 'Login failed');
    }
    const data = authResponseSchema.parse(await res.json());
    this.setState({ accessToken: data.accessToken, user: data.user, status: 'authenticated' });
    return data.user;
  }

  async logout(): Promise<void> {
    this.epoch += 1;
    const token = this.state.accessToken;
    this.setState({ accessToken: null, user: null, status: 'unauthenticated' });
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
    } catch {
      // Best-effort — local state is already cleared, which is what matters for the UI.
    }
  }

  /** Clears local state without hitting the network (server already revoked everything). */
  reset(): void {
    this.epoch += 1;
    this.setState({ accessToken: null, user: null, status: 'unauthenticated' });
  }

  updateUser(user: PublicUser): void {
    this.setState({ user });
  }

  /** Rotating refresh (P2) via the HttpOnly cookie. Coalesces concurrent callers into one call. */
  async refresh(): Promise<string | null> {
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }
    return this.refreshPromise;
  }

  private async doRefresh(): Promise<string | null> {
    const epochAtStart = this.epoch;
    try {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      if (this.epoch !== epochAtStart) return this.state.accessToken;
      if (!res.ok) {
        this.setState({ accessToken: null, user: null, status: 'unauthenticated' });
        return null;
      }
      const data = authResponseSchema.parse(await res.json());
      this.setState({ accessToken: data.accessToken, user: data.user, status: 'authenticated' });
      return data.accessToken;
    } catch {
      if (this.epoch !== epochAtStart) return this.state.accessToken;
      this.setState({ accessToken: null, user: null, status: 'unauthenticated' });
      return null;
    }
  }
}

export const authStore = new AuthStore();

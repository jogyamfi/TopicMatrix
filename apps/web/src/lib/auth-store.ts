import { authResponseSchema, type AuthResponse, type PublicUser } from '@topicmatrix/shared';
import { toApiError } from './api-error';
import { queryClient } from './query-client';
import { clearLauncherRun } from './launcher-store';

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

/** Cross-tab auth events (same browser, same origin). */
type AuthBroadcast = { type: 'signed-out' } | { type: 'signed-in'; userId: string };

function openAuthChannel(): BroadcastChannel | null {
  try {
    if (typeof BroadcastChannel === 'undefined') return null;
    const channel = new BroadcastChannel('topicmatrix-auth');
    // Node (tests) keeps the event loop alive for an open channel; browsers have no unref.
    (channel as { unref?: () => void }).unref?.();
    return channel;
  } catch {
    return null;
  }
}

class AuthStore {
  private state: AuthState = { accessToken: null, user: null, status: 'idle' };
  private listeners = new Set<Listener>();
  private refreshPromise: Promise<string | null> | null = null;
  // Bumped on every explicit login/logout/reset — guards against a slow, in-flight bootstrap
  // `refresh()` call (started on mount) resolving *after* a more recent explicit action and
  // clobbering its state with stale data (a real race: mount-time refresh vs. a fast manual
  // login on the same page).
  private epoch = 0;
  // Tabs share the refresh cookie but each holds its own in-memory access token, so a logout
  // (or another account signing in) in one tab is broadcast to the others — otherwise they'd keep
  // working as the old user until their access token expired.
  private channel = openAuthChannel();

  constructor() {
    if (this.channel) {
      this.channel.onmessage = (event: MessageEvent<AuthBroadcast>) => this.onBroadcast(event.data);
    }
  }

  private broadcast(message: AuthBroadcast): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // Best-effort: other tabs will still find out at their next refresh.
    }
  }

  private onBroadcast(message: AuthBroadcast): void {
    if (message.type === 'signed-out') {
      if (this.state.user) {
        this.epoch += 1;
        this.setState({ accessToken: null, user: null, status: 'unauthenticated' });
      }
      return;
    }
    // Someone signed in elsewhere: the shared cookie now belongs to them. Adopt it (or drop our
    // stale session) unless we already are that user.
    if (this.state.user?.id !== message.userId) {
      void this.refresh();
    }
  }

  getState(): AuthState {
    return this.state;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private setState(patch: Partial<AuthState>): void {
    const previousUserId = this.state.user?.id ?? null;
    this.state = { ...this.state, ...patch };
    const nextUserId = this.state.user?.id ?? null;
    if (previousUserId !== null && previousUserId !== nextUserId) {
      clearUserScopedState();
    }
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
      throw await toApiError(res);
    }
    const data = authResponseSchema.parse(await res.json());
    this.setState({ accessToken: data.accessToken, user: data.user, status: 'authenticated' });
    this.broadcast({ type: 'signed-in', userId: data.user.id });
    return data.user;
  }

  async logout(): Promise<void> {
    this.epoch += 1;
    const token = this.state.accessToken;
    this.setState({ accessToken: null, user: null, status: 'unauthenticated' });
    this.broadcast({ type: 'signed-out' });
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
    this.broadcast({ type: 'signed-out' });
  }

  updateUser(user: PublicUser): void {
    this.setState({ user });
  }

  /**
   * Takes over a session the server just issued outside login/refresh — a password change
   * returns a fresh access token (and sets a fresh refresh cookie) for this browser (R4).
   */
  adoptSession(session: AuthResponse): void {
    this.epoch += 1;
    this.setState({ accessToken: session.accessToken, user: session.user, status: 'authenticated' });
    // Other tabs' sessions were just ended by the server; the shared cookie is now this one.
    this.broadcast({ type: 'signed-in', userId: session.user.id });
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

/**
 * Everything cached on the client for the signed-in user — React Query's cache and the resumable
 * launcher run. Cleared whenever the user changes (logout, an expired session, or a different
 * account signing in on the same browser) so the next person never sees the previous user's
 * subjects, topics or review queue, not even briefly while a refetch is in flight.
 */
function clearUserScopedState(): void {
  queryClient.clear();
  clearLauncherRun();
}

export const authStore = new AuthStore();

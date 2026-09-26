import { afterEach, describe, expect, it, vi } from 'vitest';
import { authStore } from './auth-store';
import { queryClient } from './query-client';

function authResponse(userId: string): Response {
  return new Response(
    JSON.stringify({
      accessToken: `token-${userId}`,
      user: {
        id: userId,
        email: `${userId}@example.com`,
        displayName: userId,
        role: 'LEARNER',
        mustChangePassword: false,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function stubFetch(handler: (url: string) => Response): void {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => Promise.resolve(handler(input))),
  );
}

describe('authStore clears user-scoped client state', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    authStore.reset();
    queryClient.clear();
  });

  it('empties the query cache on logout', async () => {
    stubFetch(() => authResponse('alice'));
    await authStore.login('alice@example.com', 'correct horse battery');
    queryClient.setQueryData(['subjects'], { subjects: ['alice-only'] });

    stubFetch(() => new Response(JSON.stringify({ status: 'ok' }), { status: 200 }));
    await authStore.logout();

    expect(queryClient.getQueryData(['subjects'])).toBeUndefined();
  });

  it('empties the query cache when a different user signs in without logging out first', async () => {
    stubFetch(() => authResponse('alice'));
    await authStore.login('alice@example.com', 'correct horse battery');
    queryClient.setQueryData(['subjects'], { subjects: ['alice-only'] });

    stubFetch(() => authResponse('bob'));
    await authStore.login('bob@example.com', 'correct horse battery');

    expect(queryClient.getQueryData(['subjects'])).toBeUndefined();
  });

  it('keeps the cache when a token refresh returns the same user', async () => {
    stubFetch(() => authResponse('alice'));
    await authStore.login('alice@example.com', 'correct horse battery');
    queryClient.setQueryData(['subjects'], { subjects: ['alice-only'] });

    await authStore.refresh();

    expect(queryClient.getQueryData(['subjects'])).toEqual({ subjects: ['alice-only'] });
  });

  it('empties the query cache when the session expires (refresh rejected)', async () => {
    stubFetch(() => authResponse('alice'));
    await authStore.login('alice@example.com', 'correct horse battery');
    queryClient.setQueryData(['subjects'], { subjects: ['alice-only'] });

    stubFetch(() => new Response(JSON.stringify({ error: { code: 'UNAUTHORIZED' } }), { status: 401 }));
    await authStore.refresh();

    expect(authStore.getState().status).toBe('unauthenticated');
    expect(queryClient.getQueryData(['subjects'])).toBeUndefined();
  });

  it('surfaces a failed login as an ApiError carrying the server message', async () => {
    stubFetch(
      () =>
        new Response(
          JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again later.' } }),
          { status: 429 },
        ),
    );
    await expect(authStore.login('alice@example.com', 'x')).rejects.toMatchObject({
      name: 'ApiError',
      status: 429,
      code: 'RATE_LIMITED',
      message: 'Too many login attempts. Try again later.',
    });
  });

  it('signs this tab out when another tab signs out (BroadcastChannel)', async () => {
    stubFetch(() => authResponse('alice'));
    await authStore.login('alice@example.com', 'correct horse battery');
    queryClient.setQueryData(['subjects'], { subjects: ['alice-only'] });

    const otherTab = new BroadcastChannel('topicmatrix-auth');
    otherTab.postMessage({ type: 'signed-out' });
    otherTab.close();

    await vi.waitFor(() => expect(authStore.getState().status).toBe('unauthenticated'));
    expect(queryClient.getQueryData(['subjects'])).toBeUndefined();
  });

  it('adopts the new session when another tab signs in as a different user', async () => {
    stubFetch(() => authResponse('alice'));
    await authStore.login('alice@example.com', 'correct horse battery');

    // The other tab's login replaced the shared refresh cookie; our refresh now returns bob.
    stubFetch(() => authResponse('bob'));
    const otherTab = new BroadcastChannel('topicmatrix-auth');
    otherTab.postMessage({ type: 'signed-in', userId: 'bob' });
    otherTab.close();

    await vi.waitFor(() => expect(authStore.getState().user?.id).toBe('bob'));
  });
});

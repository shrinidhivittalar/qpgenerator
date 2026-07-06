/**
 * TC-ROLE-09: expired/missing access token -> apiFetch intercepts 401,
 * calls /api/auth/refresh, stores the new token, then retries the
 * original request exactly once, which succeeds.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stub browser globals before importing api.ts so storage and redirects work in node tests.
const storage = new Map<string, string>();
vi.stubGlobal('sessionStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
});
vi.stubGlobal('window', { location: { href: '' } });

import { apiFetch } from '../lib/api';
import { setAccessToken, getAccessToken, clearTokens } from '../lib/auth';

beforeEach(() => {
  storage.clear();
  clearTokens();
  vi.restoreAllMocks();
  vi.stubGlobal('window', { location: { href: '' } });
});

describe('TC-ROLE-09: 401 -> silent refresh -> retry', () => {
  it('retries the original request after a successful refresh and attaches the new token', async () => {
    setAccessToken('expired-token');

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'fresh-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    vi.stubGlobal('fetch', mockFetch);

    const res = await apiFetch('/api/some/resource');

    expect(res.status).toBe(200);

    const calls = mockFetch.mock.calls as [string, RequestInit][];
    const refreshCall = calls.find(([url]) => url === '/api/auth/refresh');
    expect(refreshCall).toBeTruthy();
    expect(refreshCall![1].method).toBe('POST');

    const retryHeaders = calls[2][1].headers as Record<string, string>;
    expect(retryHeaders['Authorization']).toBe('Bearer fresh-token');

    expect(getAccessToken()).toBe('fresh-token');
  });

  it('clears tokens and redirects when refresh itself fails (session fully expired)', async () => {
    setAccessToken('expired-token');

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    vi.stubGlobal('fetch', mockFetch);

    await expect(apiFetch('/api/some/resource')).rejects.toThrow('Session expired');

    expect(getAccessToken()).toBeNull();
    expect((window as { location: { href: string } }).location.href).toBe('/login');
  });

  it('does NOT retry more than once (isRetry flag prevents infinite loop)', async () => {
    setAccessToken('valid-token');

    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ accessToken: 'new-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 401 }));

    vi.stubGlobal('fetch', mockFetch);

    const res = await apiFetch('/api/some/resource');
    expect(res.status).toBe(401);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
import { describe, expect, it } from 'vitest';
import { ApiClient, ApiError, refreshTokenFrom, type TokenStore } from './api';

class MemoryTokens implements TokenStore {
  constructor(public token: string | null = null) {}
  load() { return this.token; }
  save(t: string | null) { this.token = t; }
}

const json = (status: number, body: unknown, cookie?: string) =>
  new Response(JSON.stringify(body), { status, headers: cookie ? { 'Content-Type': 'application/json', 'Set-Cookie': cookie } : { 'Content-Type': 'application/json' } });

describe('refreshTokenFrom', () => {
  it('reads the refresh cookie and ignores others', () => {
    const h = new Headers();
    h.append('Set-Cookie', 'other=1; Path=/');
    h.append('Set-Cookie', 'cd_refresh=abc.def; Path=/api/v1/auth; HttpOnly; SameSite=Strict');
    expect(refreshTokenFrom(h)).toBe('abc.def');
    expect(refreshTokenFrom(new Headers({ 'Set-Cookie': 'cd_refresh=; Max-Age=0' }))).toBeNull();
  });
});

describe('ApiClient', () => {
  it('signs in, keeps the refresh token, and refreshes once for concurrent 401s', async () => {
    const tokens = new MemoryTokens();
    const calls: string[] = [];
    let access = 'a1';
    const fetchImpl = (async (url: string, init: RequestInit) => {
      const path = url.replace('http://api/v1', '');
      calls.push(`${init.method} ${path}`);
      if (path === '/auth/login') return json(200, { status: true, data: { accessToken: access } }, 'cd_refresh=r1; Path=/api/v1/auth');
      if (path === '/auth/refresh') {
        expect(JSON.parse(String(init.body))).toEqual({ refreshToken: tokens.token });
        access = 'a2';
        return json(200, { status: true, data: { accessToken: access } }, 'cd_refresh=r2; Path=/api/v1/auth');
      }
      const auth = (init.headers as Record<string, string>).Authorization;
      if (auth !== 'Bearer a2') return json(401, { status: false, data: null, error: { message: 'Unauthorized' } });
      return json(200, { status: true, data: [] });
    }) as unknown as typeof fetch;

    const api = new ApiClient('http://api/v1/', tokens, fetchImpl);
    await api.login('me@x.com', 'pw');
    expect(tokens.token).toBe('r1');
    await Promise.all([api.drives(), api.devices()]);
    expect(calls.filter((c) => c.endsWith('/auth/refresh'))).toHaveLength(1);
    expect(tokens.token).toBe('r2');
  });

  it('turns error envelopes and network failures into ApiError', async () => {
    const tokens = new MemoryTokens('r');
    const failing = (async (url: string) => {
      if (url.endsWith('/auth/refresh')) return json(200, { status: true, data: { accessToken: 'a' } });
      return json(409, { status: false, data: null, error: { message: 'Name already in use', description: 'An item named "x" exists.' } });
    }) as unknown as typeof fetch;
    const err = await new ApiClient('http://api/v1', tokens, failing).drives().catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, message: 'Name already in use', description: 'An item named "x" exists.' });

    const offline = (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch;
    const down = await new ApiClient('http://api/v1', tokens, offline).drives().catch((e) => e);
    expect(down.offline).toBe(true);
  });

  it('forgets the session when the refresh token is refused', async () => {
    const tokens = new MemoryTokens('stale');
    let signedOut = false;
    const fetchImpl = (async () => json(401, { status: false, data: null, error: { message: 'Invalid refresh token' } })) as unknown as typeof fetch;
    const api = new ApiClient('http://api/v1', tokens, fetchImpl);
    api.onSignedOut = () => { signedOut = true; };
    await expect(api.devices()).rejects.toMatchObject({ status: 401 });
    expect(tokens.token).toBeNull();
    expect(signedOut).toBe(true);
  });
});

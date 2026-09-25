const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const http = require('node:http');
const express = require('express');
const crypto = require('node:crypto');
const path = require('node:path');
const secret = 'test-only-cookie-signing-secret-0123456789';

async function instance(t, overrides = {}) {
  const calls = [];
  const upstream = async config => { calls.push(config); return { data: { ok: true } }; };
  upstream.post = async () => ({ data: { access_token: 'private-discord-token' } });
  upstream.get = async url => ({ data: url.includes('users/@me')
    ? { id: '123', username: 'Alice', avatar: null }
    : { inVoice: true, guild_id: '456', channel_id: '789' } });
  let listens = 0;
  const wrapExpress = Object.assign(() => {
    const app = express();
    app.listen = () => { listens++; };
    return app;
  }, express);
  const mod = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'), 'utf8'), {
    require(name) {
      if (name === 'express') return wrapExpress;
      if (name === 'dotenv') return { config() {} };
      if (name === 'axios') return upstream;
      return require(name);
    }, module: mod, __dirname: path.resolve(__dirname, '..'), Buffer, URLSearchParams,
    process: { env: { VERCEL: '1', COOKIE_SECRET: secret, SESSION_SECRET: secret,
      DISCORD_CLIENT_ID: 'client', DISCORD_CLIENT_SECRET: 'secret',
      DISCORD_REDIRECT_URI: 'https://example.com/api/auth/callback', ...overrides } },
    console: { warn() {}, error() {}, log() {} },
  });
  const server = http.createServer(mod.exports);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return { app: mod.exports, listens, calls, upstream, async get(route, cookie = '', method = 'GET') {
    return new Promise((resolve, reject) => {
      const req = http.request(`http://127.0.0.1:${server.address().port}${route}`, {
        method, headers: { cookie, 'x-forwarded-proto': 'https' },
      }, res => {
        let body = '';
        res.on('data', chunk => body += chunk);
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
      });
      req.on('error', reject); req.end();
    });
  } };
}
function cookie(response, name) {
  return (response.headers['set-cookie'] || []).find(value => value.startsWith(name + '='))?.split(';')[0] || '';
}
async function login(t) {
  const first = await instance(t);
  const start = await first.get('/api/auth/discord');
  const state = new URL(start.headers.location).searchParams.get('state');
  const second = await instance(t);
  const result = await second.get(`/api/auth/callback?code=code&state=${state}`, cookie(start, 'bytebot_oauth'));
  return { first, second, start, result };
}

test('OAuth survives separate function instances with signed secure cookies', async t => {
  const { first, start, result } = await login(t);
  assert.equal(result.status, 302);
  assert.equal(result.headers.location, '/');
  assert.equal(first.listens, 0);
  assert.equal(first.app.get('trust proxy'), 1);
  for (const response of [start, result]) {
    assert.ok(response.headers['set-cookie'].some(value => /HttpOnly/.test(value) && /Secure/.test(value) && /SameSite=Lax/.test(value)));
  }
  const third = await instance(t);
  const auth = cookie(result, 'bytebot_auth');
  const status = await third.get('/api/voice/status', auth);
  assert.equal(status.status, 200);
  assert.equal(JSON.parse(status.body).user.id, '123');
  assert.equal(status.headers['cache-control'], 'no-store');
  const fourth = await instance(t);
  const command = await fourth.get('/api/player/pause', `${auth}; ${cookie(status, 'bytebot_voice')}`, 'POST');
  assert.equal(command.status, 200);
  assert.equal(fourth.calls[0].data.guild_id, '456');
});

test('missing, mismatched, forged and expired state are rejected', async t => {
  const app = await instance(t);
  const start = await app.get('/api/auth/discord');
  const state = new URL(start.headers.location).searchParams.get('state');
  assert.equal((await app.get(`/api/auth/callback?code=x&state=${state}`)).status, 400);
  assert.equal((await app.get('/api/auth/callback?code=x&state=wrong', cookie(start, 'bytebot_oauth'))).status, 400);
  for (const token of ['forged', signed('bytebot_oauth', { state, exp: 1 })]) {
    assert.equal((await app.get(`/api/auth/callback?code=x&state=${state}`, `bytebot_oauth=${token}`)).status, 400);
  }
});
function signed(name, payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return data + '.' + crypto.createHmac('sha256', secret).update(`${name}.${data}`).digest('base64url');
}

test('forged, expired and malformed authentication cookies cannot authenticate', async t => {
  const app = await instance(t);
  for (const value of ['123', '%not-valid', signed('bytebot_auth', { user: { id: '123' }, exp: 1 })]) {
    assert.equal((await app.get('/api/voice/status', `bytebot_auth=${value}`)).status, 401);
  }
  const { result } = await login(t);
  const auth = cookie(result, 'bytebot_auth');
  assert.equal((await app.get('/api/voice/status', auth + 'tampered')).status, 401);
});

test('API misses return JSON and frontend fallback remains last', async t => {
  const app = await instance(t);
  assert.equal((await app.get('/api/missing')).status, 404);
  assert.equal((await app.get('/api/missing', '', 'POST')).status, 404);
  assert.equal(JSON.parse((await app.get('/api/info')).body).status, 'ok');
  assert.equal((await app.get('/some/frontend/page')).status, 200);
});

test('missing signing secret fails closed', async t => {
  const app = await instance(t, { COOKIE_SECRET: '', SESSION_SECRET: '' });
  assert.equal((await app.get('/api/auth/discord')).status, 503);
});

test('callback honors configured frontend and never stores the Discord token', async t => {
  const app = await instance(t, { FRONTEND_REDIRECT_URL: '/player' });
  const start = await app.get('/api/auth/discord');
  const state = new URL(start.headers.location).searchParams.get('state');
  const response = await app.get(`/api/auth/callback?code=x&state=${state}`, cookie(start, 'bytebot_oauth'));
  assert.equal(response.headers.location, '/player');
  const value = decodeURIComponent(cookie(response, 'bytebot_auth').split('=')[1]);
  const payload = JSON.parse(Buffer.from(value.split('.')[0], 'base64url').toString());
  assert.equal(payload.user.id, '123');
  assert.equal(payload.access_token, undefined);
  assert.ok(!JSON.stringify(payload).includes('private-discord-token'));
  assert.ok(response.headers['set-cookie'].some(value => value.startsWith('bytebot_oauth=;')));
});

test('voice cookie belonging to another user cannot authorize a command', async t => {
  const { result } = await login(t);
  const app = await instance(t);
  const scope = signed('bytebot_voice', { user_id: '999', guild_id: '456', exp: Date.now() + 60000 });
  const response = await app.get('/api/player/pause', `${cookie(result, 'bytebot_auth')}; bytebot_voice=${scope}`, 'POST');
  assert.equal(response.status, 409);
  assert.equal(app.calls.length, 0);
});

test('Discord exchange failure returns an error without an authentication cookie', async t => {
  const app = await instance(t);
  const start = await app.get('/api/auth/discord');
  const state = new URL(start.headers.location).searchParams.get('state');
  app.upstream.post = async () => { throw new Error('upstream unavailable'); };
  const response = await app.get(`/api/auth/callback?code=x&state=${state}`, cookie(start, 'bytebot_oauth'));
  assert.equal(response.status, 500);
  assert.equal(cookie(response, 'bytebot_auth'), '');
});

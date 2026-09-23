const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function loadRoutes(upstream, voiceStatus = { inVoice: true, guild_id: '456' }) {
  upstream.get = async () => ({ data: voiceStatus });
  const routes = new Map();
  const app = { use() {}, get(path, handler) { routes.set(path, handler); }, post(path, handler) { routes.set(path, handler); }, listen() {} };
  const express = Object.assign(() => app, { json() {}, urlencoded() {} });
  vm.runInNewContext(fs.readFileSync(require.resolve('../app.js'), 'utf8'), {
    require(name) {
      if (name === 'express') return express;
      if (name === 'express-session') return () => {};
      if (name === 'dotenv') return { config() {} };
      if (name === 'axios') return upstream;
      return require(name);
    },
    process: { env: {} }, console: { warn() {}, error() {}, log() {} }, URLSearchParams,
  });
  return routes;
}

function loadSearch(upstream) { return loadRoutes(upstream).get('/api/player/search'); }

async function request(handler, query, session = { user_id: '123' }, body = {}) {
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
  assert.equal(typeof handler, 'function', 'search route must exist');
  await handler({ query, session, body }, response);
  return response;
}

test('search proxies q as query and preserves results', async () => {
  const results = { results: [{ title: 'Song', author: 'Artist', uri: 'https://example.com/song' }] };
  const handler = loadSearch(async config => {
    assert.equal(config.url, 'http://localhost:3001/internal/player/search?query=rock%20%26%20a%C3%A7%C3%A3o');
    assert.equal(config.method, 'GET');
    return { data: results };
  });
  const response = await request(handler, { q: ' rock & ação ' });
  assert.equal(response.code, 200);
  assert.equal(response.body, results);
});

test('search rejects anonymous sessions and returns empty results for invalid queries', async () => {
  let calls = 0;
  const handler = loadSearch(() => { calls += 1; throw new Error('unexpected upstream call'); });
  assert.equal((await request(handler, { q: 'song' }, {})).code, 401);
  const invalid = await request(handler, { q: ['one', 'two'] });
  assert.equal(invalid.code, 200);
  assert.equal(JSON.stringify(invalid.body), '{"results":[]}');
  assert.equal(JSON.stringify((await request(handler, { q: '  ' })).body), '{"results":[]}');
  assert.equal(calls, 0);
});

test('search returns empty results on upstream failure', async () => {
  const handler = loadSearch(async () => { throw new Error('offline'); });
  const response = await request(handler, { q: 'song' });
  assert.equal(response.code, 200);
  assert.equal(JSON.stringify(response.body), '{"results":[]}');
});


test('history is scoped to session guild and preserves rankings', async () => {
  const history = { recent: [{ title: 'Recent' }], mostPlayed: [{ title: 'Popular', playCount: 4 }] };
  const routes = loadRoutes(async config => {
    assert.equal(config.url, 'http://localhost:3001/internal/player/history/456');
    return { data: history };
  });
  const handler = routes.get('/api/player/history');
  assert.equal((await request(handler, {}, {})).code, 401);
  assert.equal((await request(handler, {})).code, 409);
  const response = await request(handler, { guild_id: 'untrusted' }, { user_id: '123', guild_id: '456' });
  assert.equal(response.body, history);
});

test('volume and resume use the session guild, validate volume, and forward zero', async () => {
  const calls = [];
  const routes = loadRoutes(async config => { calls.push(config); return { data: { ok: true } }; });
  const session = { user_id: '123', guild_id: '456' };
  const volume = routes.get('/api/player/volume');
  for (const value of [-1, 101, '50', null]) {
    assert.equal((await request(volume, {}, session, { volume: value })).code, 400);
  }
  await request(volume, {}, session, { volume: 0, guild_id: 'untrusted' });
  assert.equal(calls[0].url, 'http://localhost:3001/internal/player/volume');
  assert.equal(calls[0].data.guild_id, '456');
  assert.equal(calls[0].data.volume, 0);
  await request(routes.get('/api/player/play'), {}, session);
  assert.equal(calls[1].data.guild_id, '456');
  assert.equal(calls[1].data.user_id, '123');
  assert.equal(calls[1].data.query, undefined);
  await request(routes.get('/api/player/play'), {}, session, { query: ' https://example.com/song ' });
  assert.equal(calls[2].data.query, 'https://example.com/song');
});

test('state and history failures remain errors rather than fake idle or empty states', async () => {
  const routes = loadRoutes(async () => { throw new Error('offline'); });
  const session = { user_id: '123', guild_id: '456' };
  for (const path of ['/api/player/state', '/api/player/history', '/api/player/volume']) {
    assert.equal((await request(routes.get(path), {}, session, { volume: 50 })).code, 502);
  }
});


test('leaving voice or switching guild invalidates cached scope before commands/history', async () => {
  for (const status of [{ inVoice: false }, { inVoice: true, guild_id: '789' }]) {
    let calls = 0;
    const routes = loadRoutes(async () => { calls += 1; return { data: {} }; }, status);
    for (const path of ['/api/player/history', '/api/player/play', '/api/player/volume', '/api/player/pause', '/api/player/skip', '/api/player/state', '/api/player/queue']) {
      const session = { user_id: '123', guild_id: '456' };
      const response = await request(routes.get(path), {}, session, { volume: 50 });
      assert.equal(response.code, 409);
      assert.equal(session.guild_id, undefined);
    }
    assert.equal(calls, 0);
  }
});

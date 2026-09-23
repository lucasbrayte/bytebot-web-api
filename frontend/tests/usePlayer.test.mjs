import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { create } from 'react-test-renderer';
import { usePlayer } from '../hooks/usePlayer.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mountPlayer(t, respond) {
  const timers = new Map();
  let timerId = 0;
  const calls = [];
  const previousWindow = globalThis.window;
  globalThis.window = {
    setInterval(fn, ms) { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearInterval(id) { timers.delete(id); },
    setTimeout, clearTimeout,
    addEventListener() {}, removeEventListener() {},
  };
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    calls.push({ path, ...options });
    return respond(path, options);
  });
  let player;
  let renderer;
  function Probe(props) { player = usePlayer(props); return null; }
  await act(async () => { renderer = create(React.createElement(Probe)); });
  t.after(async () => {
    await act(async () => { renderer.unmount(); });
    globalThis.window = previousWindow;
  });
  return {
    get player() { return player; }, calls,
    async poll() { await act(async () => { for (const timer of timers.values()) if (timer.ms === 1000) timer.fn(); }); },
    async session(sessionKey) { await act(async () => { renderer.update(React.createElement(Probe, { sessionKey })); }); },
    async disable() { await act(async () => { renderer.update(React.createElement(Probe, { enabled: false })); }); },
  };
}

const track = { id: 'one', title: 'Primeira', artist: 'Artista', duration: 225 };
const json = data => new Response(JSON.stringify(data));

test('fila lenta não bloqueia a leitura de pausa nem a troca de faixa', async t => {
  let state = { track, current_time: 90, isPlaying: true };
  const h = await mountPlayer(t, (path, options) => path.endsWith('/state') ? json(state) : new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  }));
  assert.equal(h.player.track.title, 'Primeira');
  state = { track: { ...track, id: 'two', title: 'Segunda' }, current_time: 0, isPaused: true };
  await h.poll();
  assert.equal(h.player.track.title, 'Segunda');
  assert.equal(h.player.isPaused, true);
  assert.equal(h.calls.filter(call => call.path.endsWith('/queue')).length, 1);
});

test('comandos atualizam apenas após resposta do servidor e retomam pela rota play', async t => {
  let state = { track, current_time: 90, isPlaying: true };
  const h = await mountPlayer(t, (path, options) => {
    if (options.method === 'POST') {
      state = { ...state, isPlaying: path.endsWith('/play'), isPaused: path.endsWith('/pause') };
      return new Response(null, { status: 204 });
    }
    return json(path.endsWith('/state') ? state : { queue: [] });
  });
  await act(async () => { await h.player.togglePlayback(); });
  assert.equal(h.player.isPaused, true);
  assert.equal(h.player.currentTime, 90);
  await act(async () => { await h.player.togglePlayback(); });
  assert.equal(h.player.isPlaying, true);
  assert.deepEqual(h.calls.filter(c => c.method === 'POST').map(c => c.path), ['/api/player/pause', '/api/player/play']);
  await h.disable();
  assert.equal(h.player.track, null);
  const count = h.calls.length;
  await h.poll();
  assert.equal(h.calls.length, count);
});

test('falha de skip não troca a faixa nem a fila localmente', async t => {
  const h = await mountPlayer(t, (path, options) => options.method === 'POST'
    ? new Response('{}', { status: 502 })
    : json(path.endsWith('/state') ? { track, current_time: 90, isPlaying: true } : { queue: [{ title: 'Próxima' }] }));
  await act(async () => { assert.equal(await h.player.skip(), false); });
  assert.equal(h.player.track.title, 'Primeira');
  assert.equal(h.player.queue[0].title, 'Próxima');
  assert.match(h.player.commandError, /502/);
});

test('resposta atrasada é ignorada após sair do canal de voz', async t => {
  let resolveState;
  const h = await mountPlayer(t, path => path.endsWith('/state')
    ? new Promise(resolve => { resolveState = resolve; })
    : json({ queue: [] }));
  await h.disable();
  await act(async () => { resolveState(json({ track, current_time: 90, isPlaying: true })); });
  assert.equal(h.player.track, null);
  assert.equal(h.player.currentTime, 0);
  assert.equal(h.calls.find(c => c.path.endsWith('/state')).signal.aborted, true);
});


test('polling camelCase sincroniza faixa, fila e volume, e histórico respeita troca de sessão', async t => {
  let state = {
    currentTrack: { title: 'Song', author: 'Artist', uri: 'https://example.com/song' },
    currentTime: 12, duration: 100, isPlaying: true, volume: 100, capabilities: { volume: true },
  };
  const h = await mountPlayer(t, (path, options) => {
    if (options.method === 'POST') {
      if (path.endsWith('/volume')) state = { ...state, volume: JSON.parse(options.body).volume };
      return json({ ok: true });
    }
    if (path.endsWith('/state')) return json(state);
    if (path.endsWith('/history')) return json({ recent: [state.currentTrack], mostPlayed: [{ ...state.currentTrack, playCount: 3 }] });
    return json({ queue: [{ title: 'Next', author: 'Other' }] });
  });
  assert.equal(h.player.track.artist, 'Artist');
  assert.equal(h.player.currentTime, 12);
  assert.equal(h.player.queue[0].artist, 'Other');
  assert.equal(h.player.mostPlayed[0].playCount, 3);
  state = { ...state, currentTime: 13, isPlaying: false, isPaused: true };
  await h.poll();
  assert.equal(h.player.currentTime, 13);
  assert.equal(h.player.isPaused, true);
  assert.equal(h.calls.filter(call => call.path.endsWith('/state')).length, 2);
  assert.equal(h.calls.filter(call => call.path.endsWith('/queue')).length, 2);
  await act(async () => { assert.equal(await h.player.setVolume(0), true); });
  assert.equal(h.player.volume, 0);
  state = { ...state, currentTrack: { title: 'Other guild', author: 'Another' } };
  await h.session('other-guild');
  assert.equal(h.player.recent[0].title, 'Other guild');
  await h.disable();
  assert.deepEqual(h.player.recent, []);
  assert.deepEqual(h.player.mostPlayed, []);
});

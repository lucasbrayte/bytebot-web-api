import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { create } from 'react-test-renderer';
import { useTrackSearch } from '../hooks/useTrackSearch.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function mountSearch(t) {
  const timers = new Map();
  const calls = [];
  let id = 0;
  const previousWindow = globalThis.window;
  globalThis.window = {
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  t.mock.method(globalThis, 'fetch', (url, options) => new Promise(resolve => calls.push({ url, options, resolve })));
  let state;
  let renderer;
  function Probe(props) { state = useTrackSearch(props.query, props.enabled); return null; }
  const update = async (query, enabled = true) => {
    await act(async () => { renderer.update(React.createElement(Probe, { query, enabled })); });
  };
  await act(async () => { renderer = create(React.createElement(Probe, { query: '', enabled: true })); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.window = previousWindow; });
  return {
    calls, timers, update, get state() { return state; },
    async debounce() {
      await act(async () => {
        for (const [key, timer] of [...timers]) if (timer.ms === 300) { timers.delete(key); timer.fn(); }
      });
    },
    async respond(index, data, status = 200) {
      await act(async () => calls[index].resolve(new Response(JSON.stringify(data), { status })));
    },
  };
}

test('debounces text, encodes query and displays only the newest response', async t => {
  const h = await mountSearch(t);
  await h.update('r');
  await h.update('rock & ação');
  assert.equal(h.calls.length, 0);
  assert.equal([...h.timers.values()].filter(timer => timer.ms === 300).length, 1);
  await h.debounce();
  assert.equal(h.calls[0].url, '/api/player/search?q=rock%20%26%20a%C3%A7%C3%A3o');
  await h.update('jazz');
  assert.equal(h.calls[0].options.signal.aborted, true);
  await h.debounce();
  await h.respond(1, { results: [{ title: 'Jazz', uri: 'https://example.com/jazz' }] });
  await h.respond(0, { results: [{ title: 'Rock' }] });
  assert.equal(h.state.results[0].title, 'Jazz');
  assert.equal(h.state.loading, false);
});

test('clearing or closing search aborts requests and removes results', async t => {
  const h = await mountSearch(t);
  await h.update('song');
  await h.debounce();
  await h.update('');
  assert.equal(h.calls[0].options.signal.aborted, true);
  await h.respond(0, { results: [{ title: 'Old result' }] });
  assert.deepEqual(h.state.results, []);
  await h.update('song', false);
  await h.debounce();
  assert.equal(h.calls.length, 1);
});

test('search errors are visible and a later query can recover', async t => {
  const h = await mountSearch(t);
  await h.update('song');
  await h.debounce();
  await h.respond(0, {}, 502);
  assert.ok(h.state.error);
  assert.equal(h.state.loading, false);
  await h.update('another');
  await h.debounce();
  await h.respond(1, { results: [] });
  assert.equal(h.state.error, '');
  assert.deepEqual(h.state.results, []);
});

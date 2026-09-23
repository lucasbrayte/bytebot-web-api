import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { create } from 'react-test-renderer';
import { componentUrl } from './helpers/jsx.mjs';
import { requestPlayer } from '../lib/player.mjs';

const { default: TrackSearch } = await import(await componentUrl(new URL('../components/TrackSearch.js', import.meta.url)));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

test('selecting a result posts its URI and clears/closes the dropdown', async t => {
  const previousWindow = globalThis.window;
  const timers = new Map();
  let id = 0;
  globalThis.window = {
    setTimeout(fn, ms) { timers.set(++id, { fn, ms }); return id; },
    clearTimeout(key) { timers.delete(key); },
  };
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    if (options.method === 'POST') {
      posts.push({ path, body: JSON.parse(options.body) });
      return new Response('{}');
    }
    return new Response(JSON.stringify({ results: [{
      title: 'Song', author: 'Artist', duration: 123,
      thumbnail: 'https://example.com/cover.jpg', uri: 'https://example.com/song',
    }] }));
  });
  let renderer;
  await act(async () => { renderer = create(React.createElement(TrackSearch, {
    enabled: true, canPlay: true, pending: false,
    onPlay: query => requestPlayer('/api/player/play', { method: 'POST', body: { query } }),
  })); });
  t.after(async () => { await act(async () => renderer.unmount()); globalThis.window = previousWindow; });
  await act(async () => renderer.root.findByType('input').props.onChange({ target: { value: 'song' } }));
  await act(async () => {
    for (const [key, timer] of [...timers]) if (timer.ms === 300) { timers.delete(key); timer.fn(); }
  });
  const result = renderer.root.findByType('button');
  assert.match(JSON.stringify(result.toJSON?.() || renderer.toJSON()), /Artist/);
  assert.match(JSON.stringify(renderer.toJSON()), /2:03/);
  assert.equal(renderer.root.findByType('img').props.src, 'https://example.com/cover.jpg');
  await act(async () => result.props.onClick());
  assert.deepEqual(posts, [{ path: '/api/player/play', body: { query: 'https://example.com/song' } }]);
  assert.equal(renderer.root.findByType('input').props.value, '');
  assert.equal(renderer.root.findByType('input').props['aria-expanded'], false);
  assert.equal(renderer.root.findAllByType('button').length, 0);
});

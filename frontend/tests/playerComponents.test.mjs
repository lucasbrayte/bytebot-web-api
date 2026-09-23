import test from 'node:test';
import assert from 'node:assert/strict';
import React, { act } from 'react';
import { create } from 'react-test-renderer';
import { componentUrl } from './helpers/jsx.mjs';
import { requestPlayer } from '../lib/player.mjs';

const { default: MusicHistory } = await import(await componentUrl(new URL('../components/MusicHistory.js', import.meta.url)));
const { default: PlayerBar } = await import(await componentUrl(new URL('../components/PlayerBar.js', import.meta.url)));
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const song = { title: 'Song', artist: 'Artist', thumbnail: 'https://example.com/cover.jpg', uri: 'https://example.com/song', duration: 120, playCount: 3 };

test('recent and popular cards render metadata and play the selected URI with one click', async t => {
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    posts.push({ path, body: JSON.parse(options.body) });
    return new Response('{}');
  });
  const player = {
    recent: [song], mostPlayed: [song], historyLoading: false, historyError: '', pending: false,
    play: query => requestPlayer('/api/player/play', { method: 'POST', body: { query } }),
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(MusicHistory, { player, enabled: true })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  assert.deepEqual(renderer.root.findAllByType('h2').map(node => node.children.join('')), ['Tocadas Recentemente', 'Mais Tocadas no Servidor']);
  assert.equal(renderer.root.findAllByType('img').length, 2);
  assert.match(JSON.stringify(renderer.toJSON()), /Artist/);
  for (const button of renderer.root.findAllByType('button')) await act(async () => button.props.onClick());
  assert.deepEqual(posts, Array(2).fill({ path: '/api/player/play', body: { query: song.uri } }));
  await act(async () => renderer.update(React.createElement(MusicHistory, { player: { ...player, pending: true }, enabled: true })));
  assert.ok(renderer.root.findAllByType('button').every(button => button.props.disabled));
});

test('footer reflects playing/paused state and commits volume zero only once', async t => {
  const posts = [];
  t.mock.method(globalThis, 'fetch', async (path, options) => {
    posts.push({ path, body: JSON.parse(options.body) });
    return new Response('{}');
  });
  const player = {
    track: song, pending: false, synced: true, isPlaying: true, currentTime: 30, duration: 120,
    canSetVolume: true, volume: 50, canSeek: false,
    setVolume: volume => requestPlayer('/api/player/volume', { method: 'POST', body: { volume } }),
  };
  let renderer;
  await act(async () => { renderer = create(React.createElement(PlayerBar, { player, channelName: 'Voice' })); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  assert.equal(renderer.root.findAllByType('button')[0].props['aria-label'], 'Pausar');
  assert.equal(renderer.root.findByProps({ 'aria-label': 'Progresso da música' }).props.value, 30);
  const volume = () => renderer.root.findByProps({ 'aria-label': 'Volume' });
  await act(async () => volume().props.onChange({ target: { value: '0' } }));
  await act(async () => {
    const event = { currentTarget: { value: '0' } };
    const committing = volume().props.onPointerUp(event);
    volume().props.onBlur(event);
    await committing;
  });
  assert.deepEqual(posts, [{ path: '/api/player/volume', body: { volume: 0 } }]);
  await act(async () => renderer.update(React.createElement(PlayerBar, { player: { ...player, isPlaying: false, isPaused: true } })));
  assert.equal(renderer.root.findAllByType('button')[0].props['aria-label'], 'Reproduzir');
});

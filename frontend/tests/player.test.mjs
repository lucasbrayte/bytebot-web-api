import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePlayerState, elapsedTime, progressPercent, formatTime, requestPlayer } from '../lib/player.mjs';

const song = { title: 'Faixa real', artist: 'Artista', thumbnail: 'https://example.com/cover.jpg', duration: 225 };

test('normaliza faixa aninhada e pausa tem precedência sobre reprodução', () => {
  const state = normalizePlayerState({ track: song, current_time: 90, isPlaying: true, isPaused: true });
  assert.deepEqual(state.track, song);
  assert.equal(state.current_time, 90);
  assert.equal(state.duration, 225);
  assert.equal(state.isPlaying, false);
  assert.equal(state.isPaused, true);
});

test('aceita estado plano e protege tempos inválidos e ausência de faixa', () => {
  const state = normalizePlayerState({ ...song, current_time: -8, isPlaying: true });
  assert.equal(state.track.title, 'Faixa real');
  assert.equal(state.current_time, 0);
  assert.equal(normalizePlayerState({ track: null, current_time: 90, isPlaying: true }).isPlaying, false);
  assert.equal(normalizePlayerState({ ...song, duration: 'invalid' }).duration, 0);
});

test('interpola segundos, congela pausa e limita o avanço à duração', () => {
  const state = normalizePlayerState({ track: song, current_time: 90, isPlaying: true });
  assert.equal(elapsedTime(state, 1000, 3500), 92.5);
  assert.equal(elapsedTime({ ...state, isPlaying: false }, 1000, 3500), 90);
  assert.equal(elapsedTime(state, 1000, 999000), 225);
  assert.equal(elapsedTime({ ...state, duration: 0 }, 1000, 3500), 92.5);
});

test('formata tempos e calcula preenchimento sem NaN nem divisão por zero', () => {
  assert.equal(formatTime(90), '1:30');
  assert.equal(formatTime(225), '3:45');
  assert.equal(formatTime(NaN), '0:00');
  assert.equal(progressPercent(90, 225), 40);
  assert.equal(progressPercent(90, 0), 0);
  assert.equal(progressPercent(300, 225), 100);
});

test('volume e seek só são habilitados quando anunciados pela API', () => {
  assert.equal(normalizePlayerState({ track: song, volume: 50 }).canSetVolume, false);
  const state = normalizePlayerState({ track: song, volume: 0, capabilities: { volume: true, seek: true } });
  assert.equal(state.canSetVolume, true);
  assert.equal(state.canSeek, true);
  assert.equal(state.volume, 0);
});

test('requisições enviam sessão, não usam cache e aceitam comandos sem JSON', async (t) => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    calls.push({ url, options });
    return new Response(null, { status: 204 });
  });
  assert.equal(await requestPlayer('/api/player/pause', { method: 'POST' }), null);
  assert.equal(calls[0].url, '/api/player/pause');
  assert.equal(calls[0].options.credentials, 'include');
  assert.equal(calls[0].options.cache, 'no-store');
});

test('404 HTML e 401 retornam erros úteis em vez de falhar no parser JSON', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>Not found</html>', { status: 404 }));
  await assert.rejects(requestPlayer('/api/player/state'), /não está disponível/);
  globalThis.fetch.mock.mockImplementation(async () => new Response('{}', { status: 401 }));
  await assert.rejects(requestPlayer('/api/player/state'), error => error.status === 401);
});

test('suporta API que informa apenas isPaused, respeitando isPlaying explícito', () => {
  assert.equal(normalizePlayerState({ track: song, isPaused: false }).isPlaying, true);
  assert.equal(normalizePlayerState({ track: song, isPaused: true }).isPlaying, false);
  assert.equal(normalizePlayerState({ track: song, isPaused: false, isPlaying: false }).isPlaying, false);
});

test('normaliza o contrato camelCase do bot e os metadados da faixa', () => {
  const state = normalizePlayerState({
    currentTrack: { title: 'Song', author: 'Artist', thumbnail: 'https://example.com/cover.jpg', uri: 'https://example.com/song' },
    currentTime: 24.5, duration: 120, isPlaying: true, isPaused: false,
    volume: 35, capabilities: { volume: true },
  });
  assert.equal(state.track.artist, 'Artist');
  assert.equal(state.track.url, 'https://example.com/song');
  assert.equal(state.track.thumbnail, 'https://example.com/cover.jpg');
  assert.equal(state.current_time, 24.5);
  assert.equal(state.duration, 120);
  assert.equal(state.isPlaying, true);
  assert.equal(state.canSetVolume, true);
  assert.equal(state.volume, 35);
});

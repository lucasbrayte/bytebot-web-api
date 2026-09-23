'use client';

import { useEffect, useRef, useState } from 'react';
import { elapsedTime, normalizePlayerState, normalizeTrack, progressPercent, requestPlayer } from '../lib/player.mjs';

const emptyPlayer = normalizePlayerState();
const initialState = {
  ...emptyPlayer, queue: [], loading: true, error: '', queueError: '',
  commandError: '', pending: false, synced: false,
  recent: [], mostPlayed: [], historyLoading: true, historyError: '',
};

export function usePlayer({ enabled = true, sessionKey = '' } = {}) {
  const [player, setPlayer] = useState(initialState);
  const [currentTime, setCurrentTime] = useState(0);
  const actions = useRef(null);

  useEffect(() => {
    let disposed = false;
    const requests = new Map();
    let sessionInvalid = false;
    let commandPending = false;
    let revision = 0;
    let snapshot = emptyPlayer;
    let receivedAt = performance.now();
    let commandController;
    setPlayer({ ...initialState, loading: enabled, historyLoading: enabled });
    setCurrentTime(0);
    if (!enabled) return undefined;

    function freezeClock() {
      snapshot = { ...snapshot, current_time: elapsedTime(snapshot, receivedAt, performance.now()), isPlaying: false };
      receivedAt = performance.now();
      setCurrentTime(snapshot.current_time);
    }

    async function poll(path, accept, reject) {
      if (disposed || requests.has(path) || commandPending) return;
      const requestRevision = revision;
      const controller = new AbortController();
      requests.set(path, controller);
      const timeout = window.setTimeout(() => controller.abort(), 8000);
      const isCurrent = () => !disposed && requestRevision === revision;
      try {
        const data = await requestPlayer(path, { signal: controller.signal });
        if (isCurrent()) accept(data);
      } catch (error) {
        if (isCurrent()) reject(error);
      } finally {
        window.clearTimeout(timeout);
        if (requests.get(path) === controller) requests.delete(path);
      }
    }

    function refreshState() {
      return poll('/api/player/state', data => {
        if (!data) throw new Error('A API retornou um estado vazio.');
        const next = normalizePlayerState(data);
        sessionInvalid = false;
        snapshot = next;
        receivedAt = performance.now();
        setCurrentTime(next.current_time);
        setPlayer(previous => ({ ...previous, ...next, loading: false, error: '', synced: true }));
      }, error => {
        freezeClock();
        if (error.status === 401 || error.status === 409) {
          sessionInvalid = true;
          snapshot = emptyPlayer;
          setCurrentTime(0);
          setPlayer(previous => ({ ...previous, ...emptyPlayer, queue: [], recent: [], mostPlayed: [] }));
        }
        setPlayer(previous => ({ ...previous, loading: false, synced: false, error: error.name === 'AbortError' ? 'A consulta do player demorou demais.' : error.message }));
      });
    }

    function refreshQueue() {
      return poll('/api/player/queue', data => {
        const queue = Array.isArray(data) ? data : data?.queue;
        if (!Array.isArray(queue) || queue.some(item => !item || typeof item !== 'object')) throw new Error('A API retornou uma fila inválida.');
        if (!sessionInvalid) setPlayer(previous => ({ ...previous, queue: queue.map(normalizeTrack), queueError: '' }));
      }, error => {
        setPlayer(previous => ({ ...previous, queue: [], queueError: error.name === 'AbortError' ? 'A consulta da fila demorou demais.' : error.message }));
      });
    }

    function refreshHistory() {
      return poll('/api/player/history', data => {
        if (!Array.isArray(data?.recent) || !Array.isArray(data?.mostPlayed)) throw new Error('A API retornou um histórico inválido.');
        if (!sessionInvalid) setPlayer(previous => ({
          ...previous, recent: data.recent.map(normalizeTrack).filter(Boolean),
          mostPlayed: data.mostPlayed.map(normalizeTrack).filter(Boolean), historyLoading: false, historyError: '',
        }));
      }, error => {
        setPlayer(previous => ({ ...previous, historyLoading: false, historyError: error.name === 'AbortError' ? 'A consulta do histórico demorou demais.' : error.message }));
      });
    }

    function refresh() {
      // Independent locks keep state polling responsive even if the queue hangs.
      refreshQueue();
      return refreshState();
    }

    async function command(path, body) {
      if (disposed || commandPending) return false;
      commandPending = true;
      revision += 1;
      for (const controller of requests.values()) controller.abort();
      requests.clear();
      setPlayer(previous => ({ ...previous, pending: true, commandError: '' }));
      const controller = new AbortController();
      commandController = controller;
      const timeout = window.setTimeout(() => controller.abort(), body?.query ? 65000 : 10000);
      let success = false;
      try {
        await requestPlayer(path, { method: 'POST', body, signal: controller.signal });
        success = true;
      } catch (error) {
        if (!disposed) setPlayer(previous => ({ ...previous, commandError: error.name === 'AbortError' ? 'O comando demorou demais. Verifique o estado antes de tentar novamente.' : error.message }));
      } finally {
        window.clearTimeout(timeout);
        commandPending = false;
        if (!disposed) {
          // Only the server decides whether playback or the current track changed.
          refreshHistory();
          await refresh();
          if (!disposed) setPlayer(previous => ({ ...previous, pending: false }));
        }
      }
      return success;
    }

    actions.current = { command, refresh };
    refresh();
    refreshHistory();
    const historyTimer = window.setInterval(refreshHistory, 10000);
    const pollingTimer = window.setInterval(refresh, 1000);
    const clockTimer = window.setInterval(() => {
      setCurrentTime(elapsedTime(snapshot, receivedAt, performance.now()));
    }, 250);
    window.addEventListener('focus', refresh);
    return () => {
      disposed = true;
      revision += 1;
      for (const controller of requests.values()) controller.abort();
      commandController?.abort();
      window.clearInterval(pollingTimer);
      window.clearInterval(historyTimer);
      window.clearInterval(clockTimer);
      window.removeEventListener('focus', refresh);
      actions.current = null;
    };
  }, [enabled, sessionKey]);

  const command = (path, body) => actions.current?.command(path, body) ?? Promise.resolve(false);
  return {
    ...player,
    currentTime,
    progress: progressPercent(currentTime, player.duration),
    play: query => query?.trim() ? command('/api/player/play', { query: query.trim() }) : Promise.resolve(false),
    togglePlayback: () => player.track && player.synced ? command(player.isPlaying ? '/api/player/pause' : '/api/player/play') : Promise.resolve(false),
    skip: () => player.track && player.synced ? command('/api/player/skip') : Promise.resolve(false),
    setVolume: value => player.canSetVolume && player.synced && Number.isFinite(value) ? command('/api/player/volume', { volume: Math.max(0, Math.min(100, value)) }) : Promise.resolve(false),
    seek: value => player.canSeek && player.synced && Number.isFinite(value) ? command('/api/player/seek', { position: Math.max(0, Math.min(player.duration, value)) }) : Promise.resolve(false),
  };
}

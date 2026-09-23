'use client';

import { useEffect, useState } from 'react';
import { requestPlayer } from '../lib/player.mjs';

const empty = { results: [], loading: false, error: '' };

export function useTrackSearch(query, enabled = true) {
  const term = query.trim();
  const [state, setState] = useState({ ...empty, term: '' });

  useEffect(() => {
    if (!enabled || !term) {
      setState({ ...empty, term });
      return undefined;
    }
    let disposed = false;
    let timeout;
    const controller = new AbortController();
    setState({ ...empty, term, loading: true });
    const timer = window.setTimeout(async () => {
      timeout = window.setTimeout(() => controller.abort(), 55000);
      try {
        const data = await requestPlayer(`/api/player/search?q=${encodeURIComponent(term)}`, { signal: controller.signal });
        const results = Array.isArray(data) ? data : data?.results;
        if (!Array.isArray(results)) throw new Error('A API retornou uma busca inválida.');
        if (!disposed) setState({ term, results: results.filter(item => item && typeof item === 'object'), loading: false, error: '' });
      } catch (error) {
        if (!disposed) setState({ ...empty, term, error: error.name === 'AbortError' ? 'A busca demorou demais. Tente novamente.' : error.message });
      } finally {
        window.clearTimeout(timeout);
      }
    }, 300);
    return () => {
      disposed = true;
      controller.abort();
      window.clearTimeout(timer);
      window.clearTimeout(timeout);
    };
  }, [term, enabled]);

  if (!enabled || !term) return empty;
  return state.term === term ? state : { ...empty, loading: true };
}

'use client';

import { useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { useTrackSearch } from '../hooks/useTrackSearch.mjs';
import { formatTime } from '../lib/player.mjs';
import TrackArtwork from './TrackArtwork';

export default function TrackSearch({ enabled, canPlay, pending, onPlay }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const submitting = useRef(false);
  const listId = useId();
  const { results, loading, error } = useTrackSearch(query, enabled && open);
  const visible = enabled && open && Boolean(query.trim());

  function close() {
    setOpen(false);
    setActive(-1);
  }

  function play(value) {
    if (!canPlay || pending || submitting.current || !value?.trim()) return;
    submitting.current = true;
    setQuery('');
    close();
    // The shared player hook reports command errors and refreshes player state.
    Promise.resolve(onPlay(value)).finally(() => { submitting.current = false; });
  }

  function select(track) {
    play(track.uri || track.url || track.webpage_url || track.query || track.title);
  }

  function onKeyDown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      close();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setOpen(true);
      if (results.length) setActive(previous => event.key === 'ArrowDown'
        ? (previous + 1) % results.length
        : (previous <= 0 ? results.length - 1 : previous - 1));
    }
  }

  return (
    <form className="search-wrap" role="search"
      onSubmit={event => {
        event.preventDefault();
        if (visible && active >= 0 && results[active]) select(results[active]);
        else play(query);
      }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) close(); }}>
      <Search size={18} aria-hidden="true" />
      <input disabled={!enabled || pending} value={query}
        onChange={event => { setQuery(event.target.value); setActive(-1); setOpen(true); }}
        onFocus={() => setOpen(true)} onKeyDown={onKeyDown}
        placeholder="Search a track, link, or playlist..." aria-label="Buscar música"
        role="combobox" aria-autocomplete="list" aria-expanded={visible}
        aria-controls={visible ? listId : undefined}
        aria-activedescendant={visible && active >= 0 && results[active] ? `${listId}-${active}` : undefined}
        autoComplete="off" />
      <kbd>/</kbd>
      {visible && <div className="search-dropdown">
        {loading ? <p className="search-message" role="status">Buscando músicas...</p>
          : error ? <p className="search-message search-error" role="status">{error}</p>
            : !results.length ? <p className="search-message" role="status">Nenhuma música encontrada.</p> : null}
        {!canPlay && <p className="search-message">Entre em um canal de voz para reproduzir.</p>}
        <ul id={listId} role="listbox" aria-label="Resultados da busca" aria-busy={loading}>
          {results.map((track, index) => <li key={`${track.uri || track.url || track.title}-${index}`}
            id={`${listId}-${index}`} role="option" aria-selected={active === index}>
            <button type="button" className={`search-result ${active === index ? 'search-result-active' : ''}`}
              disabled={!canPlay || pending} onMouseDown={event => event.preventDefault()}
              onMouseEnter={() => setActive(index)} onFocus={() => setActive(index)}
              onKeyDown={event => { if (event.key === 'Escape') close(); }}
              onClick={() => select(track)}>
              <TrackArtwork track={track} small />
              <span className="search-result-copy"><strong>{track.title || 'Sem título'}</strong><small>{track.author || track.artist || 'Artista desconhecido'}</small></span>
              <span className="search-result-duration">{track.duration == null ? '—' : formatTime(track.duration)}</span>
            </button>
          </li>)}
        </ul>
      </div>}
    </form>
  );
}

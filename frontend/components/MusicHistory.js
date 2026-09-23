'use client';

import { Play } from 'lucide-react';
import TrackArtwork from './TrackArtwork';
import { formatTime } from '../lib/player.mjs';

export default function MusicHistory({ player, enabled }) {
  const sections = [
    { title: 'Tocadas Recentemente', tracks: player.recent, popular: false },
    { title: 'Mais Tocadas no Servidor', tracks: player.mostPlayed, popular: true },
  ];
  return (
    <div className="music-history">
      {sections.map(({ title, tracks, popular }) => <section className="history-section" key={title} aria-label={title}>
        <h2>{title}</h2>
        {player.historyError ? <p className="player-empty" role="status">{player.historyError}</p>
          : !tracks.length ? <p className="player-empty">{!enabled ? 'Entre em um canal de voz para ver as músicas do servidor.' : player.historyLoading ? 'Carregando músicas...' : 'As músicas aparecerão aqui quando forem reproduzidas.'}</p> : null}
        <div className="history-tracks">
          {tracks.slice(0, 6).map(track => <article className="history-track" key={track.uri || track.url}>
            <TrackArtwork track={track} />
            <strong title={track.title}>{track.title || 'Sem título'}</strong>
            <span title={track.artist || track.author}>{track.artist || track.author || 'Artista desconhecido'}</span>
            <div className="history-track-actions">
              <small>{popular ? `${track.playCount} ${track.playCount === 1 ? 'reprodução' : 'reproduções'}` : formatTime(track.duration)}</small>
              <button type="button" className="history-play" disabled={!enabled || player.pending}
                aria-label={`Reproduzir ${track.title}`} onClick={() => player.play(track.uri || track.url)}>
                <Play size={15} fill="currentColor" aria-hidden="true" />
              </button>
            </div>
          </article>)}
        </div>
      </section>)}
    </div>
  );
}

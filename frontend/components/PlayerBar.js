'use client';

import { useRef, useState } from 'react';
import { Mic2, Pause, Play, SkipForward, Volume2, VolumeX } from 'lucide-react';
import TrackArtwork from './TrackArtwork';
import { formatTime, progressPercent } from '../lib/player.mjs';

export default function PlayerBar({ player, channelName }) {
  const [seekDraft, setSeekDraft] = useState(null);
  const [volumeDraft, setVolumeDraft] = useState(null);
  const volumeCommitPending = useRef(false);
  const disabled = player.pending || !player.synced || !player.track;
  const displayedTime = seekDraft ?? player.currentTime;
  const volume = volumeDraft ?? player.volume ?? 0;

  function commitSeek(event) {
    if (seekDraft === null) return;
    player.seek(Number(event.currentTarget.value));
    setSeekDraft(null);
  }

  async function commitVolume(event) {
    if (volumeDraft === null || volumeCommitPending.current) return;
    volumeCommitPending.current = true;
    try {
      await player.setVolume(Number(event.currentTarget.value));
    } finally {
      volumeCommitPending.current = false;
      setVolumeDraft(null);
    }
  }

  return (
    <footer className="player-bar" aria-label="Player de música" aria-busy={player.pending}>
      <div className="player-track">
        <TrackArtwork track={player.track} small />
        <div><strong>{player.track?.title || 'Nenhuma música tocando'}</strong><span>{player.track?.artist || '—'}</span></div>
      </div>
      <div className="player-controls">
        <div className="control-row">
          <button className="play-button" disabled={disabled} onClick={player.togglePlayback} aria-label={player.isPlaying ? 'Pausar' : 'Reproduzir'}>
            {player.isPlaying ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
          </button>
          <button className="control-button" disabled={disabled} onClick={player.skip} aria-label="Próxima faixa"><SkipForward size={18} fill="currentColor" /></button>
          <div className="volume-control" title={player.canSetVolume ? 'Volume' : 'Ajuste de volume indisponível'}>
            {volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
            <input type="range" min="0" max="100" step="1" value={volume} disabled={disabled || !player.canSetVolume} aria-label="Volume" aria-valuetext={`${volume}%`} onChange={event => setVolumeDraft(Number(event.target.value))} onPointerUp={commitVolume} onKeyUp={commitVolume} onBlur={commitVolume} onPointerCancel={() => setVolumeDraft(null)} />
          </div>
        </div>
        <div className="progress-row">
          <span>{formatTime(displayedTime)}</span>
          <input className="playback-progress" type="range" min="0" max={player.duration || 1} step="1" value={Math.min(displayedTime, player.duration || 1)} disabled={disabled || !player.canSeek} aria-label="Progresso da música" aria-valuetext={`${formatTime(displayedTime)} de ${formatTime(player.duration)}`} title={player.canSeek ? 'Alterar posição' : 'Progresso sincronizado; avanço manual indisponível'} style={{ '--progress': `${progressPercent(displayedTime, player.duration)}%` }} onChange={event => setSeekDraft(Number(event.target.value))} onPointerUp={commitSeek} onKeyUp={commitSeek} onBlur={commitSeek} onPointerCancel={() => setSeekDraft(null)} />
          <span>{formatTime(player.duration)}</span>
        </div>
      </div>
      <div className="player-context"><Mic2 size={16} /><span>{channelName || 'Sem canal de voz'}</span></div>
    </footer>
  );
}

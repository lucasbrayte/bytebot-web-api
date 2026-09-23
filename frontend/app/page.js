'use client';

import { useState } from 'react';
import { useVoiceStatus } from '../hooks/useVoiceStatus';
import DiscordProfile from '../components/DiscordProfile';
import { usePlayer } from '../hooks/usePlayer.mjs';
import TrackArtwork from '../components/TrackArtwork';
import PlayerBar from '../components/PlayerBar';
import MusicHistory from '../components/MusicHistory';
import TrackSearch from '../components/TrackSearch';
import { formatTime } from '../lib/player.mjs';
import {
  Disc3,
  Home,
  ListMusic,
  LogIn,
  Menu,
  Mic2,
  MoreHorizontal,
  Radio,
  SkipForward,
  X,
} from 'lucide-react';

export default function HomePage() {
  const [mobileNav, setMobileNav] = useState(false);
  const voice = useVoiceStatus();
  const player = usePlayer({
    enabled: voice.authenticated && voice.inVoice,
    sessionKey: `${voice.user?.id || ''}:${voice.guild_id || ''}`,
  });
  const { track, queue } = player;
  const syncState = player.loading ? 'connecting' : player.synced ? 'live' : 'offline';
  const statusLabel = player.loading ? 'Sincronizando...' : player.error ? 'Sem sincronização' : player.isPlaying ? 'Reproduzindo' : player.isPaused ? 'Pausado' : 'Aguardando música';


  return (
    <main className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><Radio size={18} /></div>
          <span>byte<span>bot</span></span>
          <button className="icon-button sidebar-close" onClick={() => setMobileNav(false)} aria-label="Fechar menu"><X size={18} /></button>
        </div>

        <nav className="side-nav" aria-label="Navegação principal">
          <p className="nav-label">Workspace</p>
          <a className="nav-item nav-item-active" href="#player"><Home size={18} /> Music Player</a>
          <a className="nav-item" href="#queue"><ListMusic size={18} /> Queue <span className="nav-count">{queue.length}</span></a>
          <a className="nav-item" href="#playlists"><Disc3 size={18} /> Playlists</a>
        </nav>

        <div className="sidebar-bottom">
          <div className="bot-status"><i /> <span>ByteBot is online</span></div>
          {voice.user ? <DiscordProfile user={voice.user} /> : voice.loading ? <p>Carregando perfil...</p> : <a className="discord-login" href="/api/auth/discord"><LogIn size={17} /> Entrar com Discord</a>}
          <p className="version">BYTEBOT PLAYER <span>v1.0</span></p>
        </div>
      </aside>

      {mobileNav && <button className="scrim" onClick={() => setMobileNav(false)} aria-label="Fechar navegação" />}

      <section className="content-area">
        <header className="topbar">
          <button className="icon-button menu-button" onClick={() => setMobileNav(true)} aria-label="Abrir menu"><Menu size={20} /></button>
          <TrackSearch key={voice.user?.id || 'guest'} enabled={voice.authenticated} canPlay={voice.inVoice} pending={player.pending} onPlay={player.play} />
          <div className="topbar-actions"><span className={`socket-dot socket-${syncState}`} title={statusLabel} />{voice.user ? <DiscordProfile user={voice.user} /> : <span className="profile-status">{voice.loading ? 'Carregando...' : 'Visitante'}</span>}</div>
        </header>

        <div className="page-content">
          <section className="hero-row" id="player">
            <div>
              <p className="eyebrow"><span className="eyebrow-line" /> NOW PLAYING</p>
              <h1>Your sound,<br /><em>your room.</em></h1>
              <p className="hero-copy">Control the atmosphere of your Discord server from one place.</p>
            </div>
            <div className="live-pill"><span className={`socket-dot socket-${syncState}`} /> <span>{statusLabel}</span></div>
          </section>

          <MusicHistory player={player} enabled={voice.authenticated && voice.inVoice} />

          {(player.error || player.commandError) && <p className="player-error" role="status">{player.commandError || player.error}</p>}

          <section className="dashboard-grid">
            <div className="now-card">
              <div className="now-card-top"><span className="section-kicker">Playing now · {statusLabel}</span><button className="more-button" aria-label="Mais opções"><MoreHorizontal size={20} /></button></div>
              <div className="hero-track"><TrackArtwork track={track} /><div className="track-copy"><h2>{track?.title || 'Nenhuma música tocando'}</h2><p>{track?.artist || 'Busque uma música para começar.'}</p><div className="track-meta"><span><Mic2 size={13} /> {voice.inVoice ? voice.channel_name || 'Canal de voz' : 'Sem canal de voz'}</span><span>•</span><span>{formatTime(player.duration)}</span></div></div></div>
              <div className="now-progress">
                <progress max={player.duration || 1} value={player.currentTime} aria-label="Progresso da faixa atual" />
                <div><span>{formatTime(player.currentTime)}</span><span>{formatTime(player.duration)}</span></div>
              </div>
              <div className="waveform" aria-hidden="true">{Array.from({ length: 46 }).map((_, index) => <i key={index} style={{ height: `${22 + ((index * 19) % 50)}%`, opacity: index / 46 * 100 < player.progress ? 1 : 0.32 }} />)}</div>
            </div>

            <div className="queue-card" id="queue">
              <div className="card-heading"><div><span className="section-kicker">Up next</span><h2>Queue <span>{String(queue.length).padStart(2, '0')} tracks</span></h2></div></div>
              <div className="queue-list">
                {queue.map((item, index) => (
                  <div className="queue-item" key={`${item.id || item.url || item.title}-${index}`}>
                    <span className="queue-number">{String(index + 1).padStart(2, '0')}</span>
                    <TrackArtwork track={item} small />
                    <span className="queue-track"><strong>{item.title || 'Sem título'}</strong><small>{item.artist || 'Artista desconhecido'}</small></span>
                    <span className="queue-duration">{formatTime(item.duration)}</span>
                  </div>
                ))}
                {!queue.length && <p className="player-empty">{player.queueError || (player.loading ? 'Carregando fila...' : 'Nenhuma música na fila.')}</p>}
              </div>
            </div>
          </section>

          <section aria-live="polite" className={`voice-alert ${voice.inVoice ? 'voice-alert-active' : ''}`}>
            <div className="voice-icon"><Mic2 size={18} /></div>
            <div><strong>{voice.loading ? 'Verificando canal de voz...' : voice.unavailable ? 'Não foi possível consultar o canal de voz' : !voice.authenticated ? 'Entre com o Discord' : voice.inVoice ? `${voice.user.username}, você está em ${voice.channel_name || 'um canal de voz'}` : 'Você não está em um canal de voz'}</strong><p>{voice.unavailable ? 'Tentaremos novamente em alguns instantes.' : !voice.authenticated ? 'Faça login para consultar seu perfil e canal.' : voice.inVoice ? 'ByteBot está pronto para tocar aqui.' : 'Entre em um canal de voz do Discord para começar.'}</p></div>
            <span className="voice-action">{voice.loading ? 'Verificando' : voice.unavailable ? 'Indisponível' : voice.inVoice ? 'Conectado' : 'Desconectado'} <span>↗</span></span>
          </section>

          <section className="playlist-strip" id="playlists"><div><span className="section-kicker">Your library</span><h2>Made for late nights</h2></div><button className="outline-button">View playlists <SkipForward size={14} /></button></section>
        </div>
      </section>

      <PlayerBar key={`${voice.guild_id || ''}:${track?.id || track?.url || track?.title || ''}`} player={player} channelName={voice.inVoice ? voice.channel_name : null} />
    </main>
  );
}

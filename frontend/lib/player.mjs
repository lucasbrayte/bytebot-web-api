function seconds(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

export function normalizeTrack(track) {
  if (!track || typeof track !== 'object' || Array.isArray(track)) return null;
  return {
    ...track,
    ...(track.artist == null && track.author != null ? { artist: track.author } : {}),
    ...(track.url == null && track.uri != null ? { url: track.uri } : {}),
  };
}

export function normalizePlayerState(data = {}) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Estado do player inválido.');
  const track = normalizeTrack('currentTrack' in data ? data.currentTrack : 'track' in data ? data.track : 'current_track' in data ? data.current_track : data.title ? data : null);
  const duration = track ? seconds(data.duration ?? track.duration) : 0;
  const currentTime = track ? seconds(data.currentTime ?? data.current_time ?? track.currentTime ?? track.current_time) : 0;
  const pausedFlag = data.isPaused ?? data.is_paused;
  const isPaused = Boolean(track && pausedFlag);
  const volume = data.volume == null || !Number.isFinite(Number(data.volume)) ? null : Math.min(100, seconds(data.volume));
  return {
    track,
    duration,
    current_time: duration > 0 ? Math.min(currentTime, duration) : currentTime,
    isPaused,
    isPlaying: Boolean(track && !isPaused && (data.isPlaying ?? data.is_playing ?? (pausedFlag === false))),
    volume,
    canSetVolume: data.capabilities?.volume === true && volume !== null,
    canSeek: data.capabilities?.seek === true && duration > 0,
  };
}

export function elapsedTime(state, receivedAt, now) {
  const elapsed = state.current_time + (state.isPlaying ? Math.max(0, now - receivedAt) / 1000 : 0);
  return state.duration > 0 ? Math.min(elapsed, state.duration) : elapsed;
}

export function progressPercent(currentTime, duration) {
  return duration > 0 ? Math.min(100, Math.max(0, seconds(currentTime) / duration * 100)) : 0;
}

export function formatTime(value) {
  const total = Math.floor(seconds(value));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export async function requestPlayer(path, { method = 'GET', body, signal } = {}) {
  const response = await fetch(path, {
    method,
    credentials: 'include',
    cache: 'no-store',
    signal,
    ...(body === undefined ? {} : {
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
  });
  if (!response.ok) {
    const message = response.status === 401 ? 'Sua sessão expirou. Entre novamente com o Discord.'
      : response.status === 409 ? 'Entre em um canal de voz para controlar o player.'
        : response.status === 404 ? `O endpoint ${path} não está disponível na API.`
          : `Não foi possível atualizar o player (HTTP ${response.status}).`;
    const error = new Error(message);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

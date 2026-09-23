'use client';

import { useEffect, useState } from 'react';

const emptyStatus = {
  user: null,
  inVoice: false,
  channel_name: null,
  guild_id: null,
  authenticated: false,
  unavailable: false,
};

export function useVoiceStatus() {
  const [voice, setVoice] = useState({ ...emptyStatus, loading: true });

  useEffect(() => {
    const controller = new AbortController();
    let pending = false;

    async function checkVoice() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      try {
        const response = await fetch('/api/voice/status', {
          credentials: 'include',
          cache: 'no-store',
          signal: controller.signal,
        });
        if (response.status === 401) {
          setVoice({ ...emptyStatus, loading: false });
          return;
        }
        if (!response.ok) throw new Error('Falha ao consultar o estado de voz');
        const data = await response.json();
        if (controller.signal.aborted) return;
        setVoice({
          ...emptyStatus,
          user: data.user || null,
          authenticated: Boolean(data.user),
          inVoice: data.inVoice === true,
          channel_name: data.inVoice ? data.channel_name ?? null : null,
          guild_id: data.inVoice ? data.guild_id ?? null : null,
          loading: false,
        });
      } catch {
        if (!controller.signal.aborted) {
          setVoice((previous) => ({
            ...emptyStatus,
            user: previous.user,
            authenticated: previous.authenticated,
            loading: false,
            unavailable: true,
          }));
        }
      } finally {
        pending = false;
      }
    }

    checkVoice();
    const interval = window.setInterval(checkVoice, 15000);
    window.addEventListener('focus', checkVoice);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener('focus', checkVoice);
    };
  }, []);

  return voice;
}

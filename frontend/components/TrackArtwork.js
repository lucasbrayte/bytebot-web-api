'use client';

import { useState } from 'react';
import { Disc3 } from 'lucide-react';

export default function TrackArtwork({ track, small = false }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const thumbnail = track?.thumbnail;
  const showCover = typeof thumbnail === 'string' && /^https?:\/\//.test(thumbnail) && thumbnail !== failedUrl;
  return (
    <div className={`album-art album-violet ${small ? 'album-small' : ''} ${showCover ? 'album-cover' : ''}`}>
      {showCover ? (
        <img src={thumbnail} alt={`Capa de ${track.title || 'música atual'}`} width={small ? 34 : 117} height={small ? 34 : 117} onError={() => setFailedUrl(thumbnail)} />
      ) : <Disc3 size={small ? 19 : 44} strokeWidth={1.4} aria-hidden="true" />}
    </div>
  );
}

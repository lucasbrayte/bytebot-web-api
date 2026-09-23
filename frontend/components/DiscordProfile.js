'use client';

import { useState } from 'react';

export default function DiscordProfile({ user }) {
  const [failedUrl, setFailedUrl] = useState(null);
  const avatarUrl = user.avatar
    ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith('a_') ? 'gif' : 'png'}?size=64`
    : null;

  return (
    <div className="discord-profile" title={user.username}>
      {avatarUrl && failedUrl !== avatarUrl ? (
        <img className="discord-avatar" src={avatarUrl} alt={`Avatar de ${user.username}`} width={33} height={33} onError={() => setFailedUrl(avatarUrl)} />
      ) : (
        <span className="discord-avatar discord-avatar-fallback" aria-hidden="true">
          {user.username?.slice(0, 2).toUpperCase() || '?'}
        </span>
      )}
      <span className="discord-username">{user.username}</span>
    </div>
  );
}

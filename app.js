require('dotenv').config();

const express = require('express');
const axios = require('axios');
const crypto = require('crypto');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const REQUIRED_ENV = ['DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'BOT_TOKEN'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);

if (missingEnv.length > 0) {
  console.warn(`Missing environment variables: ${missingEnv.join(', ')}. Copy .env.example to .env and fill them in.`);
}

app.set('trust proxy', 1);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store');
  next();
});

// Shared by every function instance; never generate a secret at runtime.
const COOKIE_SECRET = process.env.COOKIE_SECRET || process.env.SESSION_SECRET;
const AUTH_TTL = 24 * 60 * 60 * 1000;
const STATE_TTL = 10 * 60 * 1000;

function authConfigured(res) {
  if (typeof COOKIE_SECRET !== 'string' || Buffer.byteLength(COOKIE_SECRET) < 32) {
    res.status(503).json({ error: 'Authentication unavailable: configure COOKIE_SECRET (at least 32 bytes).' });
    return false;
  }
  return true;
}

function cookieOptions(req) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production' || Boolean(process.env.VERCEL) || req.secure,
    sameSite: 'lax',
    path: '/',
  };
}

function signature(name, value) {
  return crypto.createHmac('sha256', COOKIE_SECRET).update(`${name}.${value}`).digest('base64url');
}

function equalStrings(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function writeCookie(req, res, name, data, maxAge) {
  const value = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + maxAge })).toString('base64url');
  res.cookie(name, `${value}.${signature(name, value)}`, { ...cookieOptions(req), maxAge });
}

function readCookie(req, name) {
  if (!COOKIE_SECRET) return null;
  try {
    const values = (req.headers.cookie || '').split(';').map(part => part.trim())
      .filter(part => part.startsWith(`${name}=`));
    if (values.length !== 1) return null;
    const token = decodeURIComponent(values[0].slice(name.length + 1));
    if (token.length > 4096) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !equalStrings(parts[1], signature(name, parts[0]))) return null;
    const data = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
    return data && Number.isFinite(data.exp) && data.exp > Date.now() ? data : null;
  } catch {
    return null;
  }
}

function clearCookie(req, res, name) {
  res.clearCookie(name, cookieOptions(req));
}

// ==========================================
// UTILS E FUNÇÕES DE APOIO
// ==========================================

function buildDiscordAuthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });

  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    client_secret: process.env.DISCORD_CLIENT_SECRET,
    grant_type: 'authorization_code',
    code,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
  });

  const response = await axios.post('https://discord.com/api/v10/oauth2/token', params.toString(), {
    timeout: 15000,
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  return response.data;
}

async function getDiscordUser(accessToken) {
  const response = await axios.get('https://discord.com/api/v10/users/@me', {
    timeout: 15000,
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  return response.data;
}

async function getByteBotVoiceStatus(userId) {
  const bytebotUrl = process.env.BYTEBOT_API_URL || 'http://localhost:3001';

  try {
    const response = await axios.get(
      `${bytebotUrl.replace(/\/$/, '')}/internal/voice-state/${encodeURIComponent(userId)}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.BYTEBOT_API_KEY || process.env.BOT_TOKEN}`,
        },
        timeout: 5000,
      }
    );

    return response.data;
  } catch (error) {
    console.error('ByteBot voice status request failed:', error.message);
    return { inVoice: false, reason: 'ByteBot service unavailable' };
  }
}

async function proxyByteBotCommand(path, method, payload = {}, timeout = 5000) {
  const bytebotUrl = process.env.BYTEBOT_API_URL || 'http://localhost:3001';
  const config = {
    method,
    url: `${bytebotUrl.replace(/\/$/, '')}${path}`,
    headers: {
      Authorization: `Bearer ${process.env.BYTEBOT_API_KEY || process.env.BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    timeout,
  };

  if (method === 'GET') {
    config.params = payload;
  } else {
    config.data = payload;
  }

  const response = await axios(config);
  return response.data;
}

function requireAuthenticatedUser(req, res) {
  if (!authConfigured(res)) return null;
  const auth = readCookie(req, 'bytebot_auth');
  if (!auth?.user || typeof auth.user.id !== 'string' || !/^\d+$/.test(auth.user.id)) {
    res.status(401).json({ error: 'User not authenticated.' });
    return null;
  }
  req.auth = auth;
  return auth.user.id;
}

async function requireVoiceGuild(req, res) {
  const scope = readCookie(req, 'bytebot_voice');
  const guildId = scope?.user_id === req.auth.user.id ? scope.guild_id : null;
  if (typeof guildId !== 'string' || !/^\d+$/.test(guildId)) {
    res.status(409).json({ error: 'User voice channel is not available.' });
    return null;
  }
  const current = await getByteBotVoiceStatus(req.auth.user.id);
  if (!current?.inVoice || String(current.guild_id) !== guildId) {
    clearCookie(req, res, 'bytebot_voice');
    res.status(409).json({ error: 'Voice channel changed or is unavailable. Refresh your voice status.' });
    return null;
  }
  return guildId;
}

// ==========================================
// ROTAS DE API
// ==========================================

// Rota de Health Check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Rota com dados da API
app.get('/api/info', (req, res) => {
  res.json({
    name: 'ByteBot Web API',
    status: 'ok',
    routes: ['/api/auth/discord', '/api/auth/callback', '/api/voice/status'],
  });
});

app.get('/api/auth/discord', (req, res) => {
  if (!authConfigured(res)) return;
  const state = crypto.randomBytes(24).toString('hex');
  writeCookie(req, res, 'bytebot_oauth', { state }, STATE_TTL);

  const authUrl = buildDiscordAuthUrl(state);
  return res.redirect(authUrl);
});

app.get('/api/auth/callback', async (req, res) => {
  if (!authConfigured(res)) return;
  const { code, state } = req.query;
  const saved = readCookie(req, 'bytebot_oauth');
  clearCookie(req, res, 'bytebot_oauth');

  if (typeof code !== 'string' || !code) {
    return res.status(400).json({ error: 'Missing Discord authorization code.' });
  }

  if (!saved || !equalStrings(state, saved.state)) {
    return res.status(400).json({ error: 'Invalid OAuth state.' });
  }

  try {
    const tokenData = await exchangeCodeForToken(code);
    const user = await getDiscordUser(tokenData.access_token);

    if (typeof user.id !== 'string' || !/^\d+$/.test(user.id)) {
      throw new Error('Discord returned an invalid user ID');
    }
    writeCookie(req, res, 'bytebot_auth', { user: {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
    } }, AUTH_TTL);
    clearCookie(req, res, 'bytebot_voice');

    const redirectUrl = process.env.FRONTEND_REDIRECT_URL || '/';
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Discord OAuth callback failed:', error.response?.status || error.code || 'upstream error');
    return res.status(500).json({ error: 'Failed to authenticate with Discord.' });
  }
});

app.get('/api/voice/status', async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const status = await getByteBotVoiceStatus(userId);

    if (!status || !status.inVoice) {
      clearCookie(req, res, 'bytebot_voice');
      return res.json({
        inVoice: false,
        user: req.auth.user
      });
    }

    writeCookie(req, res, 'bytebot_voice', { user_id: userId, guild_id: String(status.guild_id) },
      Math.max(1, req.auth.exp - Date.now()));

    return res.json({
      inVoice: true,
      guild_id: status.guild_id,
      channel_id: status.channel_id,
      channel_name: status.channel_name,
      user: req.auth.user,
    });
  } catch (error) {
    console.error('Voice status flow failed:', error.message);
    return res.status(500).json({ error: 'Failed to check voice status.' });
  }
});

app.get('/api/player/state', async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  const guildId = await requireVoiceGuild(req, res);
  if (!guildId) return;

  try {
    const result = await proxyByteBotCommand(
      `/internal/player/state/${encodeURIComponent(guildId)}`,
      'GET'
    );
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: 'ByteBot player state unavailable.' });
  }
});

app.get('/api/player/search', async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  const query = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (!query) return res.json({ results: [] });

  try {
    const result = await proxyByteBotCommand(
      `/internal/player/search?query=${encodeURIComponent(query)}`,
      'GET'
    );
    return res.json(result);
  } catch (error) {
    return res.json({ results: [] });
  }
});

app.post('/api/player/play', async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  const guildId = await requireVoiceGuild(req, res);
  if (!guildId) return;
  const query = typeof req.body?.query === 'string' ? req.body.query.trim() : '';

  try {
    const payload = { user_id: userId, guild_id: guildId };
    if (query) payload.query = query;

    const result = await proxyByteBotCommand('/internal/player/play', 'POST', payload, query ? 60000 : 5000);
    return res.json(result);
  } catch (error) {
    console.error('ByteBot play request failed:', error.message);
    return res.status(502).json({ error: 'ByteBot play command failed.' });
  }
});

app.post('/api/player/pause', async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  const guildId = await requireVoiceGuild(req, res);
  if (!guildId) return;

  try {
    const result = await proxyByteBotCommand('/internal/player/pause', 'POST', {
      guild_id: guildId,
    });
    return res.json(result);
  } catch (error) {
    console.error('ByteBot pause request failed:', error.message);
    return res.status(502).json({ error: 'ByteBot pause command failed.' });
  }
});

app.post('/api/player/skip', async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  const guildId = await requireVoiceGuild(req, res);
  if (!guildId) return;

  try {
    const result = await proxyByteBotCommand('/internal/player/skip', 'POST', {
      guild_id: guildId,
    });
    return res.json(result);
  } catch (error) {
    console.error('ByteBot skip request failed:', error.message);
    return res.status(502).json({ error: 'ByteBot skip command failed.' });
  }
});

app.get('/api/player/queue', async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;
  const guildId = await requireVoiceGuild(req, res);
  if (!guildId) return;

  try {
    const result = await proxyByteBotCommand(
      `/internal/player/queue/${encodeURIComponent(guildId)}`,
      'GET'
    );
    return res.json(result);
  } catch (error) {
    console.error('ByteBot queue request failed:', error.message);
    return res.status(502).json({ error: 'ByteBot queue request failed.' });
  }
});

app.get('/api/player/history', async (req, res) => {
  if (!requireAuthenticatedUser(req, res)) return;
  const guildId = await requireVoiceGuild(req, res);
  if (!guildId) return;
  try {
    const result = await proxyByteBotCommand(`/internal/player/history/${encodeURIComponent(guildId)}`, 'GET');
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: 'ByteBot history unavailable.' });
  }
});

app.post('/api/player/volume', async (req, res) => {
  if (!requireAuthenticatedUser(req, res)) return;
  const guildId = await requireVoiceGuild(req, res);
  if (!guildId) return;
  const volume = req.body?.volume;
  if (typeof volume !== 'number' || !Number.isFinite(volume) || volume < 0 || volume > 100) {
    return res.status(400).json({ error: 'Volume must be a number between 0 and 100.' });
  }
  try {
    const result = await proxyByteBotCommand('/internal/player/volume', 'POST', { guild_id: guildId, volume });
    return res.json(result);
  } catch (error) {
    return res.status(502).json({ error: 'ByteBot volume command failed.' });
  }
});

// API misses must never return the frontend, including non-GET requests.
app.use('/api', (req, res) => res.status(404).json({ error: 'API route not found' }));
app.use(express.static(path.join(__dirname, 'frontend', 'out')));

// Keep the frontend catch-all as the last route.
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'out', 'index.html'));
});

if (require.main === module && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`ByteBot Web API running on http://localhost:${PORT}`);
  });
}

module.exports = app;

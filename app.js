require('dotenv').config();

const express = require('express');
const session = require('express-session');
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

app.use(
  session({
    secret: process.env.SESSION_SECRET || 'bytebot-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve arquivos estáticos da pasta frontend (CSS, JS, imagens)
app.use(express.static(path.join(__dirname, 'frontend', 'out')));

// Rota de Health Check
app.get('/health', (req, res) => {
  res.json({ ok: true });
});

// Rota com dados da API (movida para /api/info para libertar a rota principal '/')
app.get('/api/info', (req, res) => {
  res.json({
    name: 'ByteBot Web API',
    status: 'ok',
    routes: ['/api/auth/discord', '/api/auth/callback', '/api/voice/status'],
  });
});

// Rota Principal: Serve o ficheiro index.html do frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'out', 'index.html'));
});

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
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
  });

  return response.data;
}

async function getDiscordUser(accessToken) {
  const response = await axios.get('https://discord.com/api/v10/users/@me', {
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
  if (!req.session.user_id) {
    res.status(401).json({ error: 'User not authenticated.' });
    return null;
  }

  return req.session.user_id;
}

async function requireVoiceGuild(req, res) {
  const guildId = req.session.guild_id;
  if (!guildId) {
    res.status(409).json({ error: 'User voice channel is not available.' });
    return null;
  }

  const current = await getByteBotVoiceStatus(req.session.user_id);
  if (!current?.inVoice || String(current.guild_id) !== String(guildId)) {
    delete req.session.guild_id;
    res.status(409).json({ error: 'Voice channel changed or is unavailable. Refresh your voice status.' });
    return null;
  }

  return guildId;
}

app.get('/api/auth/discord', (req, res) => {
  const state = crypto.randomBytes(24).toString('hex');
  req.session.oauthState = state;

  const authUrl = buildDiscordAuthUrl(state);
  return res.redirect(authUrl);
});

app.get('/api/auth/callback', async (req, res) => {
  const { code, state } = req.query;

  if (!code) {
    return res.status(400).json({ error: 'Missing Discord authorization code.' });
  }

  if (!state || state !== req.session.oauthState) {
    return res.status(400).json({ error: 'Invalid OAuth state.' });
  }

  delete req.session.oauthState;

  try {
    const tokenData = await exchangeCodeForToken(code);
    const user = await getDiscordUser(tokenData.access_token);

    req.session.user_id = user.id;
    delete req.session.guild_id;
    req.session.user = {
      id: user.id,
      username: user.username,
      discriminator: user.discriminator,
      avatar: user.avatar,
      email: user.email,
    };

    // Redireciona usando a variável de ambiente dinamicamente para evitar ficar preso no localhost
    const redirectUrl = process.env.FRONTEND_REDIRECT_URL || '/';
    return res.redirect(redirectUrl);
  } catch (error) {
    console.error('Discord OAuth callback failed:', error.response?.data || error.message);
    return res.status(500).json({ error: 'Failed to authenticate with Discord.' });
  }
});

app.get('/api/voice/status', async (req, res) => {
  const userId = requireAuthenticatedUser(req, res);
  if (!userId) return;

  try {
    const status = await getByteBotVoiceStatus(userId);

    if (!status || !status.inVoice) {
      delete req.session.guild_id;
      return res.json({ 
        inVoice: false,
        user: req.session.user || null 
      });
    }

    req.session.guild_id = String(status.guild_id);

    return res.json({
      inVoice: true,
      guild_id: status.guild_id,
      channel_id: status.channel_id,
      channel_name: status.channel_name,
      user: req.session.user || null,
    });
  } catch (error) {
    console.error('Voice status flow failed:', error.message);
    return res.status(500).json({ error: 'Failed to check voice status.' });
  }
});

// Endpoint para consultar o estado atual da música (progresso, capa, estado)
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

// Endpoint Play modificado para permitir retomada (sem obrigar query)
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

app.listen(PORT, () => {
  console.log(`ByteBot Web API running on http://localhost:${PORT}`);
});
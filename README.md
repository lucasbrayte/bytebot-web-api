# ByteBot Web API

## Frontend Web Player

O frontend Next.js/Tailwind está em `frontend/`. O Express usa a porta `3000` e o Next.js usa a porta `3002`, com o Next encaminhando `/api/*` para o Express via rewrite.

```bash
cd frontend
npm install
npm run dev
```

Abra `http://localhost:3002`. As chamadas HTTP e o link de login usam `/api/*` na mesma origem do frontend, com `credentials: 'include'` nas consultas. O proxy em `frontend/next.config.mjs` encaminha essas rotas para `http://localhost:3000/api/*`. Reinicie o Next após alterar essa configuração. `NEXT_PUBLIC_API_URL` não é mais usado. O player usa polling HTTP; `NEXT_PUBLIC_BOT_SOCKET_URL` também não é mais usado.

O hook `frontend/hooks/useVoiceStatus.js` consulta o perfil e o canal a cada 15 segundos e ao voltar à janela. Uma resposta 401 limpa o perfil; erros de rede/servidor exibem indisponibilidade. O avatar usa o CDN do Discord, com iniciais como alternativa. Acesse os serviços usando `localhost` de forma consistente para preservar o cookie de sessão. O callback OAuth configurado no Express e no Discord deve coincidir (por exemplo, `http://localhost:3000/api/auth/callback`); o backend atual redireciona de volta para `http://localhost:3002`.

API em Node.js com Express para autenticação do Discord OAuth2 e verificação de presença em voz.

## Variáveis de ambiente

Copie o arquivo `.env.example` para `.env` e preencha os valores reais:

```
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/api/auth/callback
FRONTEND_REDIRECT_URL=http://localhost:3001
BOT_TOKEN=
COOKIE_SECRET=<segredo-aleatorio-de-pelo-menos-32-bytes>
BYTEBOT_API_URL=http://localhost:3001
BYTEBOT_API_KEY=
```

## Instalação

```bash
npm install
```

## Execução

```bash
npm start
```

O backend Express usa a porta `3000`. O frontend deve ser iniciado separadamente:

```bash
npm --prefix frontend run dev
```

O script do frontend fixa o Next.js na porta `3002`, evitando que ele capture as rotas `/api/*` do Express.

## Rotas

- `GET /api/auth/discord` - redireciona para autorização do Discord
- `GET /api/auth/callback` - troca o código por access token e autentica usuário
- `GET /api/voice/status` - verifica se o usuário está em voz e tenta conectar o bot
- `POST /api/player/play` - envia `{ "query": "URL ou busca" }` para o ByteBot
- `POST /api/player/pause` - pausa a reprodução no guild da sessão
- `POST /api/player/skip` - pula a faixa atual no guild da sessão
- `GET /api/player/queue` - retorna a fila atual

O callback valida o cookie temporário de OAuth, grava o perfil mínimo em um cookie
assinado e redireciona para `FRONTEND_REDIRECT_URL` (padrão `/`). Tokens de acesso
do Discord não são armazenados nos cookies. Não há sessão em memória.

## Vercel e cookies

Use a raiz deste repositório como Root Directory da Vercel. O `vercel.json`
compila `api/index.js` como uma função Node.js e encaminha todas as URLs para ela.
Esse arquivo apenas exporta o `app.js`. O build inclui `frontend/out/**`, já
versionado neste projeto. Quando alterar o frontend, execute
`npm --prefix frontend run build` e inclua o conteúdo atualizado de `frontend/out`
no deploy. A configuração usa o builder explícito para servir também os arquivos
estáticos pelo Express, sem depender da detecção automática de framework.

Configure no painel da Vercel:

- `COOKIE_SECRET`: segredo aleatório estável de pelo menos 32 bytes. Gere com
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.
  `SESSION_SECRET` também é aceito como fallback, com o mesmo tamanho mínimo.
- `DISCORD_CLIENT_ID` e `DISCORD_CLIENT_SECRET`.
- `DISCORD_REDIRECT_URI=https://SEU-DOMINIO/api/auth/callback`: cadastre exatamente
  essa URL no Discord Developer Portal. Inicie o login pelo mesmo domínio;
  cookies não são compartilhados entre URLs de preview e produção.
- `FRONTEND_REDIRECT_URL=/`: mantém frontend e API na mesma origem.
- `BYTEBOT_API_URL`: URL HTTPS acessível da bridge do bot; `localhost` na Vercel
  não alcança o servidor RedHosting. Mantenha a chave da bridge em `BYTEBOT_API_KEY`
  ou o fallback atual `BOT_TOKEN`.

Os cookies são host-only, `HttpOnly`, `SameSite=Lax` e `Secure` em produção/Vercel.
O state expira em 10 minutos e a autenticação em 24 horas. Assinatura e expiração
são verificadas em cada instância, sem armazenamento em memória. O cookie de voz
é vinculado ao usuário e a presença é revalidada no bot antes dos comandos.
Mudar o segredo invalida os cookies existentes. Em localhost com HTTP, `Secure`
não é imposto, para permitir desenvolvimento local.

As respostas `/api/*` usam `Cache-Control: no-store`; rotas de API desconhecidas
retornam JSON 404 antes dos arquivos estáticos e do catch-all do frontend.
`app.listen` só executa com `node app.js` fora da Vercel.

A Vercel hospeda a interface e o OAuth/HTTP. O processo Python de discord.py,
Gateway e FFmpeg continua no servidor persistente RedHosting.

## Observações

A rota de voz exige a sessão criada pelo OAuth. Ela consulta o servidor interno HTTP do ByteBot na variável `BYTEBOT_API_URL` (padrão: `http://localhost:3001`) usando o estado recebido do Gateway do Discord. A API REST do Discord não fornece o canal de voz atual de um usuário arbitrário. O servidor do bot deve expor:

- `GET /internal/voice-state/:user_id` - retorna `{ inVoice, guild_id, channel_id, channel_name }`
- `POST /voice/join` - opcionalmente recebe os dados do canal para conectar o bot
- `POST /internal/player/play` - recebe `{ user_id, guild_id, query? }`; sem query, retoma a faixa pausada
- `POST /internal/player/pause` - recebe `{ guild_id }`
- `POST /internal/player/skip` - recebe `{ guild_id }`
- `GET /internal/player/queue/{guild_id}` - retorna a fila, preferencialmente em `{ queue: [...] }`

Se a bridge não estiver configurada ou estiver indisponível, o endpoint retorna `{ inVoice: false }` para o frontend.

## Sincronização do player

`frontend/hooks/usePlayer.mjs` consulta `/api/player/state` e `/api/player/queue` a cada segundo, com cookie de sessão, após confirmar login e presença em voz. O relógio interpola o tempo entre respostas e para ao pausar, atingir a duração ou perder a sincronização. As consultas não se sobrepõem; comandos invalidam consultas anteriores e forçam atualização. A fila vazia não substitui a faixa atual.

O Express encaminha os comandos e consultas ao bot em `http://localhost:3001`, usando o servidor da sessão autenticada. O bot retorna seu estado real de discord.py/FFmpeg; falhas de consulta são exibidas como erros de sincronização.

Exemplo de `GET /api/player/state` (tempos em segundos):

```json
{
  "currentTrack": {
    "title": "Nome da música",
    "author": "Nome do artista",
    "thumbnail": "https://example.com/cover.jpg",
    "uri": "https://www.youtube.com/watch?v=video-id"
  },
  "currentTime": 90,
  "duration": 225,
  "isPlaying": true,
  "isPaused": false,
  "volume": 70,
  "capabilities": { "volume": true, "seek": false }
}
```

O frontend também aceita os formatos anteriores `track`, `current_track` e `current_time`. Sem faixa ativa, o bot retorna `currentTrack: null`, tempos zerados e flags falsas. A fila retorna `{ "queue": [...] }`.

- Pausar: `POST /api/player/pause`, sem corpo.
- Retomar: `POST /api/player/play`, sem corpo; não reinicia nem conta outra reprodução.
- Reproduzir uma seleção: `POST /api/player/play` com `{ "query": "busca ou URL" }`; a seleção toca antes das faixas já enfileiradas.
- Avançar: `POST /api/player/skip`, sem corpo.
- Volume: `POST /api/player/volume` com `{ "volume": 70 }`, de 0 a 100 (0 silencia). Altera o áudio do bot no Discord e mantém o volume nas próximas faixas da sessão. O navegador não reproduz áudio próprio.
- Histórico: `GET /api/player/history`, sem parâmetros de servidor. Retorna `{ "recent": [...], "mostPlayed": [...] }`, com `title`, `author`, `thumbnail`, `uri`, `duration`, `playCount` e `lastPlayedAt` (timestamp Unix em segundos).

O histórico é salvo na tabela `music_history` do SQLite do bot. Cada início de reprodução bem-sucedido conta uma vez, incluindo faixas iniciadas pelo Discord ou pela fila. Consultas e retomadas não incrementam o contador. As listas trazem até 12 faixas distintas; o frontend mostra até 6 por bloco e atualiza o histórico a cada 10 segundos e após comandos. As contagens começam após a instalação desta alteração, sem reconstrução de músicas tocadas anteriormente.

Os controles aguardam confirmação do servidor; o rodapé e o card central mostram o progresso sincronizado. Avanço manual dentro da faixa continua desabilitado porque o bot não oferece seek.

Reinicie o bot Python e o Express após atualizar os arquivos. O bot cria a tabela de histórico automaticamente na inicialização. No frontend em produção, execute `npm --prefix frontend run build` e reinicie o Next.js na porta 3002.

Validação local: `node --test tests/*.test.js frontend/tests/*.test.mjs`. Os testes cobrem contratos, polling, comandos, seleção de músicas e componentes. No projeto Python, execute `.venv/bin/python -m pytest`.

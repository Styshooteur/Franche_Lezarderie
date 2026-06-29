require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const {
  initDb,
  getPool,
  fetchRecentForClient,
  saveMessage,
  revealMessageForUser,
  formatMessageForClient,
  formatPublicMessage,
  findUserByUsername,
  createUser,
  getServerTimeIso,
} = require('./db');
const { validateInviteCode } = require('./invites');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const MESSAGE_LIMIT = 500;
const HISTORY_LIMIT = 50;
const USERNAME_MIN = 3;
const USERNAME_MAX = 30;
const SESSION_MAX_AGE_MS = Number(process.env.SESSION_MAX_AGE_MS) || 60 * 24 * 60 * 60 * 1000;

const app = express();
const server = http.createServer(app);

function validateMessage(content) {
  if (typeof content !== 'string') return false;
  const trimmed = content.trim();
  return trimmed.length > 0 && trimmed.length <= MESSAGE_LIMIT;
}

function validateUsername(username) {
  if (typeof username !== 'string') return false;
  const trimmed = username.trim();
  return (
    trimmed.length >= USERNAME_MIN &&
    trimmed.length <= USERNAME_MAX &&
    /^[\p{L} ]+$/u.test(trimmed)
  );
}

function createSessionMiddleware() {
  return session({
    store: new pgSession({
      pool: getPool(),
      tableName: 'user_sessions',
      createTableIfMissing: true,
    }),
    name: 'lezardiere.sid',
    secret: process.env.SESSION_SECRET || 'dev-secret-change-me',
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: SESSION_MAX_AGE_MS,
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    },
  });
}

function validateProductionEnv() {
  const missing = [];
  if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
  if (!process.env.SESSION_SECRET) missing.push('SESSION_SECRET');

  const hasInvites =
    process.env.INVITE_CODES ||
    fs.existsSync(path.join(__dirname, 'invites.json'));
  if (!hasInvites) missing.push('INVITE_CODES');

  if (missing.length > 0) {
    throw new Error(
      `Variables manquantes sur Render → Environment : ${missing.join(', ')}`
    );
  }
}

async function start() {
  if (process.env.NODE_ENV === 'production') {
    validateProductionEnv();
  }

  console.log('Connexion à Supabase...');
  await initDb();
  console.log('Base de données prête.');

  const sessionMiddleware = createSessionMiddleware();
  const io = new Server(server, {
    cors: {
      origin: true,
      credentials: true,
    },
  });

  app.set('trust proxy', 1);
  app.get('/health', (_req, res) => {
    res.status(200).json({ ok: true });
  });
  app.use(express.json());
  app.use(sessionMiddleware);
  app.use(express.static(path.join(__dirname, 'public')));

  io.use((socket, next) => {
    sessionMiddleware(socket.request, {}, () => {
      const sessionData = socket.request.session;
      if (!sessionData?.username) {
        return next(new Error('Non authentifié'));
      }
      next();
    });
  });

  app.get('/api/me', (req, res) => {
    if (!req.session?.username) {
      return res.status(401).json({ authenticated: false });
    }
    return res.json({
      authenticated: true,
      username: req.session.username,
    });
  });

  app.post('/api/join', async (req, res) => {
    try {
      if (req.session?.username) {
        return res.json({
          ok: true,
          username: req.session.username,
          alreadyConnected: true,
        });
      }

      const inviteCode = String(req.body?.inviteCode || '').trim();
      const username = String(req.body?.username || '').trim();

      if (!validateInviteCode(inviteCode)) {
        return res.status(403).json({ error: 'Code d\'invitation invalide ou expiré.' });
      }

      if (!validateUsername(username)) {
        return res.status(400).json({
          error: 'Identité invalide : 3 à 30 caractères, lettres et espaces uniquement.',
        });
      }

      const existing = await findUserByUsername(username);
      if (existing) {
        return res.status(409).json({
          error: 'Cette identité est déjà prise et ne peut pas être modifiée.',
        });
      }

      const user = await createUser(username);
      req.session.userId = user.id;
      req.session.username = user.username;

      req.session.save((err) => {
        if (err) {
          return res.status(500).json({ error: 'Impossible de créer la session.' });
        }
        return res.json({ ok: true, username: user.username });
      });
    } catch (error) {
      console.error(error);
      return res.status(500).json({ error: 'Erreur serveur.' });
    }
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => {
      res.clearCookie('lezardiere.sid');
      res.json({ ok: true });
    });
  });

  io.on('connection', async (socket) => {
    const username = socket.request.session.username;

    try {
      const messages = await fetchRecentForClient(HISTORY_LIMIT, username, Date.now());
      socket.emit('history', {
        messages,
        serverTime: getServerTimeIso(),
      });
    } catch (error) {
      console.error(error);
    }

    socket.on('chat:message', async ({ content }) => {
      if (!validateMessage(content)) return;

      try {
        const row = await saveMessage(username, content.trim());
        io.emit('chat:lizard:sent', formatPublicMessage(row, Date.now()));
      } catch (error) {
        console.error(error);
      }
    });

    socket.on('chat:lizard:reveal', async ({ messageId }) => {
      const id = Number(messageId);
      if (!Number.isInteger(id) || id <= 0) return;

      try {
        const revealed = await revealMessageForUser(id, username, Date.now());
        if (!revealed) return;
        socket.emit('chat:lizard:revealed', revealed);
      } catch (error) {
        console.error(error);
      }
    });
  });

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Serveur actif sur le port ${PORT}`);
  });
}

start().catch((error) => {
  console.error('Impossible de démarrer le serveur:', error);
  process.exit(1);
});

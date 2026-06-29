const dns = require('dns');
const { Pool } = require('pg');

const LIZARD_TRANSIT_MS = 10 * 60 * 1000;

let pool;

function assertSupabaseConnectionString(connectionString) {
  if (
    !connectionString.includes('supabase.co') &&
    !connectionString.includes('pooler.supabase.com')
  ) {
    return;
  }

  const userMatch = connectionString.match(/\/\/([^:@/]+)/);
  const user = userMatch?.[1] || '';

  if (connectionString.includes('pooler.supabase.com') && user === 'postgres') {
    throw new Error(
      'DATABASE_URL pooler : le nom d\'utilisateur doit être postgres.VOTRE_REF (ex. postgres.abcdefgh), ' +
        'pas seulement "postgres". Recopiez l\'URI entière depuis Supabase → Connect → Session pooler.'
    );
  }

  // Connexion directe (port 5432 sur db.*) : IPv6 → échoue sur Render
  if (
    connectionString.includes('db.') &&
    connectionString.includes('.supabase.co') &&
    !connectionString.includes('pooler')
  ) {
    throw new Error(
      'DATABASE_URL utilise la connexion directe Supabase. ' +
        'Sur Render : Supabase → Connect → Session pooler → copiez l\'URI complète.'
    );
  }
}

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL manquant — ajoutez-le dans Render → Environment');
    }

    const connectionString = process.env.DATABASE_URL;
    assertSupabaseConnectionString(connectionString);

    const useSsl =
      process.env.DATABASE_SSL === 'true' ||
      connectionString.includes('supabase.co') ||
      connectionString.includes('sslmode=require');

    pool = new Pool({
      connectionString,
      ssl: useSsl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 10000,
      idleTimeoutMillis: 30000,
      max: 10,
      // Render n'atteint pas toujours l'IPv6 Supabase
      lookup: (hostname, options, callback) => {
        dns.lookup(hostname, { family: 4 }, callback);
      },
    });

    pool.on('error', (error) => {
      console.error('Erreur pool PostgreSQL:', error.message);
    });
  }
  return pool;
}

async function initDb() {
  const db = getPool();
  const timeoutMs = 15000;

  const setup = async () => {
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        revealed_at TIMESTAMPTZ
      )
    `);

    await db.query(`
      CREATE TABLE IF NOT EXISTS message_reveals (
        message_id INTEGER NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        username TEXT NOT NULL,
        revealed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (message_id, username)
      )
    `);
  };

  await Promise.race([
    setup(),
    new Promise((_, reject) => {
      setTimeout(() => {
        reject(
          new Error(
            'Connexion Supabase impossible (timeout 15s). Vérifiez DATABASE_URL sur Render.'
          )
        );
      }, timeoutMs);
    }),
  ]);
}

function parseCreatedAt(dateString) {
  return new Date(dateString).getTime();
}

function isTransitComplete(row, now = Date.now()) {
  return now >= parseCreatedAt(row.created_at) + LIZARD_TRANSIT_MS;
}

async function hasViewerRevealed(row, viewerUsername) {
  if (!viewerUsername) return false;
  if (row.revealed_at) return true;

  const db = getPool();
  const result = await db.query(
    `SELECT 1 FROM message_reveals WHERE message_id = $1 AND username = $2`,
    [row.id, viewerUsername]
  );
  return result.rowCount > 0;
}

function formatPublicMessage(row, now = Date.now()) {
  const delivered = isTransitComplete(row, now);
  return {
    id: row.id,
    username: row.username,
    created_at: row.created_at,
    status: delivered ? 'ready' : 'transit',
  };
}

async function formatMessageForClient(row, viewerUsername, now = Date.now()) {
  if (await hasViewerRevealed(row, viewerUsername)) {
    return {
      id: row.id,
      username: row.username,
      created_at: row.created_at,
      status: 'revealed',
      content: row.content,
    };
  }

  const delivered = isTransitComplete(row, now);

  return {
    id: row.id,
    username: row.username,
    created_at: row.created_at,
    status: delivered ? 'ready' : 'transit',
  };
}

async function fetchRecentForClient(limit = 50, viewerUsername, now = Date.now()) {
  const db = getPool();
  const result = await db.query(
    `
      SELECT id, username, content, created_at, revealed_at
      FROM messages
      ORDER BY id DESC
      LIMIT $1
    `,
    [limit]
  );

  const rows = result.rows.reverse();
  const messages = [];
  for (const row of rows) {
    messages.push(await formatMessageForClient(row, viewerUsername, now));
  }
  return messages;
}

async function saveMessage(username, content) {
  const db = getPool();
  const result = await db.query(
    `
      INSERT INTO messages (username, content)
      VALUES ($1, $2)
      RETURNING id, username, content, created_at, revealed_at
    `,
    [username, content]
  );
  return result.rows[0];
}

async function revealMessageForUser(id, username, now = Date.now()) {
  const db = getPool();
  const existing = await db.query(
    `SELECT id, username, content, created_at, revealed_at FROM messages WHERE id = $1`,
    [id]
  );
  const row = existing.rows[0];
  if (!row || !username) return null;
  if (!isTransitComplete(row, now)) return null;

  if (!(await hasViewerRevealed(row, username))) {
    await db.query(
      `INSERT INTO message_reveals (message_id, username) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [id, username]
    );
  }

  return await formatMessageForClient(row, username, now);
}

async function findUserByUsername(username) {
  const db = getPool();
  const result = await db.query(
    `SELECT id, username, created_at FROM users WHERE username = $1`,
    [username]
  );
  return result.rows[0] || null;
}

async function createUser(username) {
  const db = getPool();
  const result = await db.query(
    `
      INSERT INTO users (username)
      VALUES ($1)
      RETURNING id, username, created_at
    `,
    [username]
  );
  return result.rows[0];
}

function getServerTimeIso() {
  return new Date().toISOString();
}

module.exports = {
  LIZARD_TRANSIT_MS,
  getPool,
  initDb,
  fetchRecentForClient,
  saveMessage,
  revealMessageForUser,
  formatMessageForClient,
  formatPublicMessage,
  findUserByUsername,
  createUser,
  getServerTimeIso,
};

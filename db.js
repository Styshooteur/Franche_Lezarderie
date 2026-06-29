const { Pool } = require('pg');

const LIZARD_TRANSIT_MS = 10 * 60 * 1000;

let pool;

function getPool() {
  if (!pool) {
    if (!process.env.DATABASE_URL) {
      throw new Error('DATABASE_URL manquant — voir .env.example et DEPLOY.md');
    }
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_URL.includes('supabase.co')
        ? { rejectUnauthorized: false }
        : undefined,
    });
  }
  return pool;
}

async function initDb() {
  const db = getPool();

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
}

function parseCreatedAt(dateString) {
  return new Date(dateString).getTime();
}

function isTransitComplete(row, now = Date.now()) {
  return now >= parseCreatedAt(row.created_at) + LIZARD_TRANSIT_MS;
}

async function hasViewerRevealed(row, viewerUsername) {
  if (!viewerUsername) return false;
  if (row.username === viewerUsername) return true;
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

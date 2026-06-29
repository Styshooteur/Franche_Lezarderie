const fs = require('fs');
const path = require('path');

const INVITES_PATH = path.join(__dirname, 'invites.json');

function loadInviteEntries() {
  if (process.env.INVITE_CODES) {
    return process.env.INVITE_CODES.split(',').map((raw) => ({
      code: raw.trim(),
      maxUses: null,
      expiresAt: null,
    }));
  }

  if (!fs.existsSync(INVITES_PATH)) {
    console.warn(
      'Aucun invites.json trouvé — copiez invites.example.json ou définissez INVITE_CODES.'
    );
    return [];
  }

  const parsed = JSON.parse(fs.readFileSync(INVITES_PATH, 'utf8'));
  return Array.isArray(parsed.codes) ? parsed.codes : [];
}

function normalizeCode(code) {
  return String(code || '').trim();
}

function isInviteValid(entry) {
  if (!entry?.code) return false;

  if (entry.expiresAt) {
    const expires = new Date(entry.expiresAt).getTime();
    if (Number.isFinite(expires) && Date.now() > expires) {
      return false;
    }
  }

  if (entry.maxUses != null && entry.maxUses <= 0) {
    return false;
  }

  return true;
}

function validateInviteCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return false;

  const entries = loadInviteEntries();
  return entries.some(
    (entry) => normalizeCode(entry.code) === normalized && isInviteValid(entry)
  );
}

module.exports = { validateInviteCode, normalizeCode };

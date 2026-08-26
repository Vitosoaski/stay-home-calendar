import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  name_key      TEXT NOT NULL UNIQUE,
  color         TEXT NOT NULL,
  photo         BLOB,
  photo_type    TEXT,
  photo_version INTEGER NOT NULL DEFAULT 0,
  pin_hash      TEXT NOT NULL,
  pin_salt      TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS absences (
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  slot       TEXT NOT NULL,
  subject    TEXT NOT NULL,
  reason     TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, date, slot)
);
CREATE INDEX IF NOT EXISTS idx_absences_date ON absences(date);
CREATE INDEX IF NOT EXISTS idx_absences_user_subject ON absences(user_id, subject);

CREATE TABLE IF NOT EXISTS cache (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);
`;

const now = () => new Date().toISOString();

// Chave de unicidade do nome: só a caixa é ignorada. 'João' e 'Joao' continuam
// sendo pessoas diferentes, porque podem mesmo ser.
const nameKey = (name) => name.trim().toLowerCase();

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

const PUBLIC_COLUMNS =
  'id, name, color, photo_version, (photo IS NOT NULL) AS has_photo';

const toPublic = (row) => row && {
  id: row.id,
  name: row.name,
  color: row.color,
  hasPhoto: Boolean(row.has_photo),
  photoVersion: row.photo_version
};

export function createUser(db, { name, color, pinHash, pinSalt, photo, photoType }) {
  const key = nameKey(name);
  const exists = db.prepare('SELECT 1 FROM users WHERE name_key = ?').get(key);
  if (exists) throw new Error('Esse nome já existe');

  const info = db.prepare(`
    INSERT INTO users (name, name_key, color, photo, photo_type, photo_version,
                       pin_hash, pin_salt, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name.trim(), key, color, photo ?? null, photoType ?? null,
         photo ? 1 : 0, pinHash, pinSalt, now());

  return getUser(db, Number(info.lastInsertRowid));
}

export function findUserByName(db, name) {
  return db.prepare('SELECT * FROM users WHERE name_key = ?').get(nameKey(name));
}

export function getUser(db, id) {
  return toPublic(db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).get(id));
}

export function listUsers(db) {
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users ORDER BY name_key`)
    .all().map(toPublic);
}

export function updateUser(db, id, { color, photo, photoType }) {
  if (color !== undefined) {
    db.prepare('UPDATE users SET color = ? WHERE id = ?').run(color, id);
  }
  if (photo !== undefined) {
    db.prepare(`
      UPDATE users SET photo = ?, photo_type = ?, photo_version = photo_version + 1
      WHERE id = ?
    `).run(photo, photoType ?? null, id);
  }
  return getUser(db, id);
}

export function getPhoto(db, id) {
  return db.prepare('SELECT photo, photo_type, photo_version FROM users WHERE id = ?').get(id);
}

export function createSession(db, tokenHash, userId) {
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, last_seen) VALUES (?, ?, ?, ?)')
    .run(tokenHash, userId, now(), now());
}

export function findSession(db, tokenHash) {
  return db.prepare('SELECT * FROM sessions WHERE token_hash = ?').get(tokenHash);
}

export function touchSession(db, tokenHash) {
  db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), tokenHash);
}

export function deleteSession(db, tokenHash) {
  db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash);
}

export function purgeSessions(db, maxAgeDays) {
  const cutoff = new Date(Date.now() - maxAgeDays * 86400_000).toISOString();
  db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(cutoff);
}

// Grava ou apaga todos os períodos de uma aula numa transação só: ou a aula
// inteira muda, ou nada muda.
export function setAbsence(db, { userId, date, slots, subject, value, reason = null }) {
  const insert = db.prepare(`
    INSERT INTO absences (user_id, date, slot, subject, reason, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, date, slot) DO NOTHING
  `);
  const remove = db.prepare('DELETE FROM absences WHERE user_id = ? AND date = ? AND slot = ?');

  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const slot of slots) {
      const info = value
        ? insert.run(userId, date, slot, subject, reason, now())
        : remove.run(userId, date, slot);
      changed += info.changes;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { changed: changed > 0 };
}

export function setReason(db, { userId, date, slots, reason }) {
  const update = db.prepare(
    'UPDATE absences SET reason = ? WHERE user_id = ? AND date = ? AND slot = ?');
  let changed = 0;
  db.exec('BEGIN');
  try {
    for (const slot of slots) changed += update.run(reason, userId, date, slot).changes;
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { changed: changed > 0 };
}

export function absencesBetween(db, from, to) {
  return db.prepare(`
    SELECT user_id, date, slot, subject, reason FROM absences
    WHERE date BETWEEN ? AND ?
    ORDER BY date, slot
  `).all(from, to);
}

export function absenceCounts(db, userId) {
  return db.prepare(`
    SELECT subject, COUNT(*) AS count FROM absences
    WHERE user_id = ? GROUP BY subject
  `).all(userId);
}

export function getCache(db, key) {
  return db.prepare('SELECT value, fetched_at FROM cache WHERE key = ?').get(key);
}

export function setCache(db, key, value) {
  db.prepare(`
    INSERT INTO cache (key, value, fetched_at) VALUES (?, ?, ?)
    ON CONFLICT (key) DO UPDATE SET value = excluded.value, fetched_at = excluded.fetched_at
  `).run(key, value, now());
}

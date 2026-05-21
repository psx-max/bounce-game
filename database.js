const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbPath = path.join(__dirname, '..', 'data', 'bounce.db');

let db;

async function getDb() {
  if (db) return db;
  const SQL = await initSqlJs();
  if (fs.existsSync(dbPath)) {
    const buf = fs.readFileSync(dbPath);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }
  db.run('PRAGMA foreign_keys = ON');
  return db;
}

function saveDb() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  fs.writeFileSync(dbPath, buffer);
}

async function initDb() {
  const d = await getDb();
  d.run(`
    CREATE TABLE IF NOT EXISTS players (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT DEFAULT 'player' CHECK(role IN ('player','admin')),
      created_at DATETIME DEFAULT (datetime('now','localtime'))
    )
  `);
  d.run(`
    CREATE TABLE IF NOT EXISTS ball_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      player_id INTEGER NOT NULL,
      speed REAL NOT NULL,
      track_lane TEXT NOT NULL,
      score INTEGER NOT NULL,
      level INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT (datetime('now','localtime')),
      FOREIGN KEY (player_id) REFERENCES players(id)
    )
  `);
  d.run('CREATE INDEX IF NOT EXISTS idx_records_player ON ball_records(player_id)');
  d.run('CREATE INDEX IF NOT EXISTS idx_records_created ON ball_records(created_at)');

  const result = d.exec('SELECT id FROM players WHERE role = ?', ['admin']);
  const hasAdmin = result.length > 0 && result[0].values.length > 0;
  if (!hasAdmin) {
    d.run('INSERT INTO players (username, password_hash, role) VALUES (?, ?, ?)',
      ['admin', bcrypt.hashSync('admin123', 10), 'admin']);
  }
  saveDb();
}

// --- Player / Auth ---

async function createPlayer(username, passwordHash, role) {
  const d = await getDb();
  d.run('INSERT INTO players (username, password_hash, role) VALUES (?, ?, ?)',
    [username, passwordHash, role || 'player']);
  saveDb();
  const result = d.exec('SELECT id FROM players WHERE username = ?', [username]);
  return { lastInsertRowid: result[0].values[0][0] };
}

async function getPlayerByUsername(username) {
  const d = await getDb();
  const stmt = d.prepare('SELECT * FROM players WHERE username = ?');
  stmt.bind([username]);
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    stmt.free();
    const obj = {};
    cols.forEach((c, i) => obj[c] = vals[i]);
    return obj;
  }
  stmt.free();
  return null;
}

async function getPlayerById(id) {
  const d = await getDb();
  const stmt = d.prepare('SELECT id, username, role, created_at FROM players WHERE id = ?');
  stmt.bind([id]);
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    stmt.free();
    const obj = {};
    cols.forEach((c, i) => obj[c] = vals[i]);
    return obj;
  }
  stmt.free();
  return null;
}

// --- Ball Records ---

async function insertRecord(playerId, speed, trackLane, score, level) {
  const d = await getDb();
  d.run('INSERT INTO ball_records (player_id, speed, track_lane, score, level) VALUES (?, ?, ?, ?, ?)',
    [playerId, speed, trackLane, score, level]);
  saveDb();
  const result = d.exec('SELECT MAX(id) as id FROM ball_records');
  return { lastInsertRowid: result[0].values[0][0] };
}

function resultToArray(result) {
  if (!result || result.length === 0) return [];
  const cols = result[0].columns;
  return result[0].values.map(row => {
    const obj = {};
    cols.forEach((c, i) => obj[c] = row[i]);
    return obj;
  });
}

async function getPlayerRecords(playerId, limit) {
  const d = await getDb();
  const stmt = d.prepare('SELECT * FROM ball_records WHERE player_id = ? ORDER BY created_at DESC LIMIT ?');
  stmt.bind([playerId, limit || 50]);
  const rows = [];
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const obj = {};
    cols.forEach((c, i) => obj[c] = vals[i]);
    rows.push(obj);
  }
  stmt.free();
  return rows;
}

async function getPlayerStats(playerId) {
  const d = await getDb();
  const stmt = d.prepare(
    'SELECT COUNT(*) as total_games, COALESCE(MAX(score),0) as highest_score, COALESCE(ROUND(AVG(speed),2),0) as avg_speed, COALESCE(ROUND(AVG(score),1),0) as avg_score FROM ball_records WHERE player_id = ?'
  );
  stmt.bind([playerId]);
  let row = null;
  if (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const obj = {};
    cols.forEach((c, i) => obj[c] = vals[i]);
    row = obj;
  }
  stmt.free();
  return row || { total_games: 0, highest_score: 0, avg_speed: 0, avg_score: 0 };
}

// --- Admin ---

async function getAllPlayers() {
  const d = await getDb();
  return resultToArray(d.exec(`
    SELECT id, username, role, created_at,
      (SELECT COUNT(*) FROM ball_records WHERE player_id = players.id) as total_games,
      (SELECT COALESCE(MAX(score), 0) FROM ball_records WHERE player_id = players.id) as highest_score,
      (SELECT COALESCE(ROUND(AVG(speed), 2), 0) FROM ball_records WHERE player_id = players.id) as avg_speed
    FROM players ORDER BY created_at DESC
  `));
}

async function getPlayerRecordsById(playerId, limit) {
  const d = await getDb();
  const stmt = d.prepare('SELECT * FROM ball_records WHERE player_id = ? ORDER BY created_at DESC LIMIT ?');
  stmt.bind([playerId, limit || 100]);
  const rows = [];
  while (stmt.step()) {
    const cols = stmt.getColumnNames();
    const vals = stmt.get();
    const obj = {};
    cols.forEach((c, i) => obj[c] = vals[i]);
    rows.push(obj);
  }
  stmt.free();
  return rows;
}

module.exports = {
  initDb,
  createPlayer, getPlayerByUsername, getPlayerById,
  insertRecord, getPlayerRecords, getPlayerStats,
  getAllPlayers, getPlayerRecordsById
};

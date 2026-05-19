const express = require('express');
const session = require('express-session');
const bcrypt = require('bcryptjs');
const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = path.join(__dirname, 'bounce.db');

// ─── Database ───
let db;

function saveDB() {
  try { fs.writeFileSync(DB_PATH, Buffer.from(db.export())); } catch(e) { console.error('DB save error:', e.message); }
}

function dbGet(sql, params=[]) {
  // For single-row SELECT queries
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject();
    stmt.free();
    return row;
  }
  stmt.free();
  return null;
}

function dbAll(sql, params=[]) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

function dbRun(sql, params=[]) {
  db.run(sql, params);
  const id = dbGet('SELECT last_insert_rowid() as id');
  saveDB();
  return id ? id.id : null;
}

async function initDB() {
  const SQL = await initSqlJs();
  if (fs.existsSync(DB_PATH)) {
    const buf = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buf);
  } else {
    db = new SQL.Database();
  }

  db.run('PRAGMA foreign_keys = ON');

  db.run(`CREATE TABLE IF NOT EXISTS admin (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS bounce_data (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    player_id INTEGER NOT NULL,
    level INTEGER NOT NULL,
    score INTEGER NOT NULL,
    track_index INTEGER NOT NULL,
    track_type TEXT NOT NULL,
    lane INTEGER,
    ball_color TEXT NOT NULL,
    pos_x REAL NOT NULL,
    pos_z REAL NOT NULL,
    speed_mult REAL NOT NULL,
    session_id TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (player_id) REFERENCES players(id)
  )`);

  const adminCount = dbGet('SELECT COUNT(*) as c FROM admin');
  if (adminCount.c === 0) {
    const hash = bcrypt.hashSync('admin123', 10);
    dbRun('INSERT INTO admin (username, password_hash) VALUES (?, ?)', ['admin', hash]);
    console.log('Default admin created: admin / admin123');
  }

  saveDB();
  console.log('Database ready');
}

// ─── Middleware ───
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(session({
  secret: 'bounce-game-secret-' + Math.random().toString(36),
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  next();
}

function requireAdmin(req, res, next) {
  if (!req.session.adminId) return res.status(401).json({ error: 'Admin only' });
  next();
}

// ─── Auth Routes ───
app.post('/api/register', (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ error: 'Missing fields' });
  if (password.length < 4) return res.status(400).json({ error: 'Password too short (min 4)' });

  const existing = dbGet('SELECT id FROM players WHERE username=? OR email=?', [username, email]);
  if (existing) return res.status(409).json({ error: 'Username or email already exists' });

  const hash = bcrypt.hashSync(password, 10);
  const id = dbRun('INSERT INTO players (username, email, password_hash) VALUES (?,?,?)', [username, email, hash]);
  req.session.userId = id;
  req.session.username = username;
  req.session.role = 'player';
  res.json({ ok: true, userId: id, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

  const player = dbGet('SELECT * FROM players WHERE username=?', [username]);
  if (!player || !bcrypt.compareSync(password, player.password_hash)) {
    return res.status(401).json({ error: 'Invalid username or password' });
  }

  dbRun('UPDATE players SET last_login=CURRENT_TIMESTAMP WHERE id=?', [player.id]);
  req.session.userId = player.id;
  req.session.username = player.username;
  req.session.role = 'player';
  res.json({ ok: true, userId: player.id, username: player.username });
});

app.post('/api/admin/login', (req, res) => {
  const { username, password } = req.body;
  const admin = dbGet('SELECT * FROM admin WHERE username=?', [username]);
  if (!admin || !bcrypt.compareSync(password, admin.password_hash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  req.session.adminId = admin.id;
  req.session.adminName = admin.username;
  req.session.role = 'admin';
  res.json({ ok: true, admin: admin.username });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/me', (req, res) => {
  if (req.session.userId) {
    return res.json({ loggedIn: true, role: 'player', userId: req.session.userId, username: req.session.username });
  }
  if (req.session.adminId) {
    return res.json({ loggedIn: true, role: 'admin', adminId: req.session.adminId, username: req.session.adminName });
  }
  res.json({ loggedIn: false });
});

// ─── Page Routes ───
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/game', (req, res) => {
  if (!req.session.userId) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'game.html'));
});

app.get('/admin', (req, res) => {
  if (!req.session.adminId) return res.sendFile(path.join(__dirname, 'public', 'admin-login.html'));
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// ─── Bounce Data API ───
app.post('/api/bounce', requireAuth, (req, res) => {
  const { level, score, trackIndex, trackType, lane, ballColor, posX, posZ, speedMult, sessionId } = req.body;
  if (level == null || score == null || trackIndex == null) return res.status(400).json({ error: 'Missing fields' });

  dbRun(`INSERT INTO bounce_data (player_id,level,score,track_index,track_type,lane,ball_color,pos_x,pos_z,speed_mult,session_id)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    [req.session.userId, level, score, trackIndex, trackType || 'short', lane ?? -1, ballColor || '#fff', posX || 0, posZ || 0, speedMult || 1, sessionId || '']);
  res.json({ ok: true });
});

// ─── Admin Data API ───
app.get('/api/admin/players', requireAdmin, (req, res) => {
  res.json(dbAll('SELECT id, username, email, created_at, last_login FROM players ORDER BY id DESC'));
});

app.get('/api/admin/stats', requireAdmin, (req, res) => {
  const totalPlayers = dbGet('SELECT COUNT(*) as c FROM players').c;
  const totalBounces = dbGet('SELECT COUNT(*) as c FROM bounce_data').c;
  const todayBounces = dbGet("SELECT COUNT(*) as c FROM bounce_data WHERE date(created_at)=date('now')").c;
  const topScores = dbAll(`
    SELECT p.username, b.score, b.level, b.created_at
    FROM bounce_data b JOIN players p ON b.player_id=p.id
    ORDER BY b.score DESC LIMIT 20
  `);
  const playerStats = dbAll(`
    SELECT p.id, p.username, COUNT(b.id) as bounces, MAX(b.score) as best
    FROM players p LEFT JOIN bounce_data b ON p.id=b.player_id
    GROUP BY p.id ORDER BY best DESC
  `);
  res.json({ totalPlayers, totalBounces, todayBounces, topScores, playerStats });
});

app.get('/api/admin/player/:id', requireAdmin, (req, res) => {
  const player = dbGet('SELECT id,username,email,created_at,last_login FROM players WHERE id=?', [req.params.id]);
  if (!player) return res.status(404).json({ error: 'Not found' });
  const data = dbAll('SELECT * FROM bounce_data WHERE player_id=? ORDER BY created_at DESC LIMIT 500', [req.params.id]);
  res.json({ player, data });
});

// ─── Start ───
initDB().then(() => {
  app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});

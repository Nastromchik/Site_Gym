/*
  server.js
  Запускает Express + SQLite. Сервер отдаёт статические файлы из public/
  и предоставляет API:
   - POST /api/auth/register   {email,password}
   - POST /api/auth/login      {email,password}
   - POST /api/auth/logout
   - GET  /api/me
   - POST /api/submissions     public (любой посетитель)
   - GET  /api/submissions     admin only
   - GET  /api/submissions/:id admin only
   - PUT  /api/submissions/:id admin only
   - DELETE /api/submissions/:id admin only
   - GET /api/visits           admin only (НОВЫЙ)
*/
const express = require('express');
const path = require('path');
const fs = require('fs');
const sqlite3 = require('sqlite3').verbose();
const { promisify } = require('util');
const bcrypt = require('bcrypt');
const session = require('express-session');
const SQLiteStore = require('connect-sqlite3')(session);

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_local_secret';

// ensure data directory
const DATA_DIR = path.join(__dirname, 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// open DB
const dbFile = path.join(DATA_DIR, 'db.sqlite');
const db = new sqlite3.Database(dbFile);
const dbGet = promisify(db.get.bind(db));
const dbAll = promisify(db.all.bind(db));
const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
  db.run(sql, params, function(err) {
    if (err) return reject(err);
    resolve({ lastID: this.lastID, changes: this.changes });
  });
});

// initialize tables
(async () => {
  await dbRun(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  // >>> НОВАЯ ТАБЛИЦА ДЛЯ ПОСЕЩЕНИЙ <<<
  await dbRun(`
    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ip TEXT,
      path TEXT,
      user_agent TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await dbRun(`
    CREATE TABLE IF NOT EXISTS submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      phone TEXT,
      email TEXT,
      goal TEXT,
      message TEXT,
      trainer TEXT,
      plan TEXT,
      intent TEXT,
      status TEXT DEFAULT 'new',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Optionally create an admin from env vars (ADMIN_EMAIL, ADMIN_PASSWORD)
  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPass) {
    const exists = await dbGet('SELECT id FROM users WHERE email = ?', [adminEmail]);
    if (!exists) {
      const hash = await bcrypt.hash(adminPass, 10);
      await dbRun('INSERT INTO users (email,password,role) VALUES (?,?,?)', [adminEmail, hash, 'admin']);
      console.log('Created initial admin:', adminEmail);
    }
  }
})().catch(err => {
  console.error('DB init error', err);
  process.exit(1);
});

// middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteStore({ db: 'sessions.sqlite', dir: DATA_DIR }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 24 * 60 * 60 * 1000 } // для локальной разработки
}));

// serve static frontend
app.use('/', express.static(path.join(__dirname, 'public')));

// Helpers
function requireAdmin(req, res, next) {
  if (req.session && req.session.user && req.session.user.role === 'admin') return next();
  return res.status(403).json({ error: 'Forbidden' });
}

// >>> НОВЫЙ MIDDLEWARE ДЛЯ ОТСЛЕЖИВАНИЯ ПОСЕТИТЕЛЕЙ <<<
app.use(async (req, res, next) => {
  // Мы хотим отслеживать только загрузки страниц, а не API-вызовы или статические файлы
  const isPageRequest = !req.path.startsWith('/api/') && req.method === 'GET' && (req.path.endsWith('.html') || !req.path.includes('.'));
  
  if (isPageRequest) {
    try {
      // Получаем реальный IP-адрес, даже если сервер за прокси (как на Render)
      const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];
      const path = req.path === '/' ? '/index.html' : req.path;

      await dbRun(
        'INSERT INTO visits (ip, path, user_agent) VALUES (?, ?, ?)',
        [ip, path, userAgent]
      );
    } catch (err) {
      console.error('Failed to log visit:', err);
    }
  }
  next();
});

// Auth endpoints
app.post('/api/auth/register', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(400).json({ error: 'User already exists' });
    const hash = await bcrypt.hash(password, 10);
    // Если еще нет админа, делаем первого зарегистрированного пользователя админом
    const adminExists = await dbGet('SELECT id FROM users WHERE role = "admin" LIMIT 1');
    const role = adminExists ? 'user' : 'admin';
    const result = await dbRun('INSERT INTO users (email,password,role) VALUES (?,?,?)', [email, hash, role]);
    const user = await dbGet('SELECT id,email,role,created_at FROM users WHERE id = ?', [result.lastID]);
    req.session.user = { id: user.id, email: user.email, role: user.role };
    res.json({ user });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
  try {
    const user = await dbGet('SELECT id,email,password,role FROM users WHERE email = ?', [email]);
    if (!user) return res.status(400).json({ error: 'Invalid credentials' });
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(400).json({ error: 'Invalid credentials' });
    req.session.user = { id: user.id, email: user.email, role: user.role };
    res.json({ user: { id: user.id, email: user.email, role: user.role } });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Logout error' });
    res.json({ ok: true });
  });
});

app.get('/api/me', (req, res) => {
  if (req.session && req.session.user) return res.json(req.session.user);
  return res.status(401).json({ error: 'Not authenticated' });
});

// Submissions
app.post('/api/submissions', async (req, res) => {
  // Public endpoint: любой посетитель может оставить заявку
  const { name, phone, email, goal, message, trainer, plan, intent } = req.body;
  if (!name || !phone || !goal) {
    return res.status(400).json({ error: 'Required fields: name, phone, goal' });
  }
  try {
    const result = await dbRun(
      `INSERT INTO submissions (name,phone,email,goal,message,trainer,plan,intent)
       VALUES (?,?,?,?,?,?,?,?)`,
      [name || null, phone || null, email || null, goal || null, message || null, trainer || null, plan || null, intent || null]
    );
    const row = await dbGet('SELECT * FROM submissions WHERE id = ?', [result.lastID]);
    res.json({ submission: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// Admin-only API
app.get('/api/submissions', requireAdmin, async (req, res) => {
  try {
    const rows = await dbAll('SELECT * FROM submissions ORDER BY created_at DESC');
    res.json({ submissions: rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/submissions/:id', requireAdmin, async (req, res) => {
  try {
    const row = await dbGet('SELECT * FROM submissions WHERE id = ?', [req.params.id]);
    if (!row) return res.status(404).json({ error: 'Not found' });
    res.json({ submission: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/submissions/:id', requireAdmin, async (req, res) => {
  const id = req.params.id;
  const allowed = ['name','phone','email','goal','message','trainer','plan','intent','status'];
  const sets = [];
  const vals = [];
  allowed.forEach(k => {
    if (req.body[k] !== undefined) {
      sets.push(`${k} = ?`);
      vals.push(req.body[k]);
    }
  });
  if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
  vals.push(id);
  const sql = `UPDATE submissions SET ${sets.join(',')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`;
  try {
    await dbRun(sql, vals);
    const row = await dbGet('SELECT * FROM submissions WHERE id = ?', [id]);
    res.json({ submission: row });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/submissions/:id', requireAdmin, async (req, res) => {
  try {
    await dbRun('DELETE FROM submissions WHERE id = ?', [req.params.id]);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});

// >>> НОВЫЙ API ENDPOINT ДЛЯ ПОЛУЧЕНИЯ ДАННЫХ О ПОСЕЩЕНИЯХ <<<
app.get('/api/visits', requireAdmin, async (req, res) => {
  try {
    // Получаем последние 100 посещений
    const visits = await dbAll('SELECT * FROM visits ORDER BY created_at DESC LIMIT 100');
    // Получаем общую статистику
    const stats = await dbGet(`
      SELECT
        COUNT(*) as totalVisits,
        COUNT(DISTINCT ip) as uniqueVisitors
      FROM visits
    `);
    res.json({ visits, stats });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error' });
  }
});


// start
app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
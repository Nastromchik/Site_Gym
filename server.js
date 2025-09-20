const express = require('express');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcrypt');
const session = require('express-session');
const { Pool } = require('pg'); // ИСПОЛЬЗУЕМ 'pg' ВМЕСТО 'sqlite3'

const app = express();
const PORT = process.env.PORT || 3000;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change_me_local_secret';

// НАСТРОЙКА ПОДКЛЮЧЕНИЯ К POSTGRESQL
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Обертки для удобной работы с базой
const dbQuery = (sql, params = []) => pool.query(sql, params);
const dbGet = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows[0];
};
const dbAll = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return result.rows;
};


// Инициализация таблиц
(async () => {
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS visits (
      id SERIAL PRIMARY KEY,
      ip TEXT,
      path TEXT,
      user_agent TEXT,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);
  await dbQuery(`
    CREATE TABLE IF NOT EXISTS submissions (
      id SERIAL PRIMARY KEY,
      name TEXT,
      phone TEXT,
      email TEXT,
      goal TEXT,
      message TEXT,
      trainer TEXT,
      plan TEXT,
      intent TEXT,
      status TEXT DEFAULT 'new',
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const adminEmail = process.env.ADMIN_EMAIL;
  const adminPass = process.env.ADMIN_PASSWORD;
  if (adminEmail && adminPass) {
    const exists = await dbGet('SELECT id FROM users WHERE email = $1', [adminEmail]);
    if (!exists) {
      const hash = await bcrypt.hash(adminPass, 10);
      await dbQuery('INSERT INTO users (email, password, role) VALUES ($1, $2, $3)', [adminEmail, hash, 'admin']);
      console.log('Created initial admin:', adminEmail);
    }
  }
})().catch(err => {
  console.error('DB init error', err);
  process.exit(1);
});

// Middlewares
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: 'auto', maxAge: 24 * 60 * 60 * 1000 }
}));

app.use('/', express.static(path.join(__dirname, 'public')));

function requireAdmin(req, res, next) {
    if (req.session && req.session.user && req.session.user.role === 'admin') return next();
    return res.status(403).json({ error: 'Forbidden' });
}

app.use(async (req, res, next) => {
    const isPageRequest = !req.path.startsWith('/api/') && req.method === 'GET' && (req.path.endsWith('.html') || !req.path.includes('.'));
    if (isPageRequest) {
        try {
            const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
            const userAgent = req.headers['user-agent'];
            const pagePath = req.path === '/' ? '/index.html' : req.path;
            await dbQuery('INSERT INTO visits (ip, path, user_agent) VALUES ($1, $2, $3)', [ip, pagePath, userAgent]);
        } catch (err) {
            console.error('Failed to log visit:', err);
        }
    }
    next();
});

// Auth endpoints (PostgreSQL uses $1, $2 instead of ?)
app.post('/api/auth/register', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    try {
        const existing = await dbGet('SELECT id FROM users WHERE email = $1', [email]);
        if (existing) return res.status(400).json({ error: 'User already exists' });
        const hash = await bcrypt.hash(password, 10);
        const adminExists = await dbGet('SELECT id FROM users WHERE role = \'admin\' LIMIT 1');
        const role = adminExists ? 'user' : 'admin';
        const result = await dbQuery('INSERT INTO users (email, password, role) VALUES ($1, $2, $3) RETURNING id, email, role, created_at', [email, hash, role]);
        const user = result.rows[0];
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
        const user = await dbGet('SELECT id, email, password, role FROM users WHERE email = $1', [email]);
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

// Submissions endpoint
app.post('/api/submissions', async (req, res) => {
    const { name, phone, email, goal, message, trainer, plan, intent } = req.body;
    if (!name || !phone || !goal) {
        return res.status(400).json({ error: 'Required fields: name, phone, goal' });
    }
    try {
        const result = await dbQuery(
            `INSERT INTO submissions (name, phone, email, goal, message, trainer, plan, intent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
            [name, phone, email, goal, message, trainer, plan, intent]
        );
        res.json({ submission: result.rows[0] });
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

app.get('/api/visits', requireAdmin, async (req, res) => {
    try {
        const visits = await dbAll('SELECT * FROM visits ORDER BY created_at DESC LIMIT 100');
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

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
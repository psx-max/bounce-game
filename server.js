const express = require('express');
const cors = require('cors');
const path = require('path');
const { initDb } = require('./database');

const authRoutes = require('./routes/auth');
const recordRoutes = require('./routes/records');

const app = express();
const PORT = process.env.PORT || 3000;

if (!process.env.JWT_SECRET) {
  console.warn('[!] JWT_SECRET not set, using default key — set it for production!');
  console.warn('    e.g. export JWT_SECRET="your-random-secret-string"');
}

app.use(cors());
app.use(express.json());

// Serve frontend from the same server
app.use(express.static(path.join(__dirname, '..', 'frontend')));

app.use('/api/auth', authRoutes);
app.use('/api/records', recordRoutes);

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`[+] Bounce Game server running on port ${PORT}`);
    console.log(`[+] Open http://localhost:${PORT}/login.html`);
    console.log(`[+] Admin: admin / admin123  (change password after first login!)`);
  });
}).catch(err => {
  console.error('[-] Failed to initialize database:', err);
  process.exit(1);
});

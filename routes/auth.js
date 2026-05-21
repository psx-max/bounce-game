const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database');
const { authRequired, JWT_SECRET } = require('../middleware/auth');

const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  if (password.length < 3) {
    return res.status(400).json({ error: '密码长度至少3位' });
  }
  try {
    const existing = await db.getPlayerByUsername(username);
    if (existing) {
      return res.status(409).json({ error: '用户名已存在' });
    }
    const hash = bcrypt.hashSync(password, 10);
    const result = await db.createPlayer(username, hash, 'player');
    const token = jwt.sign({ id: result.lastInsertRowid, username, role: 'player' }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: result.lastInsertRowid, username, role: 'player' } });
  } catch (e) {
    res.status(500).json({ error: '注册失败: ' + e.message });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: '用户名和密码不能为空' });
  }
  try {
    const player = await db.getPlayerByUsername(username);
    if (!player) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    if (!bcrypt.compareSync(password, player.password_hash)) {
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    const token = jwt.sign({ id: player.id, username: player.username, role: player.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, user: { id: player.id, username: player.username, role: player.role } });
  } catch (e) {
    res.status(500).json({ error: '登录失败: ' + e.message });
  }
});

router.get('/me', authRequired, async (req, res) => {
  try {
    const player = await db.getPlayerById(req.user.id);
    if (!player) return res.status(404).json({ error: '用户不存在' });
    res.json({ user: player });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

const express = require('express');
const db = require('../database');
const { authRequired, adminRequired } = require('../middleware/auth');

const router = express.Router();

router.post('/', authRequired, async (req, res) => {
  const { speed, track_lane, score, level } = req.body;
  if (score == null || speed == null || !track_lane) {
    return res.status(400).json({ error: '缺少必要数据 (speed, track_lane, score)' });
  }
  try {
    const result = await db.insertRecord(req.user.id, speed, track_lane, score, level || 1);
    res.json({ id: result.lastInsertRowid, message: '记录已保存' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/', authRequired, async (req, res) => {
  try {
    const records = await db.getPlayerRecords(req.user.id, req.query.limit || 50);
    const stats = await db.getPlayerStats(req.user.id);
    res.json({ records, stats });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/players', authRequired, adminRequired, async (req, res) => {
  try {
    const players = await db.getAllPlayers();
    res.json({ players });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get('/admin/records/:playerId', authRequired, adminRequired, async (req, res) => {
  try {
    const records = await db.getPlayerRecordsById(req.params.playerId, req.query.limit || 100);
    res.json({ records });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;

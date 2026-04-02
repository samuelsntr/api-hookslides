import { Router } from "express";
import { getAllHistory, getStats, deleteHistoryItem, getHistoryCount } from "../db/index.js";
import dotenv from "dotenv";

dotenv.config();

const router = Router();
const ADMIN_SECRET = (process.env.ADMIN_SECRET || "admin123").trim();

// Auth Middleware
const auth = (req, res, next) => {
  const secret = (req.headers["x-admin-secret"] || "").trim();
  if (secret === ADMIN_SECRET) {
    next();
  } else {
    res.status(401).json({ error: "Unauthorized" });
  }
};

router.get("/stats", auth, async (req, res) => {
  try {
    const stats = await getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch stats" });
  }
});

router.get("/history", auth, async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const history = await getAllHistory(page, limit);
    const total = await getHistoryCount();
    res.json({
      items: history,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit)
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

router.delete("/history/:id", auth, async (req, res) => {
  try {
    const { id } = req.params;
    await deleteHistoryItem(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to delete history item" });
  }
});

export default router;

import sqlite3 from "sqlite3";
import path from "path";
import { fileURLToPath } from "url";

sqlite3.verbose();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = path.join(__dirname, "database.sqlite3");

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(
    `CREATE TABLE IF NOT EXISTS history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      input TEXT NOT NULL,
      tone TEXT NOT NULL,
      result TEXT NOT NULL,
      ip TEXT,
      vibe TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`
  );

  // Migration: add columns if they don't exist
  db.all("PRAGMA table_info(history)", (err, rows) => {
    if (err) return;
    const columns = rows.map((row) => row.name);
    if (!columns.includes("ip")) {
      db.run("ALTER TABLE history ADD COLUMN ip TEXT");
    }
    if (!columns.includes("vibe")) {
      db.run("ALTER TABLE history ADD COLUMN vibe TEXT");
    }
  });
});

export function insertHistory(input, tone, result, ip = null, vibe = null) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare(
      "INSERT INTO history (input, tone, result, ip, vibe) VALUES (?, ?, ?, ?, ?)"
    );
    stmt.run(input, tone, result, ip, vibe, function (err) {
      if (err) {
        reject(err);
      } else {
        resolve(this.lastID);
      }
    });
    stmt.finalize();
  });
}

export function getAllHistory(page = 1, limit = 10) {
  const offset = (page - 1) * limit;
  return new Promise((resolve, reject) => {
    db.all(
      "SELECT id, input, tone, result, ip, vibe, created_at FROM history ORDER BY created_at DESC LIMIT ? OFFSET ?",
      [limit, offset],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

export function getHistoryCount() {
  return new Promise((resolve, reject) => {
    db.get("SELECT COUNT(*) as count FROM history", [], (err, row) => {
      if (err) reject(err);
      else resolve(row.count);
    });
  });
}

export function getStats() {
  return new Promise((resolve, reject) => {
    const queries = {
      total: "SELECT COUNT(*) as count FROM history",
      uniqueUsers: "SELECT COUNT(DISTINCT ip) as count FROM history",
      today: "SELECT COUNT(*) as count FROM history WHERE created_at >= date('now')",
      topStrategies: "SELECT tone as name, COUNT(*) as value FROM history GROUP BY tone ORDER BY value DESC LIMIT 5",
      topVibes: "SELECT vibe as name, COUNT(*) as value FROM history WHERE vibe IS NOT NULL GROUP BY vibe ORDER BY value DESC LIMIT 5",
      last7Days: "SELECT date(created_at) as date, COUNT(*) as count FROM history WHERE created_at >= date('now', '-7 days') GROUP BY date(created_at) ORDER BY date ASC"
    };

    const results = {};
    let count = 0;
    const keys = Object.keys(queries);

    keys.forEach((key) => {
      db.all(queries[key], [], (err, rows) => {
        if (err) return reject(err);
        if (key === 'total' || key === 'uniqueUsers' || key === 'today') {
          results[key] = rows[0].count;
        } else {
          results[key] = rows;
        }
        count++;
        if (count === keys.length) resolve(results);
      });
    });
  });
}

export function deleteHistoryItem(id) {
  return new Promise((resolve, reject) => {
    const stmt = db.prepare("DELETE FROM history WHERE id = ?");
    stmt.run(id, function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
    stmt.finalize();
  });
}

export default db;


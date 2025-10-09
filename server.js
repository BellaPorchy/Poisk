import express from "express";
import cors from "cors";
import fs from "fs";
import pkg from "pg";
import multer from "multer";
import path from "path";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

const __dirname = path.resolve();
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, "public"))); // ✅ раздаём index.html

const upload = multer({ storage: multer.memoryStorage() });

// === КЛЮЧИ ===
let keys = [];
if (process.env.USER_KEYS) {
  try {
    const parsed = JSON.parse(process.env.USER_KEYS);
    if (parsed && Array.isArray(parsed.keys)) {
      keys = parsed.keys;
      console.log(`✅ Загружено ${keys.length} API-ключей из окружения`);
    }
  } catch (err) {
    console.error("❌ Ошибка при чтении USER_KEYS:", err);
  }
} else {
  console.warn("⚠️ Переменная USER_KEYS не установлена");
}

const MASTER_KEY = process.env.MASTER_KEY || "default-master";

// === БАЗА ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS ids (
    id TEXT PRIMARY KEY,
    added_by TEXT,
    note TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  );
`);
console.log("✅ Таблица проверена");

// === УТИЛИТЫ ===
const findUserByKey = (key) => {
  const found = keys.find((x) => x.key === key);
  return found ? found.user : key;
};

// === API ===

// Полный список для панели (с пагинацией)
app.get("/api/list-full", async (req, res) => {
  const page = Number(req.query.page || 1);
  const limit = Number(req.query.limit || 100);
  const offset = (page - 1) * limit;
  const total = (await pool.query("SELECT COUNT(*) FROM ids")).rows[0].count;
  const q = await pool.query(
    "SELECT * FROM ids ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  res.json({ items: q.rows, total: Number(total), page, limit });
});

// Для расширения — теперь без лимита
app.get("/api/all", async (req, res) => {
  const q = await pool.query("SELECT id, added_by, created_at FROM ids ORDER BY created_at DESC");
  res.json({ items: q.rows });
});

// Добавление ID
app.post("/api/add-id", async (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "missing fields" });
  const user = findUserByKey(apiKey);
  try {
    const q = await pool.query(
      "INSERT INTO ids (id, added_by) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING RETURNING *",
      [id, user]
    );
    if (q.rows.length > 0) {
      res.json({ success: true, entry: q.rows[0] });
    } else {
      res.json({ success: false, error: "Already exists" });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
});

// Обновление заметки
app.post("/api/note", async (req, res) => {
  const { id, note, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "invalid master key" });
  await pool.query("UPDATE ids SET note=$2 WHERE id=$1", [id, note]);
  res.json({ success: true });
});

// Удаление нескольких
app.post("/api/delete-multiple", async (req, res) => {
  const { ids, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "invalid master key" });
  if (!Array.isArray(ids) || ids.length === 0) return res.json({ success: true });
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  await pool.query(`DELETE FROM ids WHERE id IN (${placeholders})`, ids);
  res.json({ success: true });
});

// Экспорт
app.get("/api/export", async (req, res) => {
  const q = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  const data = JSON.stringify(q.rows, null, 2);
  res.setHeader("Content-Disposition", "attachment; filename=ids_export.json");
  res.setHeader("Content-Type", "application/json");
  res.send(data);
});

// Импорт
app.post("/api/import", upload.single("file"), async (req, res) => {
  const masterKey = req.body.masterKey;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "invalid master key" });

  const content = JSON.parse(req.file.buffer.toString());
  let count = 0;
  for (const item of content) {
    if (item.id) {
      await pool.query(
        "INSERT INTO ids (id, added_by, note, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
        [item.id, item.added_by || "imported", item.note || "", item.created_at || new Date()]
      );
      count++;
    }
  }
  res.json({ success: true, imported: count });
});

// Очистка базы
app.post("/api/clear", async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "invalid master key" });
  await pool.query("DELETE FROM ids");
  res.json({ success: true });
});

// === Отдаём index.html для всех прочих путей ===
app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

// === ГЛОБАЛЬНЫЙ ПОИСК ===
app.get("/api/search", async (req, res) => {
  const { query } = req.query;
  if (!query || query.trim() === "") {
    return res.json({ items: [] });
  }

  const q = await pool.query(
    "SELECT * FROM ids WHERE id ILIKE $1 OR added_by ILIKE $1 ORDER BY created_at DESC LIMIT 500",
    [`%${query}%`]
  );

  res.json({ items: q.rows });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));

import express from "express";
import cors from "cors";
import fs from "fs";
import pkg from "pg";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());
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

// === МАСТЕР КЛЮЧ ===
const MASTER_KEY = process.env.MASTER_KEY || "default-master";

// === БАЗА ДАННЫХ ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// === ИНИЦИАЛИЗАЦИЯ ТАБЛИЦЫ ===
await pool.query(`
  CREATE TABLE IF NOT EXISTS ids (
    id TEXT PRIMARY KEY,
    added_by TEXT,
    note TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  );
`);
console.log("✅ Таблица проверена");

// === ВСПОМОГАТЕЛЬНЫЕ ===
const findUserByKey = (key) => {
  const found = keys.find((x) => x.key === key);
  return found ? found.user : key;
};

// === API ===

// 🔹 Новый эндпоинт для расширения — отдаёт все ID (без лимита)
app.get("/api/all", async (req, res) => {
  try {
    const q = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
    res.json({ items: q.rows });
  } catch (err) {
    console.error("Ошибка получения всех ID:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Список с пагинацией для панели
app.get("/api/list-full", async (req, res) => {
  const page = parseInt(req.query.page || "1");
  const limit = 100;
  const offset = (page - 1) * limit;
  const q = await pool.query("SELECT * FROM ids ORDER BY created_at DESC LIMIT $1 OFFSET $2", [limit, offset]);
  const total = await pool.query("SELECT COUNT(*) FROM ids");
  res.json({ items: q.rows, total: parseInt(total.rows[0].count), page, limit });
});

// Добавить ID (для расширения)
app.post("/api/add-id", async (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "Неверные данные" });
  const user = findUserByKey(apiKey);
  const q = await pool.query(
    "INSERT INTO ids (id, added_by) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET added_by=$2, created_at=NOW() RETURNING *",
    [id, user]
  );
  res.json({ success: true, entry: q.rows[0] });
});

// Обновить заметку
app.post("/api/note", async (req, res) => {
  const { id, note, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("UPDATE ids SET note=$1 WHERE id=$2", [note, id]);
  res.json({ success: true });
});

// Удалить несколько
app.post("/api/delete-multiple", async (req, res) => {
  const { ids, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("DELETE FROM ids WHERE id = ANY($1::text[])", [ids]);
  res.json({ success: true });
});

// Экспорт
app.get("/api/export", async (req, res) => {
  const q = await pool.query("SELECT * FROM ids");
  res.setHeader("Content-Disposition", "attachment; filename=ids_export.json");
  res.json(q.rows);
});

// Импорт
app.post("/api/import", upload.single("file"), async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });

  const data = JSON.parse(req.file.buffer.toString());
  const items = Array.isArray(data.items) ? data.items : data;

  for (const row of items) {
    await pool.query(
      "INSERT INTO ids (id, added_by, note, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
      [row.id, row.added_by, row.note || "", row.created_at || new Date()]
    );
  }
  res.json({ success: true });
});

// Очистка базы
app.post("/api/clear", async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("DELETE FROM ids");
  res.json({ success: true });
});

// === ЗАПУСК ===
app.listen(process.env.PORT || 10000, () => console.log("🚀 Сервер запущен"));

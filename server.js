import express from "express";
import cors from "cors";
import pkg from "pg";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pkg;
const app = express();
const upload = multer({ storage: multer.memoryStorage() });

app.use(cors());
app.use(express.json());
app.use(express.static("public")); // отдаём index.html

// === API КЛЮЧИ ===
let keys = [];
if (process.env.USER_KEYS) {
  try {
    const parsed = JSON.parse(process.env.USER_KEYS);
    if (parsed && Array.isArray(parsed.keys)) {
      keys = parsed.keys;
      console.log(`✅ Загружено ${keys.length} API-ключей`);
    }
  } catch (err) {
    console.error("❌ Ошибка чтения USER_KEYS:", err);
  }
} else {
  console.warn("⚠️ USER_KEYS не установлены");
}

// === МАСТЕР КЛЮЧ ===
const MASTER_KEY = process.env.MASTER_KEY || "default-master";

// === БАЗА ДАННЫХ ===
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

// === ВСПОМОГАТЕЛЬНЫЕ ===
const findUserByKey = (key) => {
  const found = keys.find((x) => x.key === key);
  return found ? found.user : key;
};

// === API ===

// Получение списка
app.get("/api/list-full", async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 100;
  const offset = (page - 1) * limit;

  const list = await pool.query(
    "SELECT * FROM ids ORDER BY created_at DESC LIMIT $1 OFFSET $2",
    [limit, offset]
  );
  const total = await pool.query("SELECT COUNT(*) FROM ids");
  res.json({ items: list.rows, total: parseInt(total.rows[0].count) });
});

// Добавление/обновление ID
app.post("/api/add-id", async (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "Некорректные данные" });

  const user = findUserByKey(apiKey);
  await pool.query(
    `INSERT INTO ids (id, added_by)
     VALUES ($1, $2)
     ON CONFLICT (id)
     DO UPDATE SET added_by = $2, created_at = NOW()`,
    [id, user]
  );

  res.json({ success: true });
});

// Обновление заметки
app.post("/api/note", async (req, res) => {
  const { id, note, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("UPDATE ids SET note=$1 WHERE id=$2", [note, id]);
  res.json({ success: true });
});

// Удаление нескольких
app.post("/api/delete-multiple", async (req, res) => {
  const { ids, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("DELETE FROM ids WHERE id = ANY($1::text[])", [ids]);
  res.json({ success: true });
});

// Очистка всей базы
app.post("/api/clear-all", async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("DELETE FROM ids");
  res.json({ success: true });
});

// Экспорт
app.get("/api/export", async (req, res) => {
  const q = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  res.setHeader("Content-Disposition", "attachment; filename=ids_export.json");
  res.json({ items: q.rows });
});

// Импорт
app.post("/api/import", upload.single("file"), async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });

  try {
    const fileData = JSON.parse(req.file.buffer.toString());
    const rows = fileData.items || fileData;
    for (const row of rows) {
      await pool.query(
        `INSERT INTO ids (id, added_by, note, created_at)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id)
         DO NOTHING`,
        [row.id, row.added_by, row.note || "", row.created_at || new Date()]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка импорта:", err);
    res.status(400).json({ error: "Ошибка импорта" });
  }
});

app.listen(process.env.PORT || 10000, () =>
  console.log("🚀 Сервер запущен на порту " + (process.env.PORT || 10000))
);

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
app.use(express.static("public"));

const MASTER_KEY = process.env.MASTER_KEY || "default-master";
const PAGE_SIZE = 100;

// === Подключение к БД ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// === Проверка таблицы ===
await pool.query(`
  CREATE TABLE IF NOT EXISTS ids (
    id TEXT PRIMARY KEY,
    added_by TEXT,
    note TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  );
`);
console.log("✅ Таблица проверена");

// === Вспомогательная функция ===
const findUserByKey = (key) => {
  try {
    const keys = JSON.parse(process.env.USER_KEYS || "{}").keys || [];
    const found = keys.find(x => x.key === key);
    return found ? found.user : key;
  } catch {
    return key;
  }
};

// === Маршрут главной страницы ===
app.get("/", (req, res) => {
  res.sendFile("index.html", { root: "public" });
});

// === Пагинация ===
app.get("/api/list", async (req, res) => {
  const page = parseInt(req.query.page || "1");
  const offset = (page - 1) * PAGE_SIZE;
  const countRes = await pool.query("SELECT COUNT(*) FROM ids");
  const total = parseInt(countRes.rows[0].count);
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const q = await pool.query("SELECT * FROM ids ORDER BY created_at DESC LIMIT $1 OFFSET $2", [PAGE_SIZE, offset]);
  res.json({ items: q.rows, totalPages });
});

// === API: Получение всех ID для расширения ===
app.get("/api/all", async (req, res) => {
  try {
    const result = await pool.query("SELECT id, added_by, note, created_at FROM ids ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка при получении всех ID:", err);
    res.status(500).json({ error: "Ошибка при получении данных" });
  }
});


// === Глобальный поиск ===
app.get("/api/search", async (req, res) => {
  const query = req.query.query?.toLowerCase() || "";
  if (!query) return res.json({ items: [] });
  const q = await pool.query(
    `SELECT * FROM ids 
     WHERE LOWER(id) LIKE $1 OR LOWER(added_by) LIKE $1 OR LOWER(note) LIKE $1
     ORDER BY created_at DESC LIMIT 500`,
    [`%${query}%`]
  );
  res.json({ items: q.rows });
});

// === Добавить ID ===
app.post("/api/add-id", async (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "Неверные данные" });

  const user = findUserByKey(apiKey);
  await pool.query(
    `INSERT INTO ids (id, added_by, created_at)
     VALUES ($1, $2, NOW())
     ON CONFLICT (id) DO UPDATE SET added_by = $2, created_at = NOW()`,
    [id, user]
  );
  res.json({ success: true });
});

// === Обновить заметку ===
app.post("/api/note", async (req, res) => {
  const { id, note, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("UPDATE ids SET note=$1 WHERE id=$2", [note, id]);
  res.json({ success: true });
});

// === Удалить несколько ===
app.post("/api/delete-multiple", async (req, res) => {
  const { ids, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("DELETE FROM ids WHERE id = ANY($1::text[])", [ids]);
  res.json({ success: true });
});

// === Очистить всё ===
app.post("/api/clear-all", async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("DELETE FROM ids");
  res.json({ success: true });
});

// === Экспорт ===
app.get("/api/export", async (req, res) => {
  const q = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  res.setHeader("Content-Disposition", "attachment; filename=ids_export.json");
  res.json(q.rows);
});

// === Импорт ===
app.post("/api/import", upload.single("file"), async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });

  try {
    const fileData = JSON.parse(req.file.buffer.toString());
    const items = fileData.items || fileData;
    for (const row of items) {
      await pool.query(
        `INSERT INTO ids (id, added_by, note, created_at)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO NOTHING`,
        [row.id, row.added_by || "Импорт", row.note || "", row.created_at || new Date()]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка импорта:", err);
    res.status(400).json({ error: "Ошибка формата файла" });
  }
});

// === Запуск ===
app.listen(process.env.PORT || 10000, () => {
  console.log("🚀 Сервер запущен на порту", process.env.PORT || 10000);
});

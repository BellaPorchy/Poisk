import express from "express";
import cors from "cors";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

// Подключение к БД
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://user:pass@host:5432/dbname",
  ssl: { rejectUnauthorized: false },
});

// Инициализация таблицы, если её нет
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ids (
      id TEXT PRIMARY KEY,
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);
  console.log("✅ Таблица проверена / создана");
}
initDB();

// Получить все ID
app.get("/api/highlight-list", async (req, res) => {
  try {
    const result = await pool.query("SELECT id FROM ids");
    const ids = result.rows.map(r => r.id);
    res.json({ ids });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка получения данных" });
  }
});

// Добавить новый ID
app.post("/api/add-id", async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id || !apiKey) {
      return res.status(400).json({ error: "ID или API-ключ отсутствует" });
    }

    await pool.query(
      `INSERT INTO ids (id, added_by) 
       VALUES ($1, $2) 
       ON CONFLICT (id) DO NOTHING`,
      [id, apiKey]
    );

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка добавления ID" });
  }
});

// Получить информацию по конкретному ID
app.get("/api/info/:id", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM ids WHERE id = $1",
      [req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Не найдено" });
    }
    res.json(result.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка запроса" });
  }
});

app.get("/", (req, res) => {
  res.send("✅ ID API работает");
});

app.listen(process.env.PORT || 10000, () => {
  console.log("🚀 Сервер запущен на порту 10000");
});

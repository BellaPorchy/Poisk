// server.js (ESM)
import express from "express";
import cors from "cors";
import pkg from "pg";
import multer from "multer";
import dotenv from "dotenv";
import path from "path";

dotenv.config();
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

const upload = multer({ storage: multer.memoryStorage() });

const DATABASE_URL = process.env.DATABASE_URL;
const MASTER_KEY = process.env.MASTER_KEY || "default-master";

// подключаемся к БД
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : false,
});

// Таблицы
const TABLE = "ids_dup";
const SETTINGS_TABLE = "settings";

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      id_pk SERIAL PRIMARY KEY,
      id TEXT,
      added_by TEXT,
      note TEXT DEFAULT '',
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${SETTINGS_TABLE} (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  // миграция из старой таблицы ids (если есть) в ids_dup (только если ids_dup пуста)
  try {
    const r = await pool.query(`SELECT to_regclass('public.ids') as exists_old`);
    if (r.rows[0] && r.rows[0].exists_old) {
      const cnt = await pool.query(`SELECT COUNT(*) FROM ${TABLE}`);
      if (parseInt(cnt.rows[0].count, 10) === 0) {
        await pool.query(`
          INSERT INTO ${TABLE} (id, added_by, note, created_at)
          SELECT id, added_by, COALESCE(note,''), created_at FROM ids
        `);
        console.log("✅ Миграция из таблицы ids выполнена.");
      }
    }
  } catch (err) {
    console.warn("⚠️ Ошибка миграции (игнорируем если нет старой таблицы):", err.message);
  }

  // дефолтные настройки (если ещё нет)
  const defaults = {
    minDuplicates: "2",
    minDate: "2025-09-22",
    useMinDuplicates: "true",
    useMinDate: "true"
  };
  for (const [k, v] of Object.entries(defaults)) {
    await pool.query(
      `INSERT INTO ${SETTINGS_TABLE} (key, value) VALUES ($1,$2) ON CONFLICT (key) DO NOTHING`,
      [k, v]
    );
  }

  console.log("✅ Таблицы проверены / созданы.");
}

await initDB();

// helpers
async function getSettingsFromDB() {
  const q = await pool.query(`SELECT key, value FROM ${SETTINGS_TABLE}`);
  const obj = {};
  q.rows.forEach(r => obj[r.key] = r.value);
  return {
    minDuplicates: Number(obj.minDuplicates || 2),
    minDate: obj.minDate || "2025-09-22",
    useMinDuplicates: (obj.useMinDuplicates === undefined) ? true : (String(obj.useMinDuplicates) === "true"),
    useMinDate: (obj.useMinDate === undefined) ? true : (String(obj.useMinDate) === "true")
  };
}

async function setSettingsToDB(newSettings) {
  const keys = Object.keys(newSettings);
  for (const k of keys) {
    await pool.query(
      `INSERT INTO ${SETTINGS_TABLE} (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = $2`,
      [k, String(newSettings[k])]
    );
  }
}

function findUserByKey(key) {
  try {
    const parsed = JSON.parse(process.env.USER_KEYS || "{}");
    const arr = parsed.keys || [];
    const found = arr.find(x => x.key === key);
    return found ? found.user : key;
  } catch {
    return key;
  }
}

// ========== API ==========

// Возвращаем все записи (без пагинации) — для расширения (если нужно)
app.get("/api/all", async (req, res) => {
  try {
    const q = await pool.query(`SELECT id, added_by, note, created_at FROM ${TABLE} ORDER BY created_at DESC`);
    res.json(q.rows);
  } catch (err) {
    console.error("Ошибка /api/all:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Получить записи по конкретному ID
app.get("/api/get-id/:id", async (req, res) => {
  try {
    const id = req.params.id;
    if (!id) return res.status(400).json({ error: "ID не указан" });
    const q = await pool.query(
      `SELECT id, added_by, note, created_at FROM ${TABLE} WHERE id = $1 ORDER BY created_at DESC`,
      [String(id)]
    );
    res.json(q.rows);
  } catch (err) {
    console.error("Ошибка /api/get-id/:id:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Пагинация для UI
app.get("/api/list", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page || "1", 10));
  const limit = Math.max(1, parseInt(req.query.limit || "100", 10));
  const offset = (page - 1) * limit;
  try {
    const countRes = await pool.query(`SELECT COUNT(*) FROM ${TABLE}`);
    const total = parseInt(countRes.rows[0].count, 10);
    const totalPages = Math.max(1, Math.ceil(total / limit));
    const q = await pool.query(
      `SELECT * FROM ${TABLE} ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    res.json({ items: q.rows, totalPages, page, limit });
  } catch (err) {
    console.error("Ошибка /api/list:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Добавление записи — всегда вставляем новую запись (дубликаты разрешены)
app.post("/api/add-id", async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id || !apiKey) return res.status(400).json({ error: "id или apiKey отсутствует" });
    const user = findUserByKey(apiKey);
    const q = await pool.query(
      `INSERT INTO ${TABLE} (id, added_by, created_at) VALUES ($1, $2, NOW()) RETURNING id, added_by, created_at`,
      [String(id), String(user)]
    );
    res.json({ success: true, entry: q.rows[0] });
  } catch (err) {
    console.error("Ошибка /api/add-id:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Настройки
app.get("/api/settings", async (req, res) => {
  try {
    const s = await getSettingsFromDB();
    res.json(s);
  } catch (err) {
    console.error("Ошибка /api/settings GET:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

app.post("/api/settings", async (req, res) => {
  try {
    const { minDuplicates, minDate, useMinDuplicates, useMinDate, masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа (masterKey)" });

    const update = {};
    if (minDuplicates !== undefined) update.minDuplicates = Number(minDuplicates);
    if (minDate !== undefined) update.minDate = String(minDate);
    if (useMinDuplicates !== undefined) update.useMinDuplicates = String(useMinDuplicates);
    if (useMinDate !== undefined) update.useMinDate = String(useMinDate);

    await setSettingsToDB(update);
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка /api/settings POST:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Global search
app.get("/api/search", async (req, res) => {
  const qstr = req.query.query || "";
  if (!qstr) return res.json({ items: [] });
  try {
    const q = await pool.query(
      `SELECT * FROM ${TABLE} WHERE LOWER(id) LIKE $1 OR LOWER(added_by) LIKE $1 OR LOWER(note) LIKE $1 ORDER BY created_at DESC LIMIT 500`,
      [`%${String(qstr).toLowerCase()}%`]
    );
    res.json({ items: q.rows });
  } catch (err) {
    console.error("Ошибка /api/search:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Обновление заметки
app.post("/api/note", async (req, res) => {
  try {
    const { id_pk, note, masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
    if (!id_pk) return res.status(400).json({ error: "id_pk отсутствует" });
    await pool.query(`UPDATE ${TABLE} SET note=$1 WHERE id_pk=$2`, [String(note || ""), Number(id_pk)]);
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка /api/note:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Удаление нескольких
app.post("/api/delete-multiple", async (req, res) => {
  try {
    const { ids, masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
    if (!Array.isArray(ids) || ids.length === 0) return res.json({ success: true });
    const allNumbers = ids.every(i => String(i).match(/^\d+$/));
    if (allNumbers) {
      await pool.query(`DELETE FROM ${TABLE} WHERE id_pk = ANY($1::int[])`, [ids.map(Number)]);
    } else {
      await pool.query(`DELETE FROM ${TABLE} WHERE id = ANY($1::text[])`, [ids.map(String)]);
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка /api/delete-multiple:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Экспорт
app.get("/api/export", async (req, res) => {
  try {
    const q = await pool.query(`SELECT * FROM ${TABLE} ORDER BY created_at DESC`);
    res.setHeader("Content-Disposition", "attachment; filename=ids_export.json");
    res.json({ items: q.rows });
  } catch (err) {
    console.error("Ошибка /api/export:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// Импорт
app.post("/api/import", upload.single("file"), async (req, res) => {
  try {
    const masterKey = req.body.masterKey;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
    const raw = req.file.buffer.toString();
    const parsed = JSON.parse(raw);
    const items = Array.isArray(parsed.items) ? parsed.items : (Array.isArray(parsed) ? parsed : []);
    let inserted = 0;
    for (const row of items) {
      if (!row.id) continue;
      await pool.query(
        `INSERT INTO ${TABLE} (id, added_by, note, created_at) VALUES ($1,$2,$3,$4)`,
        [String(row.id), String(row.added_by || "import"), String(row.note || ""), row.created_at ? new Date(row.created_at) : new Date()]
      );
      inserted++;
    }
    res.json({ success: true, inserted });
  } catch (err) {
    console.error("Ошибка /api/import:", err);
    res.status(400).json({ error: "Ошибка импорта" });
  }
});

// Очистка всей таблицы (DELETE FROM ids_dup)
app.post("/api/clear", async (req, res) => {
  try {
    const { masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
    await pool.query(`DELETE FROM ${TABLE}`);
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка /api/clear:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ping
app.get("/api/ping", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// SPA fallback
app.get("*", (req, res) => {
  res.sendFile(path.join(process.cwd(), "public", "index.html"));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));

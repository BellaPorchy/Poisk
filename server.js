import express from "express";
import cors from "cors";
import fs from "fs";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

// --- Подключение к БД ---
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://user:pass@host:5432/dbname",
  ssl: { rejectUnauthorized: false },
});

// --- Проверяем/создаём таблицу ---
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

// --- Миграция из старого файла ---
async function migrateFromJSON() {
  const filePath = "./ids.json";
  if (!fs.existsSync(filePath)) {
    console.log("ℹ️ Файл ids.json не найден — пропускаем миграцию");
    return;
  }

  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(raw);
    if (!Array.isArray(data.ids)) {
      console.log("⚠️ Неверный формат ids.json — ожидается { ids: [] }");
      return;
    }

    let added = 0;
    for (const id of data.ids) {
      await pool.query(
        `INSERT INTO ids (id, added_by)
         VALUES ($1, $2)
         ON CONFLICT (id) DO NOTHING`,
        [id, "migration"]
      );
      added++;
    }
    console.log(`✅ Миграция завершена. Добавлено ${added} записей из ids.json`);
  } catch (err) {
    console.error("❌ Ошибка при миграции:", err);
  }
}

// --- Запускаем инициализацию ---
await initDB();
await migrateFromJSON();

// --- API ---
app.get("/", (req, res) => res.send("✅ ID API работает через PostgreSQL"));

app.get("/api/highlight-list", async (req, res) => {
  try {
    const result = await pool.query("SELECT id FROM ids");
    res.json({ ids: result.rows.map(r => r.id) });
  } catch (e) {
    res.status(500).json({ error: "Ошибка получения данных" });
  }
});

app.post("/api/add-id", async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id || !apiKey)
      return res.status(400).json({ error: "ID или ключ отсутствует" });

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

app.get("/api/info/:id", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM ids WHERE id = $1", [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ error: "Не найдено" });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: "Ошибка запроса" });
  }
});

// Простая страница со списком ID
app.get("/list", async (req, res) => {
  res.send(`
  <!doctype html>
  <html lang="ru">
  <head>
    <meta charset="utf-8">
    <title>Список добавленных ID</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 40px; background:#f8fafc; color:#111; }
      h1 { font-size: 22px; margin-bottom: 20px; }
      table { border-collapse: collapse; width: 100%; background:white; box-shadow:0 1px 4px rgba(0,0,0,0.1); }
      th, td { padding: 8px 12px; border-bottom: 1px solid #ddd; text-align:left; }
      th { background:#e0f0ff; cursor:pointer; }
      tr:hover { background:#f1f5f9; }
      #filter { margin-bottom: 15px; padding: 6px 8px; width: 250px; }
    </style>
  </head>
  <body>
    <h1>Список добавленных ID</h1>
    <input id="filter" type="text" placeholder="Фильтр по ID или пользователю">
    <table id="idTable">
      <thead>
        <tr>
          <th data-field="id">ID</th>
          <th data-field="added_by">Добавил</th>
          <th data-field="created_at">Когда</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <script>
      async function loadData() {
        const res = await fetch("/api/list-full");
        const data = await res.json();
        renderTable(data.items);
      }

      function renderTable(items) {
        const filter = document.getElementById("filter").value.toLowerCase();
        const tbody = document.querySelector("#idTable tbody");
        tbody.innerHTML = "";

        items
          .filter(it => it.id.toLowerCase().includes(filter) || it.added_by.toLowerCase().includes(filter))
          .forEach(it => {
            const tr = document.createElement("tr");
            tr.innerHTML = \`
              <td>\${it.id}</td>
              <td>\${it.added_by}</td>
              <td>\${new Date(it.created_at).toLocaleString()}</td>
            \`;
            tbody.appendChild(tr);
          });
      }

      document.getElementById("filter").addEventListener("input", loadData);

      document.querySelectorAll("th").forEach(th => {
        th.addEventListener("click", () => {
          const field = th.getAttribute("data-field");
          const rows = Array.from(document.querySelectorAll("#idTable tbody tr"));
          const sorted = rows.sort((a,b) =>
            a.children[th.cellIndex].textContent.localeCompare(b.children[th.cellIndex].textContent)
          );
          const tbody = document.querySelector("#idTable tbody");
          tbody.innerHTML = "";
          sorted.forEach(r => tbody.appendChild(r));
        });
      });

      loadData();
    </script>
  </body>
  </html>
  `);
});

app.listen(process.env.PORT || 10000, () =>
  console.log("🚀 Сервер запущен и слушает порт 10000")
);

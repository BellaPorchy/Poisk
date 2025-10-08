import express from "express";
import cors from "cors";
import fs from "fs";
import pkg from "pg";

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

// ===================== БАЗА ДАННЫХ =====================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://user:pass@host:5432/dbname",
  ssl: { rejectUnauthorized: false },
});

async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ids (
      id TEXT PRIMARY KEY,
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW()
    );
  `);

  // Добавляем колонку note, если её нет
  const check = await pool.query(`
    SELECT column_name FROM information_schema.columns 
    WHERE table_name='ids' AND column_name='note';
  `);

  if (check.rows.length === 0) {
    console.log("🛠 Добавляем недостающее поле note...");
    await pool.query("ALTER TABLE ids ADD COLUMN note TEXT DEFAULT '';");
  }

  console.log("✅ Таблица проверена / обновлена (есть поле note)");
}

// ===================== КЛЮЧИ =====================
const KEYS_FILE = "./keys.json";
let KEY_MAP = new Map();

function loadKeys() {
  try {
    const raw = fs.readFileSync(KEYS_FILE, "utf8");
    const parsed = JSON.parse(raw);
    KEY_MAP = new Map(parsed.keys.map(k => [k.key, k.user]));
    console.log("✅ Загружено ключей:", KEY_MAP.size);
  } catch (err) {
    console.error("❌ Не удалось загрузить keys.json:", err);
    KEY_MAP = new Map();
  }
}

loadKeys();
fs.watchFile(KEYS_FILE, () => {
  console.log("♻️ Файл keys.json изменён — перезагружаем ключи...");
  loadKeys();
});

// ===================== API =====================

// Получить список ID
app.get("/api/list-full", async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
    res.json({ items: result.rows });
  } catch (e) {
    res.status(500).json({ error: "Ошибка получения списка" });
  }
});

// Добавить новый ID
app.post("/api/add-id", async (req, res) => {
  try {
    let { id, apiKey } = req.body;
    if (!id || !apiKey)
      return res.status(400).json({ error: "ID или ключ отсутствует" });

    id = id.trim();
    apiKey = apiKey.trim();

    const user = KEY_MAP.get(apiKey);
    console.log("📥 Добавление ID:", id, "| Ключ:", apiKey, "| Пользователь:", user);

    if (!user) return res.status(403).json({ error: "Неверный API ключ" });

    await pool.query(
      `INSERT INTO ids (id, added_by)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [id, user]
    );

    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка добавления ID" });
  }
});

// Удалить ID
app.delete("/api/delete/:id", async (req, res) => {
  try {
    const id = req.params.id;
    await pool.query("DELETE FROM ids WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка удаления ID" });
  }
});

// Добавить / изменить заметку
app.post("/api/note/:id", async (req, res) => {
  try {
    const id = req.params.id;
    const { note } = req.body;
    await pool.query("UPDATE ids SET note = $1 WHERE id = $2", [note, id]);
    res.json({ success: true });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка обновления заметки" });
  }
});

// ===================== HTML ИНТЕРФЕЙС =====================
app.get("/", async (req, res) => {
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
      #filter, #newId, #apiKey { margin-right: 10px; padding: 6px 8px; }
      #filter { width: 250px; }
      .form-row { margin-bottom: 20px; }
      button { padding: 6px 12px; border-radius: 4px; border: none; cursor: pointer; }
      #addBtn { background:#22c55e; color:white; }
      #addBtn:hover { background:#16a34a; }
      .btn-del { background:#ef4444; color:white; }
      .btn-del:hover { background:#dc2626; }
      .btn-note { background:#3b82f6; color:white; }
      .btn-note:hover { background:#2563eb; }
      .note { color:#444; font-style:italic; }
      .error { color:red; margin-top:10px; }
    </style>
  </head>
  <body>
    <h1>Список добавленных ID</h1>
    
    <div class="form-row">
      <input id="newId" type="text" placeholder="Введите новый ID">
      <input id="apiKey" type="text" placeholder="Введите ваш API ключ">
      <button id="addBtn">Добавить</button>
      <div class="error" id="errorMsg"></div>
    </div>

    <input id="filter" type="text" placeholder="Фильтр по ID, пользователю или заметке">

    <table id="idTable">
      <thead>
        <tr>
          <th>ID</th>
          <th>Добавил</th>
          <th>Заметка</th>
          <th>Когда</th>
          <th>Действия</th>
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
          .filter(it =>
            it.id.toLowerCase().includes(filter) ||
            it.added_by.toLowerCase().includes(filter) ||
            (it.note && it.note.toLowerCase().includes(filter))
          )
          .forEach(it => {
            const tr = document.createElement("tr");
            tr.innerHTML = \`
              <td>\${it.id}</td>
              <td>\${it.added_by}</td>
              <td class="note">\${it.note || ""}</td>
              <td>\${new Date(it.created_at).toLocaleString()}</td>
              <td>
                <button class="btn-note" onclick="editNote('\${it.id}', '\${it.note || ""}')">✏️</button>
                <button class="btn-del" onclick="deleteID('\${it.id}')">🗑</button>
              </td>
            \`;
            tbody.appendChild(tr);
          });
      }

      document.getElementById("filter").addEventListener("input", loadData);

      document.getElementById("addBtn").addEventListener("click", async () => {
        const id = document.getElementById("newId").value.trim();
        const apiKey = document.getElementById("apiKey").value.trim();
        const errBox = document.getElementById("errorMsg");
        errBox.textContent = "";

        if (!id || !apiKey) {
          errBox.textContent = "Введите ID и API ключ!";
          return;
        }

        const res = await fetch("/api/add-id", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, apiKey })
        });

        const data = await res.json();
        if (!data.success) {
          errBox.textContent = data.error || "Ошибка при добавлении ID";
          return;
        }

        document.getElementById("newId").value = "";
        loadData();
      });

      async function deleteID(id) {
        if (!confirm("Удалить ID " + id + "?")) return;
        await fetch("/api/delete/" + id, { method: "DELETE" });
        loadData();
      }

      async function editNote(id, currentNote) {
        const newNote = prompt("Введите заметку для " + id + ":", currentNote);
        if (newNote === null) return;
        await fetch("/api/note/" + id, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ note: newNote })
        });
        loadData();
      }

      loadData();
    </script>
  </body>
  </html>
  `);
});

// ===================== ЗАПУСК =====================
await initDB();

app.listen(process.env.PORT || 10000, () =>
  console.log("🚀 Сервер запущен и слушает порт 10000")
);

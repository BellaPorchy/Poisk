import express from "express";
import cors from "cors";
import fs from "fs";
import pkg from "pg";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();
const MASTER_KEY = process.env.MASTER_KEY;

const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ dest: "uploads/" });

// === PostgreSQL ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// === Инициализация БД ===
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ids (
      id TEXT PRIMARY KEY,
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      note TEXT
    );
  `);
  console.log("✅ Таблица проверена / создана");
}
await initDB();

// === Загрузка keys.json (на сервере Render должен быть в корне) ===
let keyMap = {};
try {
  const keysRaw = fs.readFileSync("./keys.json", "utf8");
  const keys = JSON.parse(keysRaw).keys;
  keyMap = Object.fromEntries(keys.map(k => [k.key, k.user]));
} catch {
  console.warn("⚠️ keys.json не найден, пользователи будут отображаться как ключи");
}

// === API ===

// Получить весь список
app.get("/api/list", async (req, res) => {
  const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  res.json({ items: result.rows });
});

// Добавить ID
app.post("/api/add-id", async (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "Отсутствует ID или ключ" });
  const user = keyMap[apiKey] || apiKey;
  await pool.query(
    `INSERT INTO ids (id, added_by)
     VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [id, user]
  );
  res.json({ success: true });
});

// Удалить несколько ID
app.post("/api/delete", async (req, res) => {
  const { ids, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Неверный мастер-ключ" });
  if (!Array.isArray(ids)) return res.status(400).json({ error: "Некорректные данные" });

  await pool.query(`DELETE FROM ids WHERE id = ANY($1)`, [ids]);
  res.json({ success: true });
});

// Добавить / обновить заметку
app.post("/api/note", async (req, res) => {
  const { id, note } = req.body;
  await pool.query(`UPDATE ids SET note = $1 WHERE id = $2`, [note, id]);
  res.json({ success: true });
});

// Импорт ID (через файл)
app.post("/api/import", upload.single("file"), async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Неверный мастер-ключ" });
  if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

  const raw = fs.readFileSync(req.file.path, "utf8");
  const data = JSON.parse(raw);
  let added = 0;

  for (const id of data.ids || []) {
    await pool.query(
      `INSERT INTO ids (id, added_by)
       VALUES ($1, $2)
       ON CONFLICT (id) DO NOTHING`,
      [id, "import"]
    );
    added++;
  }

  fs.unlinkSync(req.file.path);
  res.json({ success: true, added });
});

// === Главная страница ===
app.get("/", async (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <title>ID Manager</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      background: #f6f8fa;
      margin: 0;
      padding: 20px;
      color: #111;
    }
    h1 {
      font-size: 20px;
      margin-bottom: 16px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      background: white;
      box-shadow: 0 1px 4px rgba(0,0,0,0.1);
    }
    th, td {
      padding: 6px 8px;
      border-bottom: 1px solid #eee;
      text-align: left;
      font-size: 14px;
    }
    th {
      background: #e9f2ff;
    }
    tr:hover {
      background: #f2f7ff;
    }
    .controls {
      margin-bottom: 12px;
      display: flex;
      gap: 8px;
      align-items: center;
    }
    input, button {
      font-size: 14px;
      padding: 6px 10px;
    }
    button {
      border: none;
      background: #007bff;
      color: white;
      border-radius: 4px;
      cursor: pointer;
    }
    button:hover {
      background: #005fcc;
    }
    .note {
      color: #444;
      font-size: 13px;
    }
  </style>
</head>
<body>
  <h1>📋 Список добавленных ID</h1>

  <div class="controls">
    <input type="password" id="masterKey" placeholder="Мастер ключ">
    <button onclick="importIDs()">📥 Импорт</button>
    <input type="file" id="importFile" style="display:none" accept=".json">
    <button id="deleteBtn" onclick="deleteSelected()">🗑️ Удалить выбранные</button>
  </div>

  <table>
    <thead>
      <tr>
        <th><input type="checkbox" id="chkAll"></th>
        <th>ID</th>
        <th>Добавил</th>
        <th>Когда</th>
        <th>Заметка</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>

  <script>
    const tbody = document.getElementById('tbody');
    const masterInput = document.getElementById('masterKey');
    const chkAll = document.getElementById('chkAll');

    async function load() {
      const res = await fetch('/api/list');
      const data = await res.json();
      tbody.innerHTML = data.items.map(x => \`
        <tr>
          <td><input type="checkbox" class="chk" data-id="\${x.id}"></td>
          <td>\${x.id}</td>
          <td>\${x.added_by}</td>
          <td>\${new Date(x.created_at).toLocaleString()}</td>
          <td>
            <input class="note" type="text" value="\${x.note || ''}" data-id="\${x.id}" placeholder="Добавить заметку...">
          </td>
        </tr>\`).join('');
      bindEvents();
    }

    function bindEvents() {
      document.querySelectorAll('.note').forEach(input => {
        input.addEventListener('change', async () => {
          await fetch('/api/note', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify({ id: input.dataset.id, note: input.value })
          });
        });
      });
    }

    chkAll.addEventListener('change', () => {
      document.querySelectorAll('.chk').forEach(chk => chk.checked = chkAll.checked);
    });

    async function deleteSelected() {
      const masterKey = masterInput.value.trim();
      if (!masterKey) return alert('Введите мастер-ключ');
      const ids = Array.from(document.querySelectorAll('.chk:checked')).map(x => x.dataset.id);
      if (ids.length === 0) return alert('Не выбрано ни одной записи');

      const res = await fetch('/api/delete', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ ids, masterKey })
      });
      const data = await res.json();
      if (data.success) load();
      else alert(data.error || 'Ошибка удаления');
    }

    function importIDs() {
      document.getElementById('importFile').click();
    }

    document.getElementById('importFile').addEventListener('change', async e => {
      const file = e.target.files[0];
      const masterKey = masterInput.value.trim();
      if (!file || !masterKey) return alert('Файл или ключ не указан');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('masterKey', masterKey);
      const res = await fetch('/api/import', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.success) {
        alert('Импортировано: ' + data.added);
        load();
      } else alert(data.error);
    });

    load();
    setInterval(load, 2000);
  </script>
</body>
</html>
  `);
});

app.listen(process.env.PORT || 10000, () =>
  console.log("🚀 Сервер запущен и слушает порт 10000")
);

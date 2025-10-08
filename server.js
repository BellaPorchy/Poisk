// ======================================================
// 🧩 Импорт библиотек и инициализация окружения
// ======================================================
import express from "express";
import bodyParser from "body-parser";
import pkg from "pg";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import dotenv from "dotenv";
dotenv.config();

const { Pool } = pkg;
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = process.env.PORT || 10000;

// ======================================================
// 🗄️ Подключение к базе данных
// ======================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ======================================================
// 🔐 Загрузка ключей и мастер-ключа из .env
// ======================================================
const MASTER_KEY = process.env.MASTER_KEY || "default_master";
let keyMap = {};

try {
  keyMap = JSON.parse(process.env.API_KEYS || "{}");
  console.log("✅ API ключи успешно загружены из .env");
} catch (e) {
  console.error("❌ Ошибка при чтении API_KEYS из .env:", e);
}

// ======================================================
// ⚙️ Настройка Express
// ======================================================
app.use(cors());
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));

// ======================================================
// 🚀 Инициализация таблицы, если не существует
// ======================================================
(async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ids (
      id TEXT PRIMARY KEY,
      user_name TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      note TEXT DEFAULT ''
    )
  `);
  console.log("✅ Таблица 'ids' готова");
})();

// ======================================================
// 🧠 Вспомогательная функция для проверки ключа
// ======================================================
function getUserByKey(key) {
  return keyMap[key] || null;
}

// ======================================================
// 📩 Добавление нового ID
// ======================================================
app.post("/api/add", async (req, res) => {
  const { id, key } = req.body;
  const user = getUserByKey(key);
  if (!user) return res.status(403).json({ error: "Неверный API ключ" });

  try {
    await pool.query(
      "INSERT INTO ids (id, user_name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
      [id, user]
    );
    res.json({ success: true, user });
  } catch (err) {
    console.error("Ошибка добавления ID:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ======================================================
// 📋 Получение полного списка
// ======================================================
app.get("/api/list-full", async (_, res) => {
  try {
    const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка получения списка:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ======================================================
// 🗑️ Удаление записей
// ======================================================
app.post("/api/delete", async (req, res) => {
  const { ids, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Неверный мастер ключ" });

  try {
    await pool.query("DELETE FROM ids WHERE id = ANY($1)", [ids]);
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка удаления:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ======================================================
// 📝 Обновление заметки
// ======================================================
app.post("/api/note", async (req, res) => {
  const { id, note } = req.body;
  try {
    await pool.query("UPDATE ids SET note = $1 WHERE id = $2", [note, id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка обновления заметки:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ======================================================
// 📦 Импорт через файл (доступно только с мастер-ключом)
// ======================================================
app.post("/api/import", upload.single("file"), async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Неверный мастер ключ" });

  try {
    const data = JSON.parse(req.file.buffer.toString());
    for (const item of data) {
      await pool.query(
        "INSERT INTO ids (id, user_name, note) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING",
        [item.id, item.user_name || "Импорт", item.note || ""]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка импорта:", err);
    res.status(500).json({ error: "Ошибка импорта" });
  }
});

// ======================================================
// 🧾 Экспорт данных
// ======================================================
app.get("/api/export", async (_, res) => {
  try {
    const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
    res.json(result.rows);
  } catch (err) {
    console.error("Ошибка экспорта:", err);
    res.status(500).json({ error: "Ошибка сервера" });
  }
});

// ======================================================
// 🌐 Главная страница (таблица с автообновлением и дизайном)
// ======================================================
app.get("/", async (_, res) => {
  const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  const rows = result.rows;

  res.send(`
    <!DOCTYPE html>
    <html lang="ru">
    <head>
      <meta charset="UTF-8" />
      <title>ID Tracker</title>
      <style>
        body { font-family: system-ui; background: #f9fafb; padding: 20px; }
        h1 { text-align: center; color: #333; }
        table { width: 100%; border-collapse: collapse; margin-top: 20px; background: white; box-shadow: 0 2px 6px rgba(0,0,0,0.1); border-radius: 10px; overflow: hidden; }
        th, td { padding: 10px; border-bottom: 1px solid #eee; text-align: left; }
        tr:hover { background: #f1f5f9; }
        input.note { width: 100%; border: none; background: #f8fafc; padding: 6px; border-radius: 4px; }
        .controls { margin-bottom: 20px; text-align: center; }
        button { margin: 5px; padding: 10px 15px; border: none; border-radius: 6px; cursor: pointer; background: #2563eb; color: white; }
        button:hover { background: #1d4ed8; }
      </style>
    </head>
    <body>
      <h1>📋 Список ID</h1>
      <div class="controls">
        <input type="password" id="masterKey" placeholder="Мастер ключ">
        <button onclick="deleteSelected()">🗑 Удалить выбранные</button>
        <button onclick="exportData()">⬇️ Экспорт</button>
        <input type="file" id="importFile" accept=".json">
        <button onclick="importData()">⬆️ Импорт</button>
      </div>
      <table id="table">
        <thead>
          <tr><th></th><th>ID</th><th>Пользователь</th><th>Дата</th><th>Заметка</th></tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (x) => `
              <tr data-id="${x.id}">
                <td><input type="checkbox" class="chk"></td>
                <td>${x.id}</td>
                <td>${x.user_name}</td>
                <td>${new Date(x.created_at).toLocaleString()}</td>
                <td><input class="note" value="${x.note || ""}" onchange="saveNote('${x.id}', this.value)"></td>
              </tr>`
            )
            .join("")}
        </tbody>
      </table>

      <script>
        async function refresh() {
          const res = await fetch("/api/list-full");
          const data = await res.json();
          const checked = Array.from(document.querySelectorAll('.chk'))
            .filter(c => c.checked)
            .map(c => c.closest('tr').dataset.id);
          const tbody = document.querySelector("#table tbody");
          tbody.innerHTML = data.map(x => \`
            <tr data-id="\${x.id}">
              <td><input type="checkbox" class="chk" \${checked.includes(x.id) ? "checked" : ""}></td>
              <td>\${x.id}</td>
              <td>\${x.user_name}</td>
              <td>\${new Date(x.created_at).toLocaleString()}</td>
              <td><input class="note" value="\${x.note || ""}" onchange="saveNote('\${x.id}', this.value)"></td>
            </tr>\`).join("");
        }
        setInterval(refresh, 2000);

        async function deleteSelected() {
          const ids = Array.from(document.querySelectorAll('.chk:checked')).map(c => c.closest('tr').dataset.id);
          const masterKey = document.querySelector('#masterKey').value.trim();
          if (!ids.length) return alert("Ничего не выбрано");
          const res = await fetch("/api/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ids, masterKey })
          });
          const r = await res.json();
          if (r.success) refresh();
          else alert(r.error || "Ошибка");
        }

        async function saveNote(id, note) {
          await fetch("/api/note", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, note })
          });
        }

        async function exportData() {
          const res = await fetch("/api/export");
          const data = await res.json();
          const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = "ids_export.json";
          a.click();
        }

        async function importData() {
          const fileInput = document.querySelector('#importFile');
          const masterKey = document.querySelector('#masterKey').value.trim();
          if (!fileInput.files.length) return alert("Выбери файл");
          const form = new FormData();
          form.append("file", fileInput.files[0]);
          form.append("masterKey", masterKey);
          const res = await fetch("/api/import", { method: "POST", body: form });
          const r = await res.json();
          if (r.success) refresh();
          else alert(r.error || "Ошибка импорта");
        }
      </script>
    </body>
    </html>
  `);
});

// ======================================================
// 🏁 Запуск сервера
// ======================================================
app.listen(PORT, () => console.log(`🚀 Сервер запущен на порту ${PORT}`));

import express from "express";
import cors from "cors";
import fs from "fs";
import multer from "multer";
import pkg from "pg";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;

// ===============================
// 🔧 Конфигурация
// ===============================
const app = express();
const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 10000;
const MASTER_KEY = process.env.MASTER_KEY || "changeme";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===============================
// 💾 PostgreSQL
// ===============================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

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

// ===============================
// 🔑 Загрузка ключей
// ===============================
let keyMap = new Map();

function loadKeys() {
  try {
    if (process.env.KEYS_JSON) {
      const data = JSON.parse(process.env.KEYS_JSON);
      keyMap = new Map(data.keys.map(k => [k.key, k.user]));
      console.log("🔑 Ключи загружены из переменной окружения");
    } else if (fs.existsSync("./keys.json")) {
      const data = JSON.parse(fs.readFileSync("./keys.json", "utf8"));
      keyMap = new Map(data.keys.map(k => [k.key, k.user]));
      console.log("🔑 Ключи загружены из файла keys.json");
    } else {
      console.warn("⚠️ Ключи не найдены — добавление ID будет ограничено");
    }
  } catch (e) {
    console.error("❌ Ошибка загрузки ключей:", e);
  }
}
loadKeys();

// ===============================
// 🌐 Главная страница
// ===============================
app.get("/", async (req, res) => {
  res.send(`
  <!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <title>🔍 Список ID</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 40px; background:#f9fafb; color:#111; }
      h1 { font-size: 22px; margin-bottom: 20px; }
      button { cursor: pointer; border: none; border-radius: 6px; padding: 6px 10px; font-size: 14px; transition: background 0.3s, transform 0.1s; }
      button:hover { transform: scale(1.05); }
      .toolbar { margin-bottom: 15px; display:flex; flex-wrap:wrap; gap:6px; align-items:center; }
      table { border-collapse: collapse; width: 100%; background:white; box-shadow:0 2px 6px rgba(0,0,0,0.1); }
      th, td { padding: 10px 12px; border-bottom: 1px solid #eee; text-align:left; vertical-align:top; }
      th { background:#e3f2fd; }
      tr:hover { background:#f8fbff; }
      .note { color:#444; font-size:13px; }
      input[type="checkbox"] { transform:scale(1.2); margin-right:6px; }
      #filter { padding:6px 8px; width: 240px; border-radius:6px; border:1px solid #ccc; }
      textarea { width:100%; min-height:50px; resize:vertical; border-radius:6px; border:1px solid #ddd; padding:6px; }
      #status { font-size:12px; color:#666; margin-top:6px; }
    </style>
  </head>
  <body>
    <h1>🔍 Список добавленных ID</h1>
    <div class="toolbar">
      <input id="filter" placeholder="Фильтр по ID или пользователю">
      <button id="refreshBtn">🔄 Обновить</button>
      <button id="addBtn">➕ Добавить вручную</button>
      <button id="deleteBtn">🗑️ Удалить выбранные</button>
      <button id="exportBtn">📤 Экспорт</button>
      <input type="file" id="importFile" style="display:none">
      <button id="importBtn">📥 Импорт</button>
      <button id="keyBtn">🔑 Мастер-ключ</button>
    </div>
    <div id="status">⏳ Автообновление каждые 2 секунды</div>
    <table>
      <thead>
        <tr>
          <th></th>
          <th>ID</th>
          <th>Добавил</th>
          <th>Когда</th>
          <th>Заметка</th>
        </tr>
      </thead>
      <tbody id="tbody"></tbody>
    </table>

    <script>
      function getMasterKey() {
        return localStorage.getItem("master_key");
      }
      function requestMasterKey() {
        const existing = getMasterKey();
        const key = prompt(existing ? "Введите новый мастер-ключ (или оставьте пустым):" : "Введите мастер-ключ:");
        if (key) localStorage.setItem("master_key", key);
      }

      async function loadData() {
        try {
          const res = await fetch("/api/list-full");
          const data = await res.json();
          const tbody = document.getElementById("tbody");
          const filter = document.getElementById("filter").value.toLowerCase();
          tbody.innerHTML = "";

          data.items
            .filter(x => x.id.toLowerCase().includes(filter) || x.added_by.toLowerCase().includes(filter))
            .forEach(x => {
              const tr = document.createElement("tr");
              tr.innerHTML = \`
                <td><input type="checkbox" class="chk" data-id="\${x.id}"></td>
                <td>\${x.id}</td>
                <td>\${x.added_by}</td>
                <td>\${new Date(x.created_at).toLocaleString()}</td>
                <td>
                  <textarea data-id="\${x.id}" class="note">\${x.note || ""}</textarea>
                </td>
              \`;
              tbody.appendChild(tr);
            });

          document.querySelectorAll(".note").forEach(el => {
            el.addEventListener("change", async () => {
              const key = getMasterKey();
              if (!key) return alert("Введите мастер-ключ перед изменением заметок");
              const id = el.dataset.id;
              const note = el.value.trim();
              const res = await fetch("/api/update-note", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ id, note, masterKey: key })
              });
              const r = await res.json();
              if (!r.success) alert("Ошибка сохранения заметки: " + r.error);
            });
          });
        } catch (err) {
          console.error("Ошибка загрузки:", err);
        }
      }

      async function deleteSelected() {
        const key = getMasterKey();
        if (!key) return alert("Введите мастер-ключ");
        const ids = Array.from(document.querySelectorAll(".chk:checked")).map(c => c.dataset.id);
        if (ids.length === 0) return alert("Выберите хотя бы один ID");
        if (!confirm("Удалить выбранные?")) return;
        for (const id of ids) {
          await fetch("/api/delete", {
            method:"POST",
            headers:{ "Content-Type":"application/json" },
            body: JSON.stringify({ id, masterKey: key })
          });
        }
        loadData();
      }

      async function addManual() {
        const key = getMasterKey();
        if (!key) return alert("Введите мастер-ключ");
        const id = prompt("Введите новый ID:");
        if (!id) return;
        const res = await fetch("/api/add-id", {
          method:"POST",
          headers:{ "Content-Type":"application/json" },
          body: JSON.stringify({ id, apiKey:key })
        });
        const r = await res.json();
        if (!r.success) alert("Ошибка добавления: " + r.error);
        loadData();
      }

      async function exportIDs() {
        const res = await fetch("/api/list-full");
        const data = await res.json();
        const blob = new Blob([JSON.stringify(data.items, null, 2)], {type:"application/json"});
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "ids_export.json";
        a.click();
      }

      async function importIDs(file) {
        const key = getMasterKey();
        if (!key) return alert("Введите мастер-ключ");
        const formData = new FormData();
        formData.append("file", file);
        formData.append("masterKey", key);
        const res = await fetch("/api/import", { method:"POST", body:formData });
        const data = await res.json();
        if (data.success) alert("Импортировано: " + data.imported);
        else alert("Ошибка импорта: " + data.error);
        loadData();
      }

      // Обработчики
      document.getElementById("refreshBtn").onclick = loadData;
      document.getElementById("filter").oninput = loadData;
      document.getElementById("deleteBtn").onclick = deleteSelected;
      document.getElementById("addBtn").onclick = addManual;
      document.getElementById("exportBtn").onclick = exportIDs;
      document.getElementById("importBtn").onclick = () => document.getElementById("importFile").click();
      document.getElementById("importFile").onchange = e => importIDs(e.target.files[0]);
      document.getElementById("keyBtn").onclick = requestMasterKey;

      // 🔁 Автоматическое обновление каждые 2 секунды
      loadData();
      setInterval(loadData, 2000);
    </script>
  </body>
  </html>
  `);
});

// ===============================
// 📡 API методы
// ===============================
app.get("/api/list-full", async (req, res) => {
  const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  res.json({ items: result.rows });
});

app.post("/api/add-id", async (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "ID или ключ отсутствует" });
  const addedBy = keyMap.get(apiKey) || "Unknown";
  await pool.query(
    `INSERT INTO ids (id, added_by) VALUES ($1, $2)
     ON CONFLICT (id) DO NOTHING`,
    [id, addedBy]
  );
  res.json({ success: true });
});

app.post("/api/update-note", async (req, res) => {
  const { id, note, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Неверный ключ" });
  await pool.query("UPDATE ids SET note=$1 WHERE id=$2", [note, id]);
  res.json({ success: true });
});

app.post("/api/delete", async (req, res) => {
  const { id, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Неверный ключ" });
  await pool.query("DELETE FROM ids WHERE id=$1", [id]);
  res.json({ success: true });
});

app.post("/api/import", upload.single("file"), async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Неверный ключ" });
  try {
    const fileData = JSON.parse(fs.readFileSync(req.file.path, "utf8"));
    let imported = 0;
    for (const item of fileData) {
      await pool.query(
        "INSERT INTO ids (id, added_by, note) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
        [item.id, item.added_by || "import", item.note || null]
      );
      imported++;
    }
    res.json({ success: true, imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===============================
// 🚀 Запуск
// ===============================
app.listen(PORT, () => console.log("🚀 Сервер запущен на порту " + PORT));

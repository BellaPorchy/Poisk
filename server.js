// ==========================================
//  📦 Импорты и настройка окружения
// ==========================================
import express from "express";
import cors from "cors";
import fs from "fs";
import multer from "multer";
import dotenv from "dotenv";
import pkg from "pg";

dotenv.config();
const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());

// ==========================================
//  ⚙️ Настройка базы данных
// ==========================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://user:pass@host:5432/dbname",
  ssl: { rejectUnauthorized: false },
});

// Создание таблицы, если её нет
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ids (
      id TEXT PRIMARY KEY,
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      note TEXT DEFAULT ''
    );
  `);
  console.log("✅ Таблица проверена / создана");
}

// ==========================================
//  🔑 Загрузка ключей пользователей
// ==========================================
const keysPath = "./keys.json";
let keyMap = new Map();
if (fs.existsSync(keysPath)) {
  const data = JSON.parse(fs.readFileSync(keysPath, "utf8"));
  keyMap = new Map(data.keys.map(k => [k.key, k.user]));
  console.log("🔑 Загружено", keyMap.size, "ключей из keys.json");
} else {
  console.warn("⚠️ keys.json не найден, пользователи не будут отображаться");
}

// ==========================================
//  🚀 Инициализация
// ==========================================
await initDB();

// ==========================================
//  🧠 Middleware: проверка мастер-ключа
// ==========================================
function verifyMasterKey(req, res, next) {
  const provided = req.body.masterKey || req.query.masterKey || req.headers["x-master-key"];
  if (!provided || provided !== process.env.MASTER_KEY) {
    return res.status(403).json({ success: false, error: "Неверный мастер-ключ" });
  }
  next();
}

// ==========================================
//  📡 API Маршруты
// ==========================================

// Получение полного списка
app.get("/api/list-full", async (_, res) => {
  try {
    const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
    res.json({
      items: result.rows.map(r => ({
        ...r,
        added_by: keyMap.get(r.added_by) || r.added_by
      }))
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка получения списка" });
  }
});

// Добавление нового ID (через API-ключ)
app.post("/api/add-id", async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id || !apiKey)
      return res.status(400).json({ error: "ID или ключ отсутствует" });

    const user = keyMap.get(apiKey) || apiKey;
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

// Удаление записи (требует мастер-ключ)
app.post("/api/delete", verifyMasterKey, async (req, res) => {
  try {
    const { id } = req.body;
    await pool.query("DELETE FROM ids WHERE id = $1", [id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Ошибка удаления" });
  }
});

// Обновление заметки (требует мастер-ключ)
app.post("/api/update-note", verifyMasterKey, async (req, res) => {
  try {
    const { id, note } = req.body;
    await pool.query("UPDATE ids SET note = $1 WHERE id = $2", [note, id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Ошибка обновления заметки" });
  }
});

// ==========================================
//  📤 Экспорт / Импорт
// ==========================================
const upload = multer({ dest: "uploads/" });

// Экспорт всех данных
app.get("/api/export", verifyMasterKey, async (_, res) => {
  try {
    const result = await pool.query("SELECT * FROM ids");
    const data = JSON.stringify(result.rows, null, 2);
    res.setHeader("Content-Disposition", "attachment; filename=ids_export.json");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (e) {
    res.status(500).json({ success: false, error: "Ошибка экспорта" });
  }
});

// Импорт данных из файла
app.post("/api/import", verifyMasterKey, upload.single("file"), async (req, res) => {
  try {
    const file = req.file;
    if (!file) return res.status(400).json({ success: false, error: "Файл не получен" });

    const raw = fs.readFileSync(file.path, "utf8");
    const items = JSON.parse(raw);
    let count = 0;

    for (const item of items) {
      if (!item.id) continue;
      await pool.query(
        `INSERT INTO ids (id, added_by, created_at, note)
         VALUES ($1, $2, NOW(), $3)
         ON CONFLICT (id) DO NOTHING`,
        [item.id, item.added_by || "Импорт", item.note || ""]
      );
      count++;
    }

    fs.unlinkSync(file.path);
    res.json({ success: true, imported: count });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: "Ошибка импорта" });
  }
});

// ==========================================
//  🌐 Главная страница со списком
// ==========================================
app.get("/", async (_, res) => {
  res.send(`
  <!doctype html>
  <html lang="ru">
  <head>
    <meta charset="utf-8">
    <title>Управление ID</title>
    <style>
      body { font-family: system-ui, sans-serif; background:#f9fafb; padding:40px; color:#111; }
      h1 { font-size:24px; margin-bottom:20px; }
      table { border-collapse: collapse; width:100%; background:white; box-shadow:0 1px 4px rgba(0,0,0,0.1); }
      th, td { padding:8px 10px; border-bottom:1px solid #eee; text-align:left; }
      th { background:#dceefb; cursor:pointer; }
      tr:hover { background:#f8fafc; }
      input, textarea, button { padding:6px 8px; margin:4px; }
      .note { width: 98%; resize: vertical; }
      .toolbar { margin-bottom: 15px; }
      .toolbar button { border:none; background:#3b82f6; color:white; border-radius:6px; cursor:pointer; }
      .toolbar button:hover { background:#2563eb; }
    </style>
  </head>
  <body>
    <h1>📋 Список добавленных ID</h1>
    <div class="toolbar">
      <input id="filter" type="text" placeholder="Фильтр по ID или пользователю">
      <button id="addBtn">➕ Добавить</button>
      <button id="importBtn">📥 Импорт</button>
      <button id="exportBtn">📤 Экспорт</button>
      <button id="deleteBtn">🗑️ Удалить выбранные</button>
      <button id="keyBtn">🔑 Мастер ключ</button>
    </div>
    <table id="idTable">
      <thead>
        <tr>
          <th><input type="checkbox" id="selectAll"></th>
          <th>ID</th>
          <th>Добавил</th>
          <th>Когда</th>
          <th>Заметка</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>

    <script>
      // ==============================
      //  Работа с мастер-ключом
      // ==============================
      function getMasterKey() { return localStorage.getItem("master_key"); }
      function setMasterKey() {
        const key = prompt("Введите мастер ключ:")?.trim();
        if (key) {
          localStorage.setItem("master_key", key);
          alert("✅ Мастер ключ сохранён");
        }
      }

      document.getElementById("keyBtn").onclick = setMasterKey;

      // ==============================
      //  Загрузка и отображение данных
      // ==============================
      async function loadData() {
        const res = await fetch("/api/list-full");
        const data = await res.json();
        renderTable(data.items);
      }

      function renderTable(items) {
        const tbody = document.querySelector("#idTable tbody");
        const filter = document.getElementById("filter").value.toLowerCase();
        tbody.innerHTML = "";

        items.filter(it =>
          it.id.toLowerCase().includes(filter) ||
          it.added_by.toLowerCase().includes(filter)
        ).forEach(it => {
          const tr = document.createElement("tr");
          tr.innerHTML = \`
            <td><input type="checkbox" class="row-check" data-id="\${it.id}"></td>
            <td>\${it.id}</td>
            <td>\${it.added_by}</td>
            <td>\${new Date(it.created_at).toLocaleString()}</td>
            <td>
              <textarea class="note" data-id="\${it.id}">\${it.note || ""}</textarea>
            </td>
          \`;
          tbody.appendChild(tr);
        });

        document.querySelectorAll(".note").forEach(area => {
          area.addEventListener("change", async e => {
            const key = getMasterKey();
            if (!key) return alert("Введите мастер ключ.");
            await fetch("/api/update-note", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: area.dataset.id, note: area.value, masterKey: key })
            });
          });
        });
      }

      // ==============================
      //  Массовое удаление
      // ==============================
      document.getElementById("deleteBtn").onclick = async () => {
        const key = getMasterKey();
        if (!key) return alert("Введите мастер ключ.");
        const selected = [...document.querySelectorAll(".row-check:checked")].map(c => c.dataset.id);
        if (selected.length === 0) return alert("Ничего не выбрано.");

        if (!confirm("Удалить выбранные ID?")) return;
        for (const id of selected) {
          await fetch("/api/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id, masterKey: key })
          });
        }
        loadData();
      };

      // ==============================
      //  Экспорт / Импорт
      // ==============================
      document.getElementById("exportBtn").onclick = () => {
        const key = getMasterKey();
        if (!key) return alert("Введите мастер ключ.");
        window.location.href = "/api/export?masterKey=" + key;
      };

      document.getElementById("importBtn").onclick = async () => {
        const key = getMasterKey();
        if (!key) return alert("Введите мастер ключ.");
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json";
        input.onchange = async () => {
          const file = input.files[0];
          const formData = new FormData();
          formData.append("file", file);
          formData.append("masterKey", key);
          const res = await fetch("/api/import", { method: "POST", body: formData });
          const data = await res.json();
          alert(data.success ? "✅ Импортировано " + data.imported : "Ошибка: " + data.error);
          loadData();
        };
        input.click();
      };

      // ==============================
      //  Добавление вручную
      // ==============================
      document.getElementById("addBtn").onclick = async () => {
        const key = getMasterKey();
        if (!key) return alert("Введите мастер ключ.");
        const id = prompt("Введите новый ID:");
        if (!id) return;
        await fetch("/api/add-id", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, apiKey: key })
        });
        loadData();
      };

      document.getElementById("filter").addEventListener("input", loadData);
      document.getElementById("selectAll").addEventListener("change", e => {
        document.querySelectorAll(".row-check").forEach(ch => ch.checked = e.target.checked);
      });

      loadData();
    </script>
  </body>
  </html>
  `);
});

// ==========================================
//  🚀 Запуск сервера
// ==========================================
app.listen(process.env.PORT || 10000, () =>
  console.log("🚀 Сервер запущен и слушает порт 10000")
);

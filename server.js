import express from "express";
import cors from "cors";
import pkg from "pg";
import multer from "multer";
import dotenv from "dotenv";

dotenv.config();
const { Pool } = pkg;
const app = express();
app.use(cors());
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// === КЛЮЧИ ===
let keys = [];
if (process.env.USER_KEYS) {
  try {
    const parsed = JSON.parse(process.env.USER_KEYS);
    if (parsed && Array.isArray(parsed.keys)) {
      keys = parsed.keys;
      console.log(`✅ Загружено ${keys.length} API-ключей из окружения`);
    }
  } catch (err) {
    console.error("❌ Ошибка при чтении USER_KEYS:", err);
  }
} else {
  console.warn("⚠️ Переменная USER_KEYS не установлена");
}

// === МАСТЕР КЛЮЧ ===
const MASTER_KEY = process.env.MASTER_KEY || "default-master";

// === БАЗА ДАННЫХ ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// === ИНИЦИАЛИЗАЦИЯ ТАБЛИЦЫ ===
await pool.query(`
  CREATE TABLE IF NOT EXISTS ids (
    id TEXT PRIMARY KEY,
    added_by TEXT,
    note TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  );
`);
console.log("✅ Таблица проверена");

// === ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ===
const findUserByKey = (key) => {
  const found = keys.find((x) => x.key === key);
  return found ? found.user : key;
};

// === ГЛАВНАЯ СТРАНИЦА ===
app.get("/", async (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<title>ID Manager</title>
<style>
  body { font-family: system-ui, sans-serif; background:#f8fafc; padding:20px; color:#111; }
  table { width:100%; border-collapse:collapse; background:white; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding:4px 6px; border-bottom:1px solid #ddd; }
  th { background:#e0f0ff; text-align:left; }
  tr:hover { background:#f1f5f9; }
  input[type="text"] { padding:6px; width:250px; margin-bottom:10px; }
  button { margin:4px; padding:6px 10px; border:1px solid #ccc; border-radius:4px; cursor:pointer; }
  button:hover { background:#e5f0ff; }
  textarea { width:100%; height:40px; }
  .note { font-size:12px; color:#444; }
  #toast {
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: #22c55e;
    color: white;
    padding: 10px 16px;
    border-radius: 8px;
    opacity: 0;
    transition: opacity 0.5s;
    pointer-events: none;
    font-size: 14px;
    box-shadow: 0 2px 5px rgba(0,0,0,0.15);
  }
</style>
</head>
<body>
  <h2>🧩 ID Manager</h2>
  <div>
    <input id="filter" placeholder="Фильтр по ID или пользователю">
    <button onclick="refresh()">🔄 Обновить</button>
    <button onclick="deleteSelected()">🗑️ Удалить выбранные</button>
    <button onclick="exportData()">📤 Экспорт</button>
    <button onclick="document.getElementById('importFile').click()">📥 Импорт</button>
    <input type="file" id="importFile" accept=".json" style="display:none">
  </div>
  <table id="idTable">
    <thead>
      <tr>
        <th></th>
        <th>ID</th>
        <th>Добавил</th>
        <th>Когда</th>
        <th>Заметка</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>

  <div id="toast"></div>

<script>
let selected = new Set();
const MASTER_KEY = localStorage.getItem("master_key") || prompt("Введите мастер ключ:");
if (MASTER_KEY) localStorage.setItem("master_key", MASTER_KEY);

function showToast(text, color="#22c55e") {
  const t = document.getElementById("toast");
  t.style.background = color;
  t.textContent = text;
  t.style.opacity = "1";
  setTimeout(() => (t.style.opacity = "0"), 2500);
}

document.getElementById("filter").addEventListener("input", render);

async function load() {
  const res = await fetch("/api/list-full");
  const data = await res.json();
  window.items = data.items;
  render(false);
}

function render(clearSelection = false) {
  const filter = document.getElementById("filter").value.toLowerCase();
  const tbody = document.querySelector("#idTable tbody");
  const prevSelected = new Set(selected);

  if (clearSelection) selected.clear();

  tbody.innerHTML = "";
  (window.items||[])
    .filter(x => x.id.toLowerCase().includes(filter) || x.added_by.toLowerCase().includes(filter))
    .forEach(x => {
      const tr = document.createElement("tr");
      const checked = prevSelected.has(x.id) ? "checked" : "";
      tr.innerHTML = \`
        <td><input type="checkbox" class="chk" data-id="\${x.id}" \${checked}></td>
        <td>\${x.id}</td>
        <td>\${x.added_by}</td>
        <td>\${new Date(x.created_at).toLocaleString()}</td>
        <td><textarea data-id="\${x.id}">\${x.note || ""}</textarea></td>
      \`;
      tbody.appendChild(tr);
    });

  document.querySelectorAll(".chk").forEach(c =>
    c.addEventListener("change", e => {
      const id = e.target.dataset.id;
      if (e.target.checked) selected.add(id);
      else selected.delete(id);
    })
  );

  document.querySelectorAll("textarea").forEach(a =>
    a.addEventListener("change", async e => {
      const id = e.target.dataset.id;
      const note = e.target.value;
      const r = await fetch("/api/note", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ id, note, masterKey: MASTER_KEY })
      });
      if (r.ok) showToast("💾 Заметка сохранена");
      else showToast("❌ Ошибка сохранения", "#ef4444");
    })
  );
}

async function deleteSelected() {
  if (!confirm("Удалить выбранные?")) return;
  const r = await fetch("/api/delete-multiple", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ ids:[...selected], masterKey: MASTER_KEY })
  });
  if (r.ok) {
    showToast("🗑️ Удалено " + selected.size);
    selected.clear();
    load();
  } else showToast("❌ Ошибка удаления", "#ef4444");
}

async function exportData() {
  const res = await fetch("/api/export");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ids_export.json";
  a.click();
  showToast("📤 Экспорт выполнен");
}

document.getElementById("importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("masterKey", MASTER_KEY);
  const r = await fetch("/api/import", { method:"POST", body:formData });
  const data = await r.json();
  if (r.ok) showToast("📥 Импортировано " + (data.count || 0) + " ID");
  else showToast("❌ Ошибка импорта", "#ef4444");
  load();
});

function refresh(){ load(); }
setInterval(load, 2000);
load();
</script>
</body>
</html>
`);
});

// === API ===
app.get("/api/list-full", async (req, res) => {
  const q = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  res.json({ items: q.rows });
});

app.post("/api/add-id", async (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "Неверные данные" });
  const user = findUserByKey(apiKey);
  await pool.query(
    "INSERT INTO ids (id, added_by) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [id, user]
  );
  res.json({ success: true });
});

app.post("/api/note", async (req, res) => {
  const { id, note, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("UPDATE ids SET note=$1 WHERE id=$2", [note, id]);
  res.json({ success: true });
});

app.post("/api/delete-multiple", async (req, res) => {
  const { ids, masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("DELETE FROM ids WHERE id = ANY($1::text[])", [ids]);
  res.json({ success: true });
});

app.get("/api/export", async (req, res) => {
  const q = await pool.query("SELECT * FROM ids");
  res.setHeader("Content-Disposition", "attachment; filename=ids_export.json");
  res.json({ items: q.rows });
});

app.post("/api/import", upload.single("file"), async (req, res) => {
  try {
    const { masterKey } = req.body;
    if (masterKey !== MASTER_KEY)
      return res.status(403).json({ error: "Нет доступа" });

    if (!req.file) return res.status(400).json({ error: "Файл не загружен" });

    const content = req.file.buffer.toString("utf8");
    let json;
    try {
      json = JSON.parse(content);
    } catch {
      return res.status(400).json({ error: "Ошибка парсинга JSON" });
    }

    const items = Array.isArray(json) ? json : json.items;
    if (!Array.isArray(items))
      return res.status(400).json({ error: "Неверный формат файла" });

    for (const row of items) {
      await pool.query(
        "INSERT INTO ids (id, added_by, note, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
        [row.id, row.added_by, row.note || "", row.created_at || new Date()]
      );
    }

    res.json({ success: true, count: items.length });
  } catch (err) {
    console.error("❌ Ошибка импорта:", err);
    res.status(500).json({ error: "Ошибка на сервере" });
  }
});

// === ЗАПУСК ===
app.listen(process.env.PORT || 10000, () =>
  console.log("🚀 Сервер запущен")
);

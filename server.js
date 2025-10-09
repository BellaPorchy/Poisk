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
      console.log(`✅ Загружено ${keys.length} API-ключей`);
    }
  } catch (err) {
    console.error("❌ Ошибка USER_KEYS:", err);
  }
}

// === МАСТЕР КЛЮЧ ===
const MASTER_KEY = process.env.MASTER_KEY || "default-master";

// === БАЗА ДАННЫХ ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await pool.query(`
  CREATE TABLE IF NOT EXISTS ids (
    id TEXT PRIMARY KEY,
    added_by TEXT,
    note TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  );
`);
console.log("✅ Таблица проверена");

const findUserByKey = (key) => {
  const found = keys.find((x) => x.key === key);
  return found ? found.user : key;
};

// === ГЛАВНАЯ СТРАНИЦА ===
app.get("/", async (req, res) => {
  const data = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  res.send(`
<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8" />
<title>ID Manager</title>
<style>
  body { font-family: system-ui, sans-serif; background:#f8fafc; padding:20px; color:#111; }
  table { width:100%; border-collapse:collapse; background:white; box-shadow:0 1px 3px rgba(0,0,0,0.1); }
  th, td { padding:6px 8px; border-bottom:1px solid #ddd; }
  th { background:#e0f0ff; text-align:left; }
  tr:hover { background:#f1f5f9; }
  input[type="text"] { padding:6px; width:250px; margin-bottom:10px; }
  button { margin:4px; padding:6px 10px; border:1px solid #ccc; border-radius:4px; cursor:pointer; }
  button:hover { background:#e5f0ff; }
  textarea { width:100%; height:40px; }
  .note { font-size:12px; color:#444; }
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
    <button id="clearBtn" style="background:#fee2e2;border-color:#fca5a5;">🔥 Очистить базу</button>
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
let selected = new Set();
const MASTER_KEY = localStorage.getItem("master_key") || prompt("Введите мастер ключ (если есть, иначе просто Enter):");
if (MASTER_KEY) localStorage.setItem("master_key", MASTER_KEY);

document.getElementById("filter").addEventListener("input", render);
document.getElementById("selectAll").addEventListener("change", e => {
  const checked = e.target.checked;
  document.querySelectorAll(".chk").forEach(chk => {
    chk.checked = checked;
    if (checked) selected.add(chk.dataset.id);
    else selected.delete(chk.dataset.id);
  });
});

document.getElementById("clearBtn").addEventListener("click", async () => {
  if (!MASTER_KEY) return alert("Нет мастер-ключа!");
  if (!confirm("⚠️ Удалить ВСЕ записи?")) return;
  const res = await fetch("/api/clear-all", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ masterKey: MASTER_KEY })
  });
  if (res.ok) {
    alert("✅ База очищена");
    load();
  } else {
    alert("❌ Ошибка. Неверный мастер-ключ?");
  }
});

async function load() {
  const res = await fetch("/api/list-full");
  const data = await res.json();
  window.items = data.items;
  render();
}
function render() {
  const filter = document.getElementById("filter").value.toLowerCase();
  const tbody = document.querySelector("#idTable tbody");
  tbody.innerHTML = "";
  (window.items||[])
    .filter(x => x.id.toLowerCase().includes(filter) || x.added_by.toLowerCase().includes(filter))
    .forEach(x => {
      const tr = document.createElement("tr");
      const checked = selected.has(x.id) ? "checked" : "";
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
      await fetch("/api/note", {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ id, note, masterKey: MASTER_KEY })
      });
    })
  );
}

async function deleteSelected() {
  if (!confirm("Удалить выбранные?")) return;
  await fetch("/api/delete-multiple", {
    method:"POST",
    headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ ids:[...selected], masterKey: MASTER_KEY })
  });
  selected.clear();
  load();
}

async function exportData() {
  const res = await fetch("/api/export");
  const blob = await res.blob();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "ids_export.json";
  a.click();
}

document.getElementById("importFile").addEventListener("change", async e => {
  const file = e.target.files[0];
  if (!file) return;
  const formData = new FormData();
  formData.append("file", file);
  formData.append("masterKey", MASTER_KEY);
  await fetch("/api/import", { method:"POST", body:formData });
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

// === API: Очистка базы ===
app.post("/api/clear-all", async (req, res) => {
  const { masterKey } = req.body;
  if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
  await pool.query("DELETE FROM ids");
  res.json({ success: true });
});

app.get("/api/list-full", async (req, res) => {
  const q = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  res.json({ items: q.rows });
});

app.post("/api/add-manual", async (req, res) => {
  const { id, masterKey } = req.body;
  if (!id) return res.status(400).json({ error: "Нет ID" });
  const user = masterKey === MASTER_KEY ? "Manual (Admin)" : "Manual (Guest)";
  await pool.query("INSERT INTO ids (id, added_by) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [id, user]);
  res.json({ success: true });
});

app.post("/api/add-id", async (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "Неверные данные" });
  const user = findUserByKey(apiKey);
  await pool.query("INSERT INTO ids (id, added_by) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING", [id, user]);
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
  res.json(q.rows);
});

app.post("/api/import", upload.single("file"), async (req, res) => {
  try {
    const { masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: "Нет доступа" });
    const fileData = JSON.parse(req.file.buffer.toString());
    const items = Array.isArray(fileData.items) ? fileData.items : fileData;
    for (const row of items) {
      await pool.query(
        "INSERT INTO ids (id, added_by, note, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING",
        [row.id, row.added_by, row.note || "", row.created_at || new Date()]
      );
    }
    res.json({ success: true });
  } catch (err) {
    console.error("Ошибка импорта:", err);
    res.status(500).json({ error: "Ошибка импорта" });
  }
});

app.listen(process.env.PORT || 10000, () => console.log("🚀 Сервер запущен"));

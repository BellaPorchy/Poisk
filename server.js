// ======================================================
// 🧠 Импорт зависимостей
// ======================================================
import express from "express";
import cors from "cors";
import fs from "fs";
import pkg from "pg";
import multer from "multer";
import XLSX from "xlsx";
import { stringify } from "csv-stringify/sync";
import dotenv from "dotenv";
dotenv.config();


const { Pool } = pkg;

// ======================================================
// ⚙️ Настройки сервера
// ======================================================
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const upload = multer({ dest: "uploads/" });
const PORT = process.env.PORT || 10000;
const MASTER_KEY = process.env.MASTER_KEY;

// ======================================================
// 🗝 Загрузка API-ключей (keys.json)
// ======================================================
const KEYS_FILE = "./keys.json";
let keysData = {};

function loadKeys() {
  try {
    const data = JSON.parse(fs.readFileSync(KEYS_FILE, "utf8"));
    keysData = {};
    data.keys.forEach(k => (keysData[k.key] = k.user));
    console.log("🔑 Загружены ключи:", Object.values(keysData));
  } catch (e) {
    console.error("⚠️ Не удалось загрузить keys.json", e);
  }
}
loadKeys();

// ======================================================
// 🗃 Подключение к PostgreSQL
// ======================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "postgres://user:pass@host:5432/dbname",
  ssl: { rejectUnauthorized: false },
});

// ======================================================
// 🧩 Инициализация базы данных
// ======================================================
async function initDB() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ids (
      id TEXT PRIMARY KEY,
      added_by TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      note TEXT DEFAULT ''
    );
  `);
  console.log("✅ Таблица 'ids' готова");
}
await initDB();

// ======================================================
// 🧱 Главная HTML-страница
// ======================================================
app.get("/", async (req, res) => {
  const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");

  res.send(`
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>База ID</title>
<style>
body {
  font-family: system-ui, sans-serif;
  background: #f6f8fb;
  color: #222;
  margin: 40px;
}
h1 { margin-bottom: 10px; }
.controls {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}
button {
  cursor: pointer;
  border: none;
  border-radius: 4px;
  padding: 8px 12px;
  color: white;
  font-weight: 500;
}
button.add { background: #3498db; }
button.export { background: #27ae60; }
button.import { background: #9b59b6; }
button.mass-delete { background: #e74c3c; }
input[type="text"], input[type="password"] {
  padding: 6px 8px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
table {
  border-collapse: collapse;
  width: 100%;
  background: white;
  box-shadow: 0 1px 4px rgba(0,0,0,0.1);
}
th, td {
  padding: 8px 12px;
  border-bottom: 1px solid #eee;
}
th { background: #e8f0ff; }
tr:hover { background: #f9fbff; }
.note { width: 100%; border: 1px solid #ccc; border-radius: 4px; }
</style>
</head>
<body>
  <h1>🗂 База добавленных ID</h1>

  <div class="controls">
    <input id="search" placeholder="🔍 Поиск..." />
    <input type="password" id="masterKey" placeholder="Мастер-ключ" />
    <button id="addManually" class="add">➕ Добавить вручную</button>
    <button id="exportCSV" class="export">📤 Экспорт CSV</button>
    <button id="exportXLSX" class="export">📤 Экспорт XLSX</button>
    <label style="background:#9b59b6;padding:8px 12px;border-radius:4px;cursor:pointer;">
      📥 Импорт <input type="file" id="importFile" accept=".csv,.xlsx" style="display:none">
    </label>
    <button id="deleteSelected" class="mass-delete">🗑 Удалить выбранные</button>
  </div>

  <table id="idTable">
    <thead>
      <tr>
        <th><input type="checkbox" id="selectAll"></th>
        <th>ID</th>
        <th>Добавил</th>
        <th>Когда</th>
        <th>Заметка</th>
        <th>Действия</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>

<script>
// ======================================================
// 📄 Рендер таблицы
// ======================================================
const allData = ${JSON.stringify(result.rows)};
function renderTable(data){
  const search=document.getElementById("search").value.toLowerCase();
  const tbody=document.querySelector("#idTable tbody");
  tbody.innerHTML="";
  data.filter(r=>r.id.toLowerCase().includes(search)||r.added_by.toLowerCase().includes(search)).forEach(r=>{
    const tr=document.createElement("tr");
    tr.innerHTML=\`
      <td><input type="checkbox" class="row-check" data-id="\${r.id}"></td>
      <td>\${r.id}</td>
      <td>\${r.added_by}</td>
      <td>\${new Date(r.created_at).toLocaleString()}</td>
      <td><textarea rows="1" class="note" data-id="\${r.id}">\${r.note||""}</textarea></td>
      <td><button class="save" data-id="\${r.id}" style="background:#2ecc71;">💾</button>
      <button class="delete" data-id="\${r.id}" style="background:#e74c3c;">✖</button></td>
    \`;
    tbody.appendChild(tr);
  });
}
renderTable(allData);

// ======================================================
// 🔍 Поиск
// ======================================================
document.getElementById("search").addEventListener("input",()=>renderTable(allData));

// ======================================================
// 💾 Сохранение заметки
// ======================================================
document.addEventListener("click",async e=>{
  if(e.target.classList.contains("save")){
    const id=e.target.dataset.id;
    const note=document.querySelector(".note[data-id='"+id+"']").value;
    await fetch("/api/note/"+id,{method:"PUT",headers:{"Content-Type":"application/json"},body:JSON.stringify({note})});
    e.target.textContent="✅";
    setTimeout(()=>e.target.textContent="💾",1000);
  }

// ======================================================
// 🗑 Удаление одной записи
// ======================================================
  if(e.target.classList.contains("delete")){
    const id=e.target.dataset.id;
    const key=document.getElementById("masterKey").value;
    if(!key)return alert("Введите мастер-ключ");
    if(confirm("Удалить "+id+"?")){
      await fetch("/api/delete/"+id,{method:"DELETE",headers:{"x-master-key":key}});
      location.reload();
    }
  }
});

// ======================================================
// 🔘 Массовое удаление
// ======================================================
document.getElementById("selectAll").addEventListener("change",e=>{
  document.querySelectorAll(".row-check").forEach(ch=>ch.checked=e.target.checked);
});

document.getElementById("deleteSelected").addEventListener("click",async()=>{
  const ids=Array.from(document.querySelectorAll(".row-check:checked")).map(ch=>ch.dataset.id);
  if(!ids.length)return alert("Ничего не выбрано!");
  const key=document.getElementById("masterKey").value;
  if(!key)return alert("Введите мастер-ключ");
  if(!confirm("Удалить "+ids.length+" записей?"))return;
  await fetch("/api/delete-bulk",{method:"POST",headers:{"Content-Type":"application/json","x-master-key":key},body:JSON.stringify({ids})});
  location.reload();
});

// ======================================================
// ➕ Добавление вручную
// ======================================================
document.getElementById("addManually").addEventListener("click",async()=>{
  const key=document.getElementById("masterKey").value;
  if(!key)return alert("Введите мастер-ключ");
  const id=prompt("Введите новый ID:");
  const user=prompt("Кто добавляет?");
  if(!id||!user)return;
  await fetch("/api/add-manual",{method:"POST",headers:{"Content-Type":"application/json","x-master-key":key},body:JSON.stringify({id,added_by:user})});
  location.reload();
});

// ======================================================
// 📤 Экспорт
// ======================================================
document.getElementById("exportCSV").addEventListener("click",()=>window.location="/api/export/csv");
document.getElementById("exportXLSX").addEventListener("click",()=>window.location="/api/export/xlsx");

// ======================================================
// 📥 Импорт
// ======================================================
document.getElementById("importFile").addEventListener("change",async e=>{
  const file=e.target.files[0];
  const key=document.getElementById("masterKey").value;
  if(!key)return alert("Введите мастер-ключ");
  if(!file)return;
  const formData=new FormData();
  formData.append("file",file);
  await fetch("/api/import",{method:"POST",headers:{"x-master-key":key},body:formData});
  location.reload();
});
</script>
</body>
</html>
`);
});

// ======================================================
// 🧾 Проверка мастер-ключа
// ======================================================
function checkMasterKey(req, res) {
  const key = req.headers["x-master-key"];
  if (key !== MASTER_KEY) {
    res.status(403).json({ error: "Неверный мастер-ключ" });
    return false;
  }
  return true;
}

// ======================================================
// 🧩 API endpoints
// ======================================================

// ➕ Добавление вручную
app.post("/api/add-manual", async (req, res) => {
  if (!checkMasterKey(req, res)) return;
  try {
    const { id, added_by } = req.body;
    await pool.query(
      `INSERT INTO ids (id, added_by) VALUES ($1,$2) ON CONFLICT(id) DO NOTHING`,
      [id, added_by]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка добавления вручную" });
  }
});

// 📝 Обновление заметки
app.put("/api/note/:id", async (req, res) => {
  try {
    await pool.query("UPDATE ids SET note=$1 WHERE id=$2", [req.body.note, req.params.id]);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Ошибка обновления заметки" });
  }
});

// ❌ Удаление одной записи
app.delete("/api/delete/:id", async (req, res) => {
  if (!checkMasterKey(req, res)) return;
  await pool.query("DELETE FROM ids WHERE id=$1", [req.params.id]);
  res.json({ success: true });
});

// ❌ Массовое удаление
app.post("/api/delete-bulk", async (req, res) => {
  if (!checkMasterKey(req, res)) return;
  const { ids } = req.body;
  if (!Array.isArray(ids)) return res.status(400).json({ error: "Неверные данные" });
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
  await pool.query(`DELETE FROM ids WHERE id IN (${placeholders})`, ids);
  res.json({ success: true });
});

// ======================================================
// 📤 Экспорт данных (CSV, XLSX)
// ======================================================
app.get("/api/export/csv", async (req, res) => {
  const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  const csv = stringify(result.rows, { header: true });
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=\"ids.csv\"");
  res.send(csv);
});

app.get("/api/export/xlsx", async (req, res) => {
  const result = await pool.query("SELECT * FROM ids ORDER BY created_at DESC");
  const ws = XLSX.utils.json_to_sheet(result.rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "IDs");
  const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  res.setHeader("Content-Disposition", "attachment; filename=\"ids.xlsx\"");
  res.type("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.send(buffer);
});

// ======================================================
// 📥 Импорт данных
// ======================================================
app.post("/api/import", upload.single("file"), async (req, res) => {
  if (!checkMasterKey(req, res)) return;
  try {
    const filePath = req.file.path;
    const wb = XLSX.readFile(filePath);
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    for (const r of rows) {
      if (r.id)
        await pool.query(
          `INSERT INTO ids (id, added_by, note) VALUES ($1,$2,$3)
           ON CONFLICT(id) DO UPDATE SET note=EXCLUDED.note`,
          [r.id, r.added_by || "import", r.note || ""]
        );
    }
    fs.unlinkSync(filePath);
    res.json({ success: true, count: rows.length });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Ошибка импорта" });
  }
});

// ======================================================
// 🚀 Запуск сервера
// ======================================================
app.listen(PORT, () => console.log("🚀 Сервер запущен на порту " + PORT));

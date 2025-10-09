// server.js
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

// === КЛЮЧИ И КОНФИГ ===
const MASTER_KEY = process.env.MASTER_KEY || "default-master";

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
}

// === БАЗА ДАННЫХ ===
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// Инициализация таблицы
await pool.query(`
  CREATE TABLE IF NOT EXISTS ids (
    id TEXT PRIMARY KEY,
    added_by TEXT,
    note TEXT DEFAULT '',
    created_at TIMESTAMP DEFAULT NOW()
  );
`);
console.log("✅ Таблица готова");

// === ВСПОМОГАТЕЛЬНЫЕ ===
const findUserByKey = (key) => {
  const found = keys.find((x) => x.key === key);
  return found ? found.user : key;
};

// ========================
// ГЛАВНАЯ СТРАНИЦА (HTML + JS)
// ========================
app.get("/", async (req, res) => {
  res.send(`<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<title>ID Manager</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial; background:#f8fafc; padding:18px; color:#111; }
  h2 { margin: 6px 0 12px 0; }
  #topbar { margin-bottom:12px; background:#fff; padding:10px; border-radius:8px; box-shadow:0 1px 3px rgba(0,0,0,0.06); display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
  input[type="text"], input[type="password"], select { padding:6px; border:1px solid #ddd; border-radius:6px; }
  button { margin:2px; padding:6px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#fff; cursor:pointer; }
  button:hover { background:#f1f5f9; }
  table { width:100%; border-collapse:collapse; background:white; box-shadow:0 1px 3px rgba(0,0,0,0.06); border-radius:8px; overflow:hidden; }
  th, td { padding:8px 10px; border-bottom:1px solid #eef2f7; font-size:13px; }
  th { background:#eef9ff; text-align:left; }
  tr:hover { background:#fbfdff; }
  textarea { width:100%; min-height:36px; border-radius:6px; border:1px solid #eee; padding:6px; font-size:13px; }
  #pagination { margin-top:10px; display:flex; gap:8px; align-items:center; justify-content:center; }
  #masterKeyBox { position:fixed; right:12px; top:12px; background:#fff; border:1px solid #eee; border-radius:8px; padding:6px 8px; box-shadow:0 1px 4px rgba(0,0,0,0.06); font-size:12px; color:#444; z-index:999; }
  #masterKeyBox input { width:140px; }
  #statusSmall { margin-left:6px; font-size:12px; color:#666; }
  @media (max-width:720px) { #masterKeyBox { position:static; margin-bottom:8px; } #topbar { flex-direction:column; align-items:stretch; } }
</style>
</head>
<body>
  <div id="masterKeyBox">
    🔑 <input id="masterKeyInput" type="password" placeholder="Мастер-ключ">
    <span id="statusSmall"> </span>
  </div>

  <h2>🧩 ID Manager</h2>

  <div id="topbar">
    <input id="filter" type="text" placeholder="Фильтр по ID или пользователю">
    <label>По стр.: <select id="perPageSelect"><option>25</option><option selected>50</option><option>100</option><option>200</option></select></label>
    <input id="newId" type="text" placeholder="Добавить ID вручную">
    <button id="btnAddManual">➕ Добавить</button>
    <button id="btnRefresh">🔄 Обновить</button>
    <button id="btnDelete">🗑️ Удалить выбранные</button>
    <button id="btnExport">📤 Экспорт</button>
    <button id="btnImportFile">📥 Импорт</button>
    <input id="importFile" type="file" accept=".json" style="display:none">
    <button id="btnClear" style="background:#fff6f6;border-color:#f5c6c6">🔥 Очистить базу</button>
  </div>

  <table id="idTable">
    <thead>
      <tr>
        <th><input id="selectAll" type="checkbox"></th>
        <th>ID</th>
        <th>Добавил</th>
        <th>Когда</th>
        <th>Заметка</th>
      </tr>
    </thead>
    <tbody></tbody>
  </table>

  <div id="pagination">
    <button id="firstPage">« First</button>
    <button id="prevPage">‹ Prev</button>
    <span id="pageInfo">Стр. 1 / 1</span>
    <button id="nextPage">Next ›</button>
    <button id="lastPage">Last »</button>
    <label style="margin-left:12px">Перейти: <input id="gotoPage" type="number" min="1" style="width:60px"></label>
  </div>

<script>
(async function(){
  // состояние
  let selected = new Set();
  let currentPage = 1;
  let perPage = parseInt(document.getElementById('perPageSelect').value,10);
  let total = 0;
  let filter = '';
  let masterKey = localStorage.getItem('master_key') || '';
  document.getElementById('masterKeyInput').value = masterKey;
  updateStatus();

  // элементы
  const tbody = document.querySelector('#idTable tbody');
  const pageInfo = document.getElementById('pageInfo');

  // сохранить ключ при вводе
  document.getElementById('masterKeyInput').addEventListener('change', e => {
    masterKey = e.target.value.trim();
    localStorage.setItem('master_key', masterKey);
    updateStatus();
  });
  function updateStatus(){
    const s = document.getElementById('statusSmall');
    if (masterKey) s.textContent = '🟢 ключ сохранён'; else s.textContent = '🔒 нет ключа';
  }

  // обработчики UI
  document.getElementById('perPageSelect').addEventListener('change', () => {
    perPage = parseInt(document.getElementById('perPageSelect').value,10);
    currentPage = 1;
    loadAndRender();
  });

  document.getElementById('filter').addEventListener('input', (e) => {
    filter = e.target.value || '';
    currentPage = 1;
    loadAndRender();
  });

  document.getElementById('btnRefresh').addEventListener('click', () => loadAndRender());
  document.getElementById('btnAddManual').addEventListener('click', addManual);
  document.getElementById('btnExport').addEventListener('click', exportData);
  document.getElementById('btnDelete').addEventListener('click', deleteSelected);
  document.getElementById('btnImportFile').addEventListener('click', () => document.getElementById('importFile').click());
  document.getElementById('importFile').addEventListener('change', importFile);
  document.getElementById('btnClear').addEventListener('click', clearAll);

  document.getElementById('firstPage').addEventListener('click', () => { currentPage = 1; loadAndRender(); });
  document.getElementById('prevPage').addEventListener('click', () => { if (currentPage>1){ currentPage--; loadAndRender(); } });
  document.getElementById('nextPage').addEventListener('click', () => { const last = Math.max(1, Math.ceil(total / perPage)); if (currentPage < last){ currentPage++; loadAndRender(); } });
  document.getElementById('lastPage').addEventListener('click', () => { currentPage = Math.max(1, Math.ceil(total / perPage)); loadAndRender(); });
  document.getElementById('gotoPage').addEventListener('change', (e) => {
    const v = parseInt(e.target.value,10);
    const last = Math.max(1, Math.ceil(total / perPage));
    if (!isNaN(v) && v>=1 && v<=last) { currentPage = v; loadAndRender(); }
  });

  document.getElementById('selectAll').addEventListener('change', (e) => {
    const check = e.target.checked;
    // отмечаем/снимаем только на текущей странице
    document.querySelectorAll('.chk').forEach(chk => {
      chk.checked = check;
      const id = chk.dataset.id;
      if (check) selected.add(id); else selected.delete(id);
    });
  });

  // загрузка и рендер
  async function loadAndRender(){
    try {
      const url = '/api/list-full?page=' + currentPage + '&perPage=' + perPage + '&filter=' + encodeURIComponent(filter || '');
      const r = await fetch(url);
      const j = await r.json();
      const items = j.items || [];
      total = j.total || 0;
      renderRows(items);
      updatePagination();
      // сохранить в gotoField допустимый предел
      document.getElementById('gotoPage').max = Math.max(1, Math.ceil(total / perPage));
    } catch (err) {
      console.error('Ошибка загрузки', err);
      alert('Ошибка загрузки списка');
    }
  }

  function renderRows(items){
    tbody.innerHTML = '';
    items.forEach(x => {
      const tr = document.createElement('tr');
      const checked = selected.has(x.id) ? 'checked' : '';
      tr.innerHTML =
        '<td><input class="chk" data-id="' + escapeHtml(x.id) + '" type="checkbox" ' + checked + '></td>' +
        '<td>' + escapeHtml(x.id) + '</td>' +
        '<td>' + escapeHtml(x.added_by || '') + '</td>' +
        '<td>' + new Date(x.created_at).toLocaleString() + '</td>' +
        '<td><textarea data-id="' + escapeHtml(x.id) + '">' + escapeHtml(x.note || '') + '</textarea></td>';
      tbody.appendChild(tr);
    });

    // события
    document.querySelectorAll('.chk').forEach(c => {
      c.addEventListener('change', (e) => {
        const id = e.target.dataset.id;
        if (e.target.checked) selected.add(id); else selected.delete(id);
        // обновляем checkbox "selectAll" исходя из видимой страницы
        const allVisible = Array.from(document.querySelectorAll('.chk')).every(chk => chk.checked);
        document.getElementById('selectAll').checked = allVisible;
      });
    });

    document.querySelectorAll('textarea').forEach(a => {
      a.addEventListener('change', async (e) => {
        const id = e.target.dataset.id;
        const note = e.target.value;
        try {
          const resp = await fetch('/api/note', {
            method: 'POST',
            headers: {'Content-Type':'application/json'},
            body: JSON.stringify({ id, note, masterKey })
          });
          if (!resp.ok) {
            const j = await resp.json().catch(()=>({}));
            alert('Ошибка сохранения заметки: ' + (j.error || resp.statusText));
          }
        } catch (err) {
          console.error(err);
          alert('Ошибка сохранения заметки');
        }
      });
    });
  }

  function updatePagination(){
    const last = Math.max(1, Math.ceil(total / perPage));
    pageInfo.textContent = 'Стр. ' + currentPage + ' / ' + last + ' (всего ' + total + ')';
    document.getElementById('gotoPage').value = currentPage;
  }

  // операции
  async function addManual(){
    const id = document.getElementById('newId').value.trim();
    if (!id) return alert('Введите ID');
    try {
      const r = await fetch('/api/add-manual', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ id, masterKey })
      });
      const j = await r.json();
      if (r.ok) {
        alert('✅ ID добавлен');
        document.getElementById('newId').value = '';
        loadAndRender();
      } else {
        alert('Ошибка добавления: ' + (j.error || 'неизвестная ошибка'));
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка при добавлении ID');
    }
  }

  async function deleteSelected(){
    if (selected.size === 0) return alert('Нечего удалять');
    if (!confirm('Удалить ' + selected.size + ' записей?')) return;
    try {
      const r = await fetch('/api/delete-multiple', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ ids: Array.from(selected), masterKey })
      });
      const j = await r.json();
      if (r.ok) {
        alert('✅ Удалено');
        selected.clear();
        loadAndRender();
      } else {
        alert('Ошибка удаления: ' + (j.error || 'неизвестно'));
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка удаления');
    }
  }

  async function exportData(){
    try {
      const r = await fetch('/api/export');
      const blob = await r.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ids_export.json';
      a.click();
    } catch (err) {
      console.error(err);
      alert('Ошибка экспорта');
    }
  }

  async function importFile(e){
    const file = e.target.files[0];
    if (!file) return;
    if (!masterKey) { alert('Введите мастер-ключ в правом верхнем углу'); return; }
    const fd = new FormData();
    fd.append('file', file);
    fd.append('masterKey', masterKey);
    try {
      const r = await fetch('/api/import', { method:'POST', body: fd });
      const j = await r.json();
      if (r.ok) {
        alert('Импортировано: ' + (j.count || j.imported || 0) + ' записей');
        loadAndRender();
      } else {
        alert('Ошибка импорта: ' + (j.error || 'неизвестно'));
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка при импорте');
    } finally {
      document.getElementById('importFile').value = '';
    }
  }

  async function clearAll(){
    if (!masterKey) { alert('Введите мастер-ключ'); return; }
    if (!confirm('Удалить ВСЕ записи?')) return;
    try {
      const r = await fetch('/api/clear-all', {
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body: JSON.stringify({ masterKey })
      });
      if (r.ok) {
        alert('База очищена');
        selected.clear();
        loadAndRender();
      } else {
        const j = await r.json().catch(()=>({}));
        alert('Ошибка: ' + (j.error || r.statusText));
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка очистки');
    }
  }

  // утилиты
  function escapeHtml(s){ return (s===null||s===undefined) ? '' : String(s).replace(/[&<>"'`]/g, function(c){ return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;',"`":'&#96;'})[c]; }); }

  // старт
  loadAndRender();
  // авто-обновление (можно увеличить интервал при необходимости)
  setInterval(loadAndRender, 4000);
})();
</script>
</body>
</html>`);
});

// ========================
// API: list (с пагинацией), add-manual и прочие
// ========================

// Пагинированный список: GET /api/list-full?page=1&perPage=50&filter=...
app.get("/api/list-full", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page || "1", 10));
    const perPage = Math.max(1, parseInt(req.query.perPage || "50", 10));
    const filter = (req.query.filter || "").trim();

    if (filter) {
      const like = '%' + filter + '%';
      const countQ = await pool.query(
        'SELECT COUNT(*) AS cnt FROM ids WHERE id ILIKE $1 OR added_by ILIKE $1',
        [like]
      );
      const total = parseInt(countQ.rows[0].cnt, 10);
      const offset = (page - 1) * perPage;
      const dataQ = await pool.query(
        'SELECT * FROM ids WHERE id ILIKE $1 OR added_by ILIKE $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
        [like, perPage, offset]
      );
      return res.json({ items: dataQ.rows, total });
    } else {
      const countQ = await pool.query('SELECT COUNT(*) AS cnt FROM ids');
      const total = parseInt(countQ.rows[0].cnt, 10);
      const offset = (page - 1) * perPage;
      const dataQ = await pool.query('SELECT * FROM ids ORDER BY created_at DESC LIMIT $1 OFFSET $2', [perPage, offset]);
      return res.json({ items: dataQ.rows, total });
    }
  } catch (err) {
    console.error('Ошибка /api/list-full', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Добавление вручную
app.post("/api/add-manual", async (req, res) => {
  try {
    const { id, masterKey } = req.body;
    if (!id) return res.status(400).json({ error: 'Нет ID' });
    const user = (masterKey === MASTER_KEY) ? 'Manual (Admin)' : 'Manual (Guest)';
    await pool.query('INSERT INTO ids (id, added_by) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [id, user]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка /api/add-manual', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Добавление через API-ключ (расширение)
app.post("/api/add-id", async (req, res) => {
  try {
    const { id, apiKey } = req.body;
    if (!id || !apiKey) return res.status(400).json({ error: 'Неверные данные' });
    const user = findUserByKey(apiKey);
    await pool.query('INSERT INTO ids (id, added_by) VALUES ($1,$2) ON CONFLICT (id) DO NOTHING', [id, user]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка /api/add-id', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновление заметки (только с мастер-ключом)
app.post("/api/note", async (req, res) => {
  try {
    const { id, note, masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('UPDATE ids SET note=$1 WHERE id=$2', [note, id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка /api/note', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Удаление нескольких (только с мастер-ключом)
app.post("/api/delete-multiple", async (req, res) => {
  try {
    const { ids, masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM ids WHERE id = ANY($1::text[])', [ids]);
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка /api/delete-multiple', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Экспорт
app.get("/api/export", async (req, res) => {
  try {
    const q = await pool.query('SELECT * FROM ids ORDER BY created_at DESC');
    res.setHeader('Content-Disposition', 'attachment; filename=ids_export.json');
    res.json({ items: q.rows });
  } catch (err) {
    console.error('Ошибка /api/export', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Импорт (поддерживает {items:[...]} и [...])
app.post("/api/import", upload.single("file"), async (req, res) => {
  try {
    const { masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: 'Нет доступа' });
    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
    let json;
    try { json = JSON.parse(req.file.buffer.toString('utf8')); }
    catch (e) { return res.status(400).json({ error: 'Ошибка парсинга JSON' }); }
    const items = Array.isArray(json) ? json : (Array.isArray(json.items) ? json.items : null);
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Неверный формат файла' });
    let count = 0;
    for (const row of items) {
      if (!row.id) continue;
      await pool.query('INSERT INTO ids (id, added_by, note, created_at) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING',
        [row.id, row.added_by || 'Импорт', row.note || '', row.created_at || new Date()]);
      count++;
    }
    res.json({ success: true, count });
  } catch (err) {
    console.error('Ошибка /api/import', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Очистка (только мастер-ключ)
app.post("/api/clear-all", async (req, res) => {
  try {
    const { masterKey } = req.body;
    if (masterKey !== MASTER_KEY) return res.status(403).json({ error: 'Нет доступа' });
    await pool.query('DELETE FROM ids');
    res.json({ success: true });
  } catch (err) {
    console.error('Ошибка /api/clear-all', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Запуск
app.listen(process.env.PORT || 10000, () => console.log('🚀 Сервер запущен'));

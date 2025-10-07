import express from "express";
import cors from "cors";
import { readFile, writeFile } from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const IDS_FILE = path.join(__dirname, "ids.json");

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors()); // разрешаем кросс-доменные запросы
app.use(express.json());

// Сервим статические файлы (веб-панель)
app.use(express.static(path.join(__dirname, "public")));

// --- Вспомогательные функции ---
async function readIDs() {
  try {
    const raw = await readFile(IDS_FILE, { encoding: "utf8" });
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.ids)) return parsed.ids;
    return [];
  } catch (err) {
    // если файл не найден или что-то не так — возвращаем пустой массив
    return [];
  }
}

async function saveIDs(ids) {
  // приводим к уникальному массиву
  const unique = Array.from(new Set(ids));
  await writeFile(IDS_FILE, JSON.stringify({ ids: unique }, null, 2), { encoding: "utf8" });
}

// Если задан API_KEY в окружении, проверяем его для модифицирующих запросов
function requireApiKey(req, res, next) {
  const configured = process.env.API_KEY;
  if (!configured) return next(); // если ключ не задан — разрешаем всем
  const provided = req.get("x-api-key") || req.query.key || (req.body && req.body.key);
  if (provided === configured) return next();
  return res.status(401).json({ error: "Unauthorized: invalid API key" });
}

// Небольшая функция валидации ID
function sanitizeIds(inputArray) {
  if (!Array.isArray(inputArray)) return [];
  return inputArray
    .map(x => String(x).trim())
    .map(x => x.replace(/\s+/g, "")) // убираем пробелы внутри
    .filter(x => x.length > 0 && x.length <= 200) // длина лимит
    .map(x => x); // можно добавить нормализацию если нужно
}

// Проверка одного ID
function sanitizeSingleId(id) {
  if (typeof id !== "string") return null;
  const s = id.trim().replace(/\s+/g, "");
  if (s.length === 0 || s.length > 200) return null;
  return s;
}

// --- API ---

// GET: получить список всех ID
app.get("/api/highlight-list", async (req, res) => {
  const ids = await readIDs();
  res.json({ ids });
});

// POST: добавить ID или массив ID
// Тело: { "id": "123" } или { "ids": ["123","456"] }
// Если установлен API_KEY, нужно прислать x-api-key заголовок либо ?key=...
app.post("/api/add-id", requireApiKey, async (req, res) => {
  try {
    const body = req.body || {};
    let newIds = [];

    if (body.id) {
      const single = sanitizeSingleId(body.id);
      if (single) newIds.push(single);
    }
    if (Array.isArray(body.ids)) {
      newIds = newIds.concat(sanitizeIds(body.ids));
    }

    if (newIds.length === 0) {
      return res.status(400).json({ error: "No valid id(s) provided" });
    }

    const current = await readIDs();
    const set = new Set(current);
    for (const id of newIds) set.add(id);

    const result = Array.from(set);
    await saveIDs(result);
    return res.json({ message: "Added", ids: result });
  } catch (err) {
    console.error("add-id error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

// POST: удалить ID
// Тело: { "id": "123" }
app.post("/api/remove-id", requireApiKey, async (req, res) => {
  try {
    const id = sanitizeSingleId(req.body && req.body.id);
    if (!id) return res.status(400).json({ error: "No valid id provided" });

    const current = await readIDs();
    const filtered = current.filter(x => x !== id);
    await saveIDs(filtered);
    return res.json({ message: "Removed", ids: filtered });
  } catch (err) {
    console.error("remove-id error:", err);
    return res.status(500).json({ error: "Internal error" });
  }
});

// Простая health-страница (опционально)
app.get("/api/health", (req, res) => res.json({ status: "ok", time: new Date().toISOString() }));

// Запуск
app.listen(PORT, () => {
  console.log(`✅ Server started on port ${PORT} (http://localhost:${PORT})`);
});

import express from "express";
import cors from "cors";
import fs from "fs";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static("public"));

const DATA_FILE = "./ids.json";
const KEYS_FILE = "./keys.json";
const MASTER_KEY = process.env.MASTER_KEY;

// === Универсальные функции чтения/записи ===
function readJSON(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// === Получить список ID ===
app.get("/api/highlight-list", (req, res) => {
  const data = readJSON(DATA_FILE, { entries: [] });
  const ids = data.entries.map(e => e.id);
  res.json({ ids, entries: data.entries });
});

// === Добавить ID ===
app.post("/api/add-id", (req, res) => {
  const { id, apiKey } = req.body;
  if (!id || !apiKey) return res.status(400).json({ error: "Нужно указать id и apiKey" });

  const keyData = readJSON(KEYS_FILE, { keys: [] });
  const match = keyData.keys.find(k => k.key === apiKey);
  if (!match) return res.status(403).json({ error: "Неверный API ключ" });

  const data = readJSON(DATA_FILE, { entries: [] });
  if (data.entries.some(e => e.id === id)) return res.status(409).json({ message: "Такой ID уже есть" });

  const entry = { id, user: match.user, addedAt: new Date().toISOString() };
  data.entries.push(entry);
  writeJSON(DATA_FILE, data);

  console.log(`✅ ${match.user} добавил ID: ${id}`);
  res.json({ message: "ID добавлен", entry });
});


// === 🛡️ Админ-эндпоинты ===

// Проверка ключа
function isAdmin(req) {
  return req.headers["x-admin-key"] === MASTER_KEY;
}

// Получить все ключи
app.get("/api/keys", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Нет доступа" });
  const keys = readJSON(KEYS_FILE, { keys: [] });
  res.json(keys);
});

// Добавить ключ
app.post("/api/keys", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Нет доступа" });

  const { key, user } = req.body;
  if (!key || !user) return res.status(400).json({ error: "Нужно указать key и user" });

  const data = readJSON(KEYS_FILE, { keys: [] });
  if (data.keys.some(k => k.key === key))
    return res.status(409).json({ error: "Такой ключ уже существует" });

  data.keys.push({ key, user });
  writeJSON(KEYS_FILE, data);
  res.json({ message: "Ключ добавлен", key, user });
});

// Удалить ключ
app.delete("/api/keys/:key", (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: "Нет доступа" });

  const keyToDelete = req.params.key;
  let data = readJSON(KEYS_FILE, { keys: [] });
  const before = data.keys.length;
  data.keys = data.keys.filter(k => k.key !== keyToDelete);
  writeJSON(KEYS_FILE, data);

  res.json({
    message: before === data.keys.length ? "Ключ не найден" : "Ключ удалён",
  });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
});

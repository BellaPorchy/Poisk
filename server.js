import express from "express";
import cors from "cors";
import fs from "fs";

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

const DATA_FILE = "./ids.json";

// --- Чтение данных ---
function readData() {
  try {
    const text = fs.readFileSync(DATA_FILE, "utf-8");
    return JSON.parse(text);
  } catch {
    return { entries: [] };
  }
}

// --- Сохранение данных ---
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// === Получить список ID ===
app.get("/api/highlight-list", (req, res) => {
  const data = readData();
  const ids = data.entries.map(e => e.id);
  res.json({ ids, entries: data.entries });
});

// === Добавить ID ===
app.post("/api/add-id", (req, res) => {
  const { id, user } = req.body;

  if (!id) {
    return res.status(400).json({ error: "Поле 'id' обязательно" });
  }

  const data = readData();

  // Проверка на дубликат
  if (data.entries.some(e => e.id === id)) {
    return res.status(409).json({ message: "Такой ID уже есть" });
  }

  const entry = {
    id,
    user: user || "Anonymous",
    addedAt: new Date().toISOString()
  };

  data.entries.push(entry);
  saveData(data);

  res.json({ message: "ID добавлен", entry });
});

app.listen(PORT, () => {
  console.log(`✅ Сервер запущен на http://localhost:${PORT}`);
});

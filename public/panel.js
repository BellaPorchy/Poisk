// Простейшая логика для панели управления
document.addEventListener("DOMContentLoaded", () => {
  const apiKeyInput = document.getElementById("apiKey");
  const inputId = document.getElementById("inputId");
  const btnAdd = document.getElementById("btnAdd");
  const inputMany = document.getElementById("inputMany");
  const btnAddMany = document.getElementById("btnAddMany");
  const listArea = document.getElementById("listArea");

  // сохраняем/подгружаем ключ в localStorage (удобство)
  apiKeyInput.value = localStorage.getItem("id_highlight_api_key") || "";
  apiKeyInput.addEventListener("change", () => {
    localStorage.setItem("id_highlight_api_key", apiKeyInput.value.trim());
  });

  async function getHeaders() {
    const headers = { "Content-Type": "application/json" };
    const key = apiKeyInput.value.trim();
    if (key) headers["x-api-key"] = key;
    return headers;
  }

  async function fetchList() {
    listArea.textContent = "Загрузка...";
    try {
      const r = await fetch("/api/highlight-list");
      const j = await r.json();
      renderList(j.ids || []);
    } catch (err) {
      console.error(err);
      listArea.textContent = "Ошибка при получении списка.";
    }
  }

  function renderList(ids) {
    if (!ids || ids.length === 0) {
      listArea.innerHTML = "<em>Пусто</em>";
      return;
    }
    const ul = document.createElement("ul");
    ids.forEach(id => {
      const li = document.createElement("li");
      li.textContent = id + " ";
      const btnRem = document.createElement("button");
      btnRem.textContent = "Удалить";
      btnRem.style.marginLeft = "8px";
      btnRem.addEventListener("click", () => removeId(id));
      li.appendChild(btnRem);
      ul.appendChild(li);
    });
    listArea.innerHTML = "";
    listArea.appendChild(ul);
  }

  async function addId(id) {
    if (!id) return alert("Введите ID");
    try {
      const headers = await getHeaders();
      const r = await fetch("/api/add-id", {
        method: "POST",
        headers,
        body: JSON.stringify({ id })
      });
      const j = await r.json();
      if (!r.ok) return alert("Ошибка: " + (j.error || j.message || JSON.stringify(j)));
      inputId.value = "";
      await fetchList();
    } catch (err) {
      console.error(err);
      alert("Ошибка при добавлении");
    }
  }

  async function addMany(idsCsv) {
    if (!idsCsv) return alert("Нечего добавлять");
    const arr = idsCsv.split(",").map(x => x.trim()).filter(Boolean);
    if (arr.length === 0) return alert("Нечего добавлять");
    try {
      const headers = await getHeaders();
      const r = await fetch("/api/add-id", {
        method: "POST",
        headers,
        body: JSON.stringify({ ids: arr })
      });
      const j = await r.json();
      if (!r.ok) return alert("Ошибка: " + (j.error || j.message || JSON.stringify(j)));
      inputMany.value = "";
      await fetchList();
    } catch (err) {
      console.error(err);
      alert("Ошибка при добавлении");
    }
  }

  async function removeId(id) {
    if (!confirm(`Удалить ID "${id}"?`)) return;
    try {
      const headers = await getHeaders();
      const r = await fetch("/api/remove-id", {
        method: "POST",
        headers,
        body: JSON.stringify({ id })
      });
      const j = await r.json();
      if (!r.ok) return alert("Ошибка: " + (j.error || j.message || JSON.stringify(j)));
      await fetchList();
    } catch (err) {
      console.error(err);
      alert("Ошибка при удалении");
    }
  }

  btnAdd.addEventListener("click", () => addId(inputId.value));
  btnAddMany.addEventListener("click", () => addMany(inputMany.value));

  // первичная загрузка
  fetchList();
});

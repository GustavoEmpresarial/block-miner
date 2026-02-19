const tableBody = document.getElementById("minersTable");
const statusMessage = document.getElementById("statusMessage");
const refreshButton = document.getElementById("refreshButton");
const createForm = document.getElementById("createForm");

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function setStatus(text, type = "") {
  statusMessage.textContent = text;
  statusMessage.className = `status ${type}`.trim();
}

function formatNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "";
  return num.toFixed(digits);
}

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json"
    },
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }

  return data;
}

function renderTable(miners) {
  tableBody.innerHTML = "";

  miners.forEach((miner) => {
    const row = document.createElement("tr");
    row.dataset.id = String(miner.id);

    row.innerHTML = `
      <td>${miner.id}</td>
      <td><input type="text" name="name" value="${escapeHtml(miner.name || "")}" /></td>
      <td><input type="text" name="slug" value="${escapeHtml(miner.slug || "")}" /></td>
      <td><input type="number" step="0.01" name="baseHashRate" value="${formatNumber(miner.base_hash_rate, 2)}" /></td>
      <td><input type="number" step="0.0001" name="price" value="${formatNumber(miner.price, 4)}" /></td>
      <td>
        <select name="slotSize">
          <option value="1" ${Number(miner.slot_size) === 1 ? "selected" : ""}>1</option>
          <option value="2" ${Number(miner.slot_size) === 2 ? "selected" : ""}>2</option>
        </select>
      </td>
      <td><input type="text" name="imageUrl" value="${escapeHtml(miner.image_url || "")}" /></td>
      <td><input type="checkbox" name="isActive" ${Number(miner.is_active) === 1 ? "checked" : ""} /></td>
      <td><button class="btn small" type="button">Save</button></td>
    `;

    row.querySelector("button")?.addEventListener("click", () => saveRow(row));
    tableBody.appendChild(row);
  });
}

async function loadMiners() {
  setStatus("Loading miners...");
  try {
    const data = await request("/api/admin/miners");
    renderTable(data.miners || []);
    setStatus(`Loaded ${data.miners?.length || 0} miners.`, "success");
  } catch (error) {
    setStatus(error.message || "Failed to load miners.", "error");
  }
}

function getRowPayload(row) {
  const getValue = (name) => row.querySelector(`[name="${name}"]`)?.value ?? "";
  const getChecked = (name) => row.querySelector(`[name="${name}"]`)?.checked ?? false;

  return {
    name: getValue("name").trim(),
    slug: getValue("slug").trim(),
    baseHashRate: Number(getValue("baseHashRate")),
    price: Number(getValue("price")),
    slotSize: Number(getValue("slotSize")),
    imageUrl: getValue("imageUrl").trim() || null,
    isActive: getChecked("isActive")
  };
}

async function saveRow(row) {
  const minerId = row.dataset.id;
  if (!minerId) return;

  try {
    setStatus("Saving...", "info");
    const payload = getRowPayload(row);
    await request(`/api/admin/miners/${minerId}`, {
      method: "PUT",
      body: JSON.stringify(payload)
    });
    setStatus("Miner updated.", "success");
  } catch (error) {
    setStatus(error.message || "Failed to update miner.", "error");
  }
}

createForm?.addEventListener("submit", async (event) => {
  event.preventDefault();
  try {
    setStatus("Creating...", "info");
    const formData = new FormData(createForm);
    const payload = {
      name: String(formData.get("name") || "").trim(),
      slug: String(formData.get("slug") || "").trim(),
      baseHashRate: Number(formData.get("baseHashRate")),
      price: Number(formData.get("price")),
      slotSize: Number(formData.get("slotSize")),
      imageUrl: String(formData.get("imageUrl") || "").trim() || null,
      isActive: Boolean(formData.get("isActive"))
    };

    await request("/api/admin/miners", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    createForm.reset();
    createForm.querySelector("[name='isActive']").checked = true;
    await loadMiners();
    setStatus("Miner created.", "success");
  } catch (error) {
    setStatus(error.message || "Failed to create miner.", "error");
  }
});

refreshButton?.addEventListener("click", () => loadMiners());

loadMiners();

const table = document.getElementById("minersTable");
const statusEl = document.getElementById("status");
const searchInput = document.getElementById("searchInput");
const pageInfo = document.getElementById("pageInfo");

let allMiners = [];
let currentPage = 1;
const pageSize = 20;
const DEFAULT_MINER_IMAGE_URL = "/assets/machines/reward1.png";

function setStatus(text, type = "") { statusEl.textContent = text; statusEl.className = `status ${type}`.trim(); }
function esc(v) { return String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }

function updateImagePreview(imgEl, emptyEl, imageUrl) {
  if (!imgEl || !emptyEl) return;
  const normalizedUrl = String(imageUrl || "").trim();

  if (!normalizedUrl) {
    imgEl.style.display = "none";
    imgEl.removeAttribute("src");
    emptyEl.style.display = "inline";
    return;
  }

  imgEl.style.display = "block";
  emptyEl.style.display = "none";
  imgEl.onerror = () => {
    if (imgEl.dataset.fallbackApplied === "1") {
      imgEl.style.display = "none";
      emptyEl.style.display = "inline";
      return;
    }

    imgEl.dataset.fallbackApplied = "1";
    imgEl.src = DEFAULT_MINER_IMAGE_URL;
  };
  imgEl.dataset.fallbackApplied = "0";
  imgEl.src = normalizedUrl;
}

function getCookie(name) {
  const parts = (document.cookie || "").split(";").map((p) => p.trim());
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i === -1) continue;
    if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

async function request(url, options = {}) {
  const method = options?.method || "GET";
  const adminToken = localStorage.getItem("adminToken");
  const csrf = getCookie("blockminer_csrf");
  const headers = {
    "Content-Type": "application/json",
    ...(method !== "GET" && method !== "HEAD" && method !== "OPTIONS" && csrf ? { "X-CSRF-Token": csrf } : {}),
    ...(adminToken ? { Authorization: `Bearer ${adminToken}` } : {})
  };
  const response = await fetch(url, { headers, credentials: "include", ...options });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminTokenExpiry");
    window.location.href = "/admin/login";
    return null;
  }
  if (!response.ok) throw new Error(data?.message || "Request failed");
  return data;
}

function payloadFromRow(row) {
  const getValue = (name) => row.querySelector(`[name="${name}"]`)?.value ?? "";
  const checked = (name) => row.querySelector(`[name="${name}"]`)?.checked ?? false;
  return {
    name: getValue("name").trim(),
    slug: getValue("slug").trim(),
    baseHashRate: Number(getValue("baseHashRate")),
    price: Number(getValue("price")),
    slotSize: Number(getValue("slotSize") || 1),
    imageUrl: getValue("imageUrl").trim() || null,
    isActive: checked("isActive"),
    showInShop: checked("showInShop")
  };
}

async function toggleMinerShopOnly(minerId, showInShop) {
  try {
    setStatus(showInShop ? "Adding miner to shop..." : "Removing miner from shop...", "info");
    const result = await request(`/api/admin/miners/${minerId}/shop`, {
      method: "PATCH",
      body: JSON.stringify({ showInShop })
    });

    await loadMiners();
    setStatus(result?.message || "Shop visibility updated.", "success");
  } catch (error) {
    setStatus(error.message || "Failed to update shop visibility.", "error");
  }
}

async function saveRow(row) {
  const id = row.dataset.id;
  if (!id) return;
  try {
    setStatus("Saving...", "info");
    await request(`/api/admin/miners/${id}`, { method: "PUT", body: JSON.stringify(payloadFromRow(row)) });
    setStatus(`Miner #${id} updated.`, "success");
  } catch (error) {
    setStatus(error.message || "Failed to save miner.", "error");
  }
}

function render(miners) {
  const query = String(searchInput?.value || "").trim().toLowerCase();
  const filtered = (miners || []).filter((item) => {
    if (!query) return true;
    const name = String(item.name || "").toLowerCase();
    const slug = String(item.slug || "").toLowerCase();
    return name.includes(query) || slug.includes(query);
  });

  const total = filtered.length;
  const pageMax = Math.max(1, Math.ceil(total / pageSize));
  if (currentPage > pageMax) currentPage = pageMax;
  const offset = (currentPage - 1) * pageSize;
  const pageItems = filtered.slice(offset, offset + pageSize);

  const imageUrlCount = new Map();
  for (const item of filtered) {
    const key = String(item?.image_url || "").trim();
    if (!key) continue;
    imageUrlCount.set(key, Number(imageUrlCount.get(key) || 0) + 1);
  }
  const duplicatedCount = Array.from(imageUrlCount.values()).filter((value) => value > 1).length;

  table.innerHTML = "";
  for (const m of pageItems) {
    const row = document.createElement("tr");
    row.dataset.id = String(m.id);
    const isInShop = Number(m.show_in_shop) === 1;
    row.innerHTML = `
      <td>${m.id}</td>
      <td><input type="text" name="name" value="${esc(m.name)}" /></td>
      <td><input type="text" name="slug" value="${esc(m.slug)}" /></td>
      <td><input type="number" step="0.01" name="baseHashRate" value="${Number(m.base_hash_rate || 0).toFixed(2)}" /></td>
      <td><input type="number" step="0.0001" name="price" value="${Number(m.price || 0).toFixed(4)}" /></td>
      <td>
        <div class="miner-image-preview-wrap">
          <img class="miner-image-preview" data-role="row-preview-img" alt="Miner preview" />
          <span class="miner-image-preview-empty" data-role="row-preview-empty">No image</span>
        </div>
        <input type="hidden" name="slotSize" value="${Number(m.slot_size || 1)}" />
      </td>
      <td><input type="text" name="imageUrl" value="${esc(m.image_url || "")}" placeholder="/assets/machines/..." /></td>
      <td><input type="checkbox" name="showInShop" ${Number(m.show_in_shop) === 1 ? "checked" : ""} /></td>
      <td><input type="checkbox" name="isActive" ${Number(m.is_active) === 1 ? "checked" : ""} /></td>
      <td>
        <button class="btn small ${isInShop ? "shop-remove" : "shop-add"}" type="button" data-action="toggle-shop">
          ${isInShop ? "Remove do Shop" : "Mostrar no Shop"}
        </button>
      </td>
      <td><button class="btn small" type="button" data-action="save-row">Save</button></td>
    `;

    const previewImg = row.querySelector('[data-role="row-preview-img"]');
    const previewEmpty = row.querySelector('[data-role="row-preview-empty"]');
    const imageUrlInput = row.querySelector('[name="imageUrl"]');
    const saveButton = row.querySelector('[data-action="save-row"]');
    const toggleButton = row.querySelector('[data-action="toggle-shop"]');

    const initialImageUrl = String(m.image_url || "").trim();
    updateImagePreview(previewImg, previewEmpty, initialImageUrl);
    if (initialImageUrl && Number(imageUrlCount.get(initialImageUrl) || 0) > 1) {
      imageUrlInput?.classList.add("duplicate-image-url");
      imageUrlInput?.setAttribute("title", "Duplicated image URL used by multiple miners");
    }

    imageUrlInput?.addEventListener("input", () => {
      updateImagePreview(previewImg, previewEmpty, imageUrlInput.value);
      imageUrlInput.classList.remove("duplicate-image-url");
      imageUrlInput.removeAttribute("title");
    });

    saveButton?.addEventListener("click", () => saveRow(row));
    toggleButton?.addEventListener("click", () => toggleMinerShopOnly(m.id, !isInShop));
    table.appendChild(row);
  }

  pageInfo.textContent = `Page ${currentPage}/${pageMax} · Total ${total}`;
  if (duplicatedCount > 0) {
    setStatus(`Warning: ${duplicatedCount} duplicated image URL(s) detected in this filter.`, "error");
  }
}

async function loadMiners() {
  setStatus("Loading...", "info");
  try {
    const data = await request("/api/admin/miners");
    allMiners = data?.miners || [];
    render(allMiners);
    setStatus(`Loaded ${data?.miners?.length || 0} miners.`, "success");
  } catch (error) {
    setStatus(error.message || "Failed to load miners.", "error");
  }
}

document.getElementById("refreshBtn")?.addEventListener("click", loadMiners);
document.getElementById("applyBtn")?.addEventListener("click", () => {
  currentPage = 1;
  render(allMiners);
});
document.getElementById("prevBtn")?.addEventListener("click", () => {
  if (currentPage <= 1) return;
  currentPage -= 1;
  render(allMiners);
});
document.getElementById("nextBtn")?.addEventListener("click", () => {
  const query = String(searchInput?.value || "").trim().toLowerCase();
  const filteredTotal = allMiners.filter((item) => {
    if (!query) return true;
    return String(item.name || "").toLowerCase().includes(query) || String(item.slug || "").toLowerCase().includes(query);
  }).length;
  const pageMax = Math.max(1, Math.ceil(filteredTotal / pageSize));
  if (currentPage >= pageMax) return;
  currentPage += 1;
  render(allMiners);
});
loadMiners();
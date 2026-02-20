const tableBody = document.getElementById("minersTable");
const statusMessage = document.getElementById("statusMessage");
const refreshButton = document.getElementById("refreshButton");
const createForm = document.getElementById("createForm");

const dashboardStatus = document.getElementById("dashboardStatus");
const statsGrid = document.getElementById("statsGrid");

const usersStatus = document.getElementById("usersStatus");
const usersTable = document.getElementById("usersTable");

const auditStatus = document.getElementById("auditStatus");
const auditTable = document.getElementById("auditTable");

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

function getCookie(name) {
  const cookieString = document.cookie || "";
  const parts = cookieString.split(";").map((part) => part.trim());
  for (const part of parts) {
    if (!part) continue;
    const eqIndex = part.indexOf("=");
    if (eqIndex === -1) continue;
    const key = part.slice(0, eqIndex);
    if (key !== name) continue;
    return decodeURIComponent(part.slice(eqIndex + 1));
  }
  return null;
}

function isUnsafeMethod(method) {
  const m = String(method || "GET").toUpperCase();
  return m !== "GET" && m !== "HEAD" && m !== "OPTIONS";
}

function setSmallStatus(el, text, type = "") {
  if (!el) return;
  el.textContent = text;
  el.className = `status ${type}`.trim();
}

function formatDate(ms) {
  if (!ms) return "--";
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString();
}

async function request(url, options = {}) {
  const method = options?.method || "GET";
  const csrf = getCookie("blockminer_csrf");

  const response = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      ...(isUnsafeMethod(method) && csrf ? { "X-CSRF-Token": csrf } : {})
    },
    credentials: "include",
    ...options
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }

  return data;
}

function renderStats(stats) {
  if (!statsGrid) return;
  statsGrid.innerHTML = "";
  const items = [
    ["Users", stats.usersTotal],
    ["New users (24h)", stats.usersNew24h],
    ["Banned users", stats.usersBanned],
    ["Miners", stats.minersTotal],
    ["Active miners", stats.minersActive],
    ["Inventory items", stats.inventoryTotal],
    ["Balance total", formatNumber(stats.balanceTotal, 6)],
    ["Lifetime mined", formatNumber(stats.lifetimeMinedTotal, 6)],
    ["Total withdrawn", formatNumber(stats.totalWithdrawn, 6)],
    ["Transactions (24h)", stats.transactions24h],
    ["Referrals", stats.referralsTotal],
    ["Audit events (24h)", stats.auditEvents24h],
    ["Lockouts (7d)", stats.lockouts7d]
  ];

  for (const [label, value] of items) {
    const card = document.createElement("div");
    card.className = "stat-card";
    card.innerHTML = `
      <div class="stat-label">${escapeHtml(label)}</div>
      <div class="stat-value">${escapeHtml(String(value ?? "--"))}</div>
    `;
    statsGrid.appendChild(card);
  }
}

function renderUsers(users) {
  if (!usersTable) return;
  usersTable.innerHTML = "";

  users.forEach((user) => {
    const row = document.createElement("tr");
    const isBanned = Number(user.is_banned) === 1;

    row.innerHTML = `
      <td>${escapeHtml(user.id)}</td>
      <td>${escapeHtml(user.email || "--")}</td>
      <td>${escapeHtml(user.username || user.name || "--")}</td>
      <td>${escapeHtml(formatDate(user.created_at))}</td>
      <td>${escapeHtml(formatDate(user.last_login_at))}</td>
      <td><span class="pill ${isBanned ? "bad" : "good"}">${isBanned ? "Yes" : "No"}</span></td>
      <td><button class="btn small" type="button">${isBanned ? "Unban" : "Ban"}</button></td>
    `;

    row.querySelector("button")?.addEventListener("click", async () => {
      try {
        setSmallStatus(usersStatus, "Updating user...", "info");
        await request(`/api/admin/users/${user.id}/ban`, {
          method: "PUT",
          body: JSON.stringify({ isBanned: !isBanned })
        });
        await loadUsers();
        setSmallStatus(usersStatus, "User updated.", "success");
      } catch (error) {
        setSmallStatus(usersStatus, error.message || "Failed to update user.", "error");
      }
    });

    usersTable.appendChild(row);
  });
}

function renderAudit(logs) {
  if (!auditTable) return;
  auditTable.innerHTML = "";

  logs.forEach((log) => {
    const row = document.createElement("tr");
    const userLabel = log.user_email ? log.user_email : log.user_id ? `User #${log.user_id}` : "--";
    row.innerHTML = `
      <td>${escapeHtml(formatDate(log.created_at))}</td>
      <td>${escapeHtml(userLabel)}</td>
      <td>${escapeHtml(log.action || "--")}</td>
      <td>${escapeHtml(log.ip || "--")}</td>
    `;
    auditTable.appendChild(row);
  });
}

async function loadStats() {
  setSmallStatus(dashboardStatus, "Loading...", "info");
  try {
    const data = await request("/api/admin/stats");
    renderStats(data.stats || {});
    setSmallStatus(dashboardStatus, "Ready", "success");
  } catch (error) {
    setSmallStatus(dashboardStatus, error.message || "Failed to load stats.", "error");
  }
}

async function loadUsers() {
  setSmallStatus(usersStatus, "Loading...", "info");
  try {
    const data = await request("/api/admin/users?limit=25");
    renderUsers(data.users || []);
    setSmallStatus(usersStatus, `Loaded ${data.users?.length || 0} users.`, "success");
  } catch (error) {
    setSmallStatus(usersStatus, error.message || "Failed to load users.", "error");
  }
}

async function loadAudit() {
  setSmallStatus(auditStatus, "Loading...", "info");
  try {
    const data = await request("/api/admin/audit?limit=60");
    renderAudit(data.logs || []);
    setSmallStatus(auditStatus, `Loaded ${data.logs?.length || 0} events.`, "success");
  } catch (error) {
    setSmallStatus(auditStatus, error.message || "Failed to load audit logs.", "error");
  }
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

refreshButton?.addEventListener("click", () => {
  loadStats();
  loadUsers();
  loadAudit();
  loadMiners();
});

loadStats();
loadUsers();
loadAudit();
loadMiners();

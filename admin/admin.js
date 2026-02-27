const tableBody = document.getElementById("minersTable");
const statusMessage = document.getElementById("statusMessage");
const refreshButton = document.getElementById("refreshButton");
const exportDbButton = document.getElementById("exportDbButton");
const exportStatus = document.getElementById("exportStatus");
const createForm = document.getElementById("createForm");

const dashboardStatus = document.getElementById("dashboardStatus");
const statsGrid = document.getElementById("statsGrid");

const usersStatus = document.getElementById("usersStatus");
const usersTable = document.getElementById("usersTable");

const auditStatus = document.getElementById("auditStatus");
const auditTable = document.getElementById("auditTable");

const withdrawalsStatus = document.getElementById("withdrawalsStatus");
const withdrawalsTable = document.getElementById("withdrawalsTable");
const createImageUrlInput = createForm?.querySelector('[name="imageUrl"]') || null;
const createImageFileInput = createForm?.querySelector('[name="imageFile"]') || null;

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

function formatCompactNumber(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0";
  return num.toFixed(digits);
}

function formatBytes(value) {
  const bytes = Number(value || 0);
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = bytes;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const digits = amount >= 100 ? 0 : amount >= 10 ? 1 : 2;
  return `${amount.toFixed(digits)} ${units[unitIndex]}`;
}

function formatPercent(value, digits = 2) {
  const num = Number(value);
  if (!Number.isFinite(num)) return "0.00%";
  return `${num.toFixed(digits)}%`;
}

function sanitizeMinerImageName(fileName) {
  const baseName = String(fileName || "miner-image")
    .replace(/\.[^.]+$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "miner-image";

  return baseName;
}

async function request(url, options = {}) {
  const method = options?.method || "GET";
  const csrf = getCookie("blockminer_csrf");
  const adminToken = localStorage.getItem("adminToken");

  const headers = {
    "Content-Type": "application/json",
    ...(isUnsafeMethod(method) && csrf ? { "X-CSRF-Token": csrf } : {}),
    // Se houver token de admin, usa Authorization header
    ...(adminToken ? { "Authorization": `Bearer ${adminToken}` } : {})
  };

  const response = await fetch(url, {
    headers,
    credentials: "include",
    ...options
  });

  const data = await response.json().catch(() => ({}));
  
  // Se unauthorized, redireciona para login
  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminTokenExpiry");
    window.location.href = "/admin/login";
    return;
  }

  if (!response.ok) {
    throw new Error(data?.message || "Request failed");
  }

  return data;
}

async function uploadMinerImage(file) {
  if (!(file instanceof File) || file.size <= 0) {
    return null;
  }

  const csrf = getCookie("blockminer_csrf");
  const adminToken = localStorage.getItem("adminToken");

  const headers = {
    ...(csrf ? { "X-CSRF-Token": csrf } : {}),
    ...(adminToken ? { "Authorization": `Bearer ${adminToken}` } : {}),
    "X-File-Name": file.name
  };

  const response = await fetch("/api/admin/miners/upload-image", {
    method: "POST",
    headers,
    body: file,
    credentials: "include"
  });

  const data = await response.json().catch(() => ({}));

  if (response.status === 401 || response.status === 403) {
    localStorage.removeItem("adminToken");
    localStorage.removeItem("adminTokenExpiry");
    window.location.href = "/admin/login";
    return null;
  }

  if (!response.ok) {
    throw new Error(data?.message || "Image upload failed");
  }

  return data?.imageUrl || null;
}

async function exportDatabase() {
  const adminToken = localStorage.getItem("adminToken");
  const headers = {
    ...(adminToken ? { "Authorization": `Bearer ${adminToken}` } : {})
  };

  setSmallStatus(exportStatus, "Exporting DB...", "info");
  exportDbButton.disabled = true;

  try {
    const response = await fetch("/api/admin/export-db", {
      method: "GET",
      headers,
      credentials: "include"
    });

    if (response.status === 401 || response.status === 403) {
      localStorage.removeItem("adminToken");
      localStorage.removeItem("adminTokenExpiry");
      window.location.href = "/admin/login";
      return;
    }

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      throw new Error(errorPayload?.message || "Failed to export database.");
    }

    const blob = await response.blob();
    const disposition = response.headers.get("content-disposition") || "";
    const filenameMatch = disposition.match(/filename="?([^";]+)"?/i);
    const filename = filenameMatch?.[1] || `blockminer-export-${Date.now()}.db`;

    const downloadUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(downloadUrl);

    setSmallStatus(exportStatus, "DB exported.", "success");
  } catch (error) {
    setSmallStatus(exportStatus, error.message || "Failed to export DB.", "error");
  } finally {
    exportDbButton.disabled = false;
  }
}

createImageFileInput?.addEventListener("change", () => {
  const file = createImageFileInput.files?.[0];
  if (!(file instanceof File) || !createImageUrlInput) {
    return;
  }

  const extByMime = {
    "image/png": ".png",
    "image/jpeg": ".jpg",
    "image/webp": ".webp",
    "image/gif": ".gif"
  };

  const fallbackExt = (() => {
    const match = String(file.name || "").toLowerCase().match(/\.[a-z0-9]+$/);
    return match ? match[0] : ".png";
  })();

  const ext = extByMime[file.type] || fallbackExt;
  const safeName = sanitizeMinerImageName(file.name);
  createImageUrlInput.value = `/assets/machines/uploaded/${safeName}${ext}`;
});

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
    ["Lockouts (7d)", stats.lockouts7d],
    ["YouTube active hash", formatNumber(stats.youtubeActiveHash, 2)],
    ["YouTube claims (24h)", stats.youtubeClaims24h],
    ["YouTube users (24h)", stats.youtubeUsers24h],
    ["Server CPU", `${formatPercent(stats.serverCpuUsagePercent)} (${Number(stats.serverCpuCores || 0)} cores)`],
    ["Load avg (1m/5m/15m)", stats.serverLoadAvgSupported === false
      ? "N/A on Windows"
      : `${formatCompactNumber(stats.serverLoadAvg1m, 2)} / ${formatCompactNumber(stats.serverLoadAvg5m, 2)} / ${formatCompactNumber(stats.serverLoadAvg15m, 2)}`],
    ["Server RAM used", `${formatBytes(stats.serverMemoryUsedBytes)} / ${formatBytes(stats.serverMemoryTotalBytes)} (${formatPercent(stats.serverMemoryUsagePercent)})`],
    ["Server RAM free", formatBytes(stats.serverMemoryFreeBytes)],
    ["Storage used", `${formatBytes(stats.serverDiskUsedBytes)} / ${formatBytes(stats.serverDiskTotalBytes)} (${formatPercent(stats.serverDiskUsagePercent)})`],
    ["Storage free", formatBytes(stats.serverDiskFreeBytes)],
    ["Node RSS", formatBytes(stats.processRssBytes)],
    ["Node heap", `${formatBytes(stats.processHeapUsedBytes)} / ${formatBytes(stats.processHeapTotalBytes)}`],
    ["Node external", formatBytes(stats.processExternalBytes)],
    ["Process uptime", `${formatCompactNumber(stats.processUptimeSeconds, 0)}s`]
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
      <td>${escapeHtml(user.ip || "--")}</td>
      <td>${escapeHtml(formatCompactNumber(user.pool_balance, 6))}</td>
      <td>${escapeHtml(formatCompactNumber(user.base_hash_rate, 2))}</td>
      <td>${escapeHtml(String(Number(user.faucet_claims || 0)))}</td>
      <td>${escapeHtml(String(Number(user.shortlink_daily_runs || 0)))}</td>
      <td>${escapeHtml(String(Number(user.auto_gpu_claims || 0)))}</td>
      <td>${escapeHtml(String(Number(user.youtube_claims || 0)))}</td>
      <td>${escapeHtml(formatCompactNumber(user.youtube_active_hash, 2))}</td>
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

function renderWithdrawals(withdrawals) {
  if (!withdrawalsTable) return;
  withdrawalsTable.innerHTML = "";

  if (!withdrawals || withdrawals.length === 0) {
    const row = document.createElement("tr");
    row.innerHTML = `<td colspan="6" style="text-align: center; padding: 20px;">No pending withdrawals</td>`;
    withdrawalsTable.appendChild(row);
    return;
  }

  withdrawals.forEach((withdrawal) => {
    const row = document.createElement("tr");
    const statusBadge = {
      pending: '<span class="pill" style="background: #FFA500; color: white;">⏳ Pending Review</span>',
      approved: '<span class="pill" style="background: #2196F3; color: white;">📤 Approved - Awaiting Payment</span>',
      completed: '<span class="pill" style="background: #4CAF50; color: white;">✓ Paid</span>',
      failed: '<span class="pill" style="background: #F44336; color: white;">✗ Rejected</span>'
    };
    
    row.innerHTML = `
      <td>${escapeHtml(withdrawal.id)}</td>
      <td>${escapeHtml(withdrawal.user_id)}</td>
      <td>${formatNumber(withdrawal.amount, 6)}</td>
      <td>
        <div style="display: flex; gap: 8px; align-items: center;">
          <code style="font-size: 11px; font-family: monospace; word-break: break-all; flex: 1;">${escapeHtml(withdrawal.address)}</code>
          <button class="btn small" type="button" data-action="copy-address" data-address="${escapeHtml(withdrawal.address)}" title="Copy address">📋</button>
        </div>
      </td>
      <td>${escapeHtml(formatDate(withdrawal.created_at))}</td>
      <td>${statusBadge[withdrawal.status] || statusBadge.pending}</td>
      <td>
        <div style="display: flex; gap: 4px; flex-wrap: wrap;">
          ${withdrawal.status === 'pending' ? `<button class="btn small good" type="button" data-action="approve" data-id="${withdrawal.id}">👍 Approve</button>` : ''}
          ${['pending', 'approved'].includes(withdrawal.status) ? `<button class="btn small" type="button" data-action="complete" data-id="${withdrawal.id}">💳 Paid</button>` : ''}
          ${['pending', 'approved'].includes(withdrawal.status) ? `<button class="btn small bad" type="button" data-action="reject" data-id="${withdrawal.id}">❌ Reject</button>` : ''}
        </div>
      </td>
    `;

    const copyBtn = row.querySelector('[data-action="copy-address"]');
    const approveBtn = row.querySelector('[data-action="approve"]');
    const completeBtn = row.querySelector('[data-action="complete"]');
    const rejectBtn = row.querySelector('[data-action="reject"]');

    copyBtn?.addEventListener("click", (e) => {
      const address = e.target.dataset.address;
      navigator.clipboard.writeText(address).then(() => {
        const originalText = e.target.textContent;
        e.target.textContent = "✓ Copied!";
        setTimeout(() => {
          e.target.textContent = originalText;
        }, 2000);
      });
    });

    approveBtn?.addEventListener("click", () => approveWithdrawal(withdrawal.id));
    completeBtn?.addEventListener("click", () => completeWithdrawalManually(withdrawal.id));
    rejectBtn?.addEventListener("click", () => rejectWithdrawal(withdrawal.id));

    withdrawalsTable.appendChild(row);
  });
}

async function loadWithdrawals() {
  setSmallStatus(withdrawalsStatus, "Loading...", "info");
  try {
    const data = await request("/api/admin/withdrawals/pending");
    renderWithdrawals(data.withdrawals || []);
    setSmallStatus(withdrawalsStatus, `${data.withdrawals?.length || 0} pending`, "info");
  } catch (error) {
    setSmallStatus(withdrawalsStatus, error.message || "Failed to load withdrawals.", "error");
  }
}

async function approveWithdrawal(withdrawalId) {
  try {
    setSmallStatus(withdrawalsStatus, "Approving...", "info");
    const result = await request(`/api/admin/withdrawals/${withdrawalId}/approve`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setSmallStatus(withdrawalsStatus, result.message || "Withdrawal approved.", "success");
    await loadWithdrawals();
  } catch (error) {
    setSmallStatus(withdrawalsStatus, error.message || "Failed to approve withdrawal.", "error");
  }
}

async function rejectWithdrawal(withdrawalId) {
  if (!confirm("Are you sure you want to reject this withdrawal? The balance will be refunded to the user.")) {
    return;
  }
  try {
    setSmallStatus(withdrawalsStatus, "Rejecting...", "info");
    const result = await request(`/api/admin/withdrawals/${withdrawalId}/reject`, {
      method: "POST",
      body: JSON.stringify({})
    });
    setSmallStatus(withdrawalsStatus, result.message || "Withdrawal rejected.", "success");
    await loadWithdrawals();
  } catch (error) {
    setSmallStatus(withdrawalsStatus, error.message || "Failed to reject withdrawal.", "error");
  }
}

async function completeWithdrawalManually(withdrawalId) {
  const txHash = prompt("Enter transaction hash (optional, press OK to skip):", "");
  if (txHash === null) return; // User cancelled
  
  try {
    setSmallStatus(withdrawalsStatus, "Marking as completed...", "info");
    const result = await request(`/api/admin/withdrawals/${withdrawalId}/complete`, {
      method: "POST",
      body: JSON.stringify({ txHash: txHash.trim() || null })
    });
    setSmallStatus(withdrawalsStatus, result.message || "Withdrawal completed.", "success");
    await loadWithdrawals();
  } catch (error) {
    setSmallStatus(withdrawalsStatus, error.message || "Failed to complete withdrawal.", "error");
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
      <td><input type="checkbox" name="showInShop" ${Number(miner.show_in_shop) === 1 ? "checked" : ""} /></td>
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
    isActive: getChecked("isActive"),
    showInShop: getChecked("showInShop")
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
    const imageFile = formData.get("imageFile");
    let imageUrl = String(formData.get("imageUrl") || "").trim() || null;

    if (imageFile instanceof File && imageFile.size > 0) {
      setStatus("Uploading image...", "info");
      imageUrl = await uploadMinerImage(imageFile);
      if (createImageUrlInput && imageUrl) {
        createImageUrlInput.value = imageUrl;
      }
    }

    const payload = {
      name: String(formData.get("name") || "").trim(),
      slug: String(formData.get("slug") || "").trim(),
      baseHashRate: Number(formData.get("baseHashRate")),
      price: Number(formData.get("price")),
      slotSize: Number(formData.get("slotSize")),
      imageUrl,
      isActive: Boolean(formData.get("isActive")),
      showInShop: Boolean(formData.get("showInShop"))
    };

    await request("/api/admin/miners", {
      method: "POST",
      body: JSON.stringify(payload)
    });

    createForm.reset();
    createForm.querySelector("[name='isActive']").checked = true;
    createForm.querySelector("[name='showInShop']").checked = true;
    await loadMiners();
    setStatus("Miner created.", "success");
  } catch (error) {
    setStatus(error.message || "Failed to create miner.", "error");
  }
});

refreshButton?.addEventListener("click", () => loadMiners());
exportDbButton?.addEventListener("click", () => exportDatabase());

refreshButton?.addEventListener("click", () => {
  loadStats();
  loadUsers();
  loadAudit();
  loadWithdrawals();
  loadMiners();
});

loadStats();
loadUsers();
loadAudit();
loadWithdrawals();
loadMiners();

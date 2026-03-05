const minersModel = require("../models/minersModel");
const { get, all, run } = require("../models/db");
const os = require("os");
const path = require("path");
const fs = require("fs/promises");
const { execFile } = require("child_process");
const { promisify } = require("util");
const logger = require("../utils/logger").getLogger("AdminController");

const execFileAsync = promisify(execFile);
const IMAGE_FALLBACK_CANDIDATES = [
  "/assets/machines/reward2.png",
  "/assets/machines/reward3.png",
  "/assets/machines/1.png",
  "/assets/machines/2.png",
  "/assets/machines/3.png"
];

function captureCpuSnapshot() {
  const cpus = os.cpus() || [];
  let idle = 0;
  let total = 0;

  for (const cpu of cpus) {
    const times = cpu?.times || {};
    const cpuIdle = Number(times.idle || 0);
    const cpuTotal = Number(times.user || 0) + Number(times.nice || 0) + Number(times.sys || 0) + Number(times.irq || 0) + cpuIdle;
    idle += cpuIdle;
    total += cpuTotal;
  }

  return { idle, total, at: Date.now(), cores: cpus.length };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function measureCpuUsagePercent(sampleMs = 300) {
  const before = captureCpuSnapshot();
  await sleep(sampleMs);
  const after = captureCpuSnapshot();

  const idleDelta = after.idle - before.idle;
  const totalDelta = after.total - before.total;
  const envCores = Number(process.env.NUMBER_OF_PROCESSORS || 0);
  const cores = Number.isFinite(after.cores) && after.cores > 0 ? after.cores : envCores;

  if (totalDelta <= 0) {
    return { usagePercent: 0, cores };
  }

  const usagePercent = Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100));
  return { usagePercent, cores };
}

async function getDiskUsageFromPowerShell(targetPath) {
  // Use parameter to avoid string interpolation/injection
  const script = `
    param([string]$path)
    $item = Get-Item -LiteralPath $path -ErrorAction Stop
    $drive = $item.PSDrive
    if ($drive) {
      [pscustomobject]@{
        total = [double]($drive.Used + $drive.Free)
        used = [double]$drive.Used
        free = [double]$drive.Free
      } | ConvertTo-Json -Compress
    }
  `;

  const { stdout } = await execFileAsync(
    "powershell",
    ["-NoProfile", "-NonInteractive", "-Command", script, "-path", targetPath],
    { timeout: 5000 }
  );

  const parsed = JSON.parse(String(stdout || "{}").trim() || "{}");
  const totalBytes = Number(parsed?.total || 0);
  const usedBytes = Number(parsed?.used || 0);
  const freeBytes = Number(parsed?.free || 0);
  return { totalBytes, usedBytes, freeBytes };
}

async function getDiskUsageFromDf(targetPath) {
  const { stdout } = await execFileAsync("df", ["-k", targetPath], { timeout: 5000 });
  const lines = String(stdout || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) {
    return { totalBytes: 0, freeBytes: 0, usedBytes: 0 };
  }

  const columns = lines[lines.length - 1].trim().split(/\s+/);
  const totalKb = Number(columns[1] || 0);
  const usedKb = Number(columns[2] || 0);
  const freeKb = Number(columns[3] || 0);

  return {
    totalBytes: totalKb * 1024,
    usedBytes: usedKb * 1024,
    freeBytes: freeKb * 1024
  };
}

async function getDiskUsageBytes(targetPath) {
  if (typeof fs.statfs === "function") {
    try {
      const stats = await fs.statfs(targetPath);
      const blockSize = Number(stats?.bsize || stats?.frsize || 0);
      const totalBlocks = Number(stats?.blocks || 0);
      const freeBlocks = Number(stats?.bavail || stats?.bfree || 0);

      const totalBytes = blockSize * totalBlocks;
      const freeBytes = blockSize * freeBlocks;
      const usedBytes = Math.max(0, totalBytes - freeBytes);

      if (totalBytes > 0) {
        return { totalBytes, freeBytes, usedBytes };
      }
    } catch {
      // fallback below
    }
  }

  try {
    if (process.platform === "win32") {
      return await getDiskUsageFromPowerShell(targetPath);
    }
    return await getDiskUsageFromDf(targetPath);
  } catch {
    return { totalBytes: 0, freeBytes: 0, usedBytes: 0 };
  }
}

async function collectServerMetrics() {
  const [diskUsage, cpu] = await Promise.all([
    getDiskUsageBytes(path.resolve(process.cwd())),
    measureCpuUsagePercent(300)
  ]);

  const totalMem = Number(os.totalmem() || 0);
  const freeMem = Number(os.freemem() || 0);
  const usedMem = Math.max(0, totalMem - freeMem);
  const processMemory = process.memoryUsage();
  const loadAverageRaw = os.loadavg ? os.loadavg() : [0, 0, 0];
  const loadAvgSupported = process.platform !== "win32";

  return {
    serverCpuUsagePercent: Number(cpu.usagePercent || 0),
    serverCpuCores: Number(cpu.cores || 0),
    serverLoadAvg1m: loadAvgSupported ? Number(loadAverageRaw?.[0] || 0) : null,
    serverLoadAvg5m: loadAvgSupported ? Number(loadAverageRaw?.[1] || 0) : null,
    serverLoadAvg15m: loadAvgSupported ? Number(loadAverageRaw?.[2] || 0) : null,
    serverLoadAvgSupported: loadAvgSupported,
    serverMemoryTotalBytes: totalMem,
    serverMemoryUsedBytes: usedMem,
    serverMemoryFreeBytes: freeMem,
    serverMemoryUsagePercent: totalMem > 0 ? (usedMem / totalMem) * 100 : 0,
    serverDiskTotalBytes: Number(diskUsage.totalBytes || 0),
    serverDiskUsedBytes: Number(diskUsage.usedBytes || 0),
    serverDiskFreeBytes: Number(diskUsage.freeBytes || 0),
    serverDiskUsagePercent: Number(diskUsage.totalBytes || 0) > 0
      ? (Number(diskUsage.usedBytes || 0) / Number(diskUsage.totalBytes || 1)) * 100
      : 0,
    processRssBytes: Number(processMemory?.rss || 0),
    processHeapUsedBytes: Number(processMemory?.heapUsed || 0),
    processHeapTotalBytes: Number(processMemory?.heapTotal || 0),
    processExternalBytes: Number(processMemory?.external || 0),
    processUptimeSeconds: Number(process.uptime?.() || 0),
    sampledAt: Date.now(),
    platform: process.platform
  };
}

function toTrimmedString(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseSlotSize(value) {
  const num = Number(value);
  if (!Number.isInteger(num)) return null;
  if (num !== 1 && num !== 2) return null;
  return num;
}

function parseIsActive(value) {
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return Boolean(value);
}

function parseOptionalBoolean(value) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  return Boolean(value);
}

function normalizeImageUrl(value) {
  const text = toTrimmedString(value);
  return text.length > 0 ? text : null;
}

async function validateLocalMinerImagePath(imageUrl) {
  if (!imageUrl) {
    return { ok: true };
  }

  const normalizedUrl = String(imageUrl).replace(/\\/g, "/").trim();
  const machinesPrefix = "/assets/machines/";

  if (!normalizedUrl.startsWith(machinesPrefix)) {
    return { ok: true };
  }

  const safePublicPath = path.posix.normalize(normalizedUrl);
  if (!safePublicPath.startsWith(machinesPrefix) || safePublicPath.includes("..")) {
    return { ok: false, message: "Invalid uploaded image path." };
  }

  const absoluteFilePath = path.join(__dirname, "..", "public", safePublicPath.replace(/^\//, ""));
  try {
    await fs.access(absoluteFilePath);
    return { ok: true };
  } catch {
    return { ok: false, message: "Image file was not found in /assets/machines. Check the path before saving." };
  }
}

async function validateUploadedImageUniqueness(imageUrl, currentMinerId = null) {
  if (!imageUrl) {
    return { ok: true };
  }

  const normalizedUrl = String(imageUrl).replace(/\\/g, "/").trim();
  const uploadPrefix = "/assets/machines/uploaded/";
  if (!normalizedUrl.startsWith(uploadPrefix)) {
    return { ok: true };
  }

  const existing = await get(
    "SELECT id, name FROM miners WHERE image_url = ? AND (? IS NULL OR id != ?) LIMIT 1",
    [normalizedUrl, currentMinerId, currentMinerId]
  );

  if (existing?.id) {
    return {
      ok: false,
      message: `This uploaded image is already assigned to miner #${existing.id} (${existing.name}). Choose another image or remove it from the other miner first.`
    };
  }

  return { ok: true };
}

function normalizeStoredImageUrl(value) {
  return String(value || "").replace(/\\/g, "/").trim();
}

function isUploadedMachineImage(imageUrl) {
  return normalizeStoredImageUrl(imageUrl).startsWith("/assets/machines/uploaded/");
}

async function listDuplicateImageUrlGroups({ uploadedOnly = false } = {}) {
  const whereParts = ["image_url IS NOT NULL", "TRIM(image_url) <> ''"];
  const params = [];

  if (uploadedOnly) {
    whereParts.push("image_url LIKE ?");
    params.push("/assets/machines/uploaded/%");
  }

  const rows = await all(
    `
      SELECT image_url,
             COUNT(*) AS total,
             GROUP_CONCAT(id || ':' || name, ' | ') AS miners
      FROM miners
      WHERE ${whereParts.join(" AND ")}
      GROUP BY image_url
      HAVING COUNT(*) > 1
      ORDER BY total DESC, image_url ASC
    `,
    params
  );

  return rows.map((row) => ({
    imageUrl: row.image_url,
    total: Number(row.total || 0),
    miners: String(row.miners || "")
  }));
}

async function fixDuplicateImageUrls({ uploadedOnly = true } = {}) {
  const miners = await all(
    "SELECT id, name, image_url FROM miners WHERE image_url IS NOT NULL AND TRIM(image_url) <> '' ORDER BY id ASC"
  );

  const usedUrls = new Set();
  for (const miner of miners) {
    const imageUrl = normalizeStoredImageUrl(miner.image_url);
    if (imageUrl) {
      usedUrls.add(imageUrl);
    }
  }

  const groupedByImageUrl = new Map();
  for (const miner of miners) {
    const imageUrl = normalizeStoredImageUrl(miner.image_url);
    if (!imageUrl) continue;
    if (uploadedOnly && !isUploadedMachineImage(imageUrl)) continue;

    if (!groupedByImageUrl.has(imageUrl)) {
      groupedByImageUrl.set(imageUrl, []);
    }
    groupedByImageUrl.get(imageUrl).push({
      id: Number(miner.id),
      name: String(miner.name || ""),
      imageUrl
    });
  }

  const updates = [];
  for (const [, grouped] of groupedByImageUrl) {
    if (grouped.length <= 1) continue;

    for (let index = 1; index < grouped.length; index += 1) {
      const miner = grouped[index];
      const currentUrl = miner.imageUrl;

      let replacement = null;
      for (const candidate of IMAGE_FALLBACK_CANDIDATES) {
        if (!usedUrls.has(candidate) && candidate !== currentUrl) {
          replacement = candidate;
          break;
        }
      }

      if (replacement) {
        usedUrls.add(replacement);
      }

      updates.push({
        id: miner.id,
        name: miner.name,
        from: currentUrl,
        to: replacement
      });
    }
  }

  if (!updates.length) {
    return [];
  }

  await run("BEGIN TRANSACTION");
  try {
    for (const change of updates) {
      await run("UPDATE miners SET image_url = ? WHERE id = ?", [change.to, change.id]);
    }
    await run("COMMIT");
  } catch (error) {
    await run("ROLLBACK");
    throw error;
  }

  return updates;
}

function validateMinerPayload(body) {
  const name = toTrimmedString(body?.name);
  const slug = toTrimmedString(body?.slug);
  const baseHashRate = parseNumber(body?.baseHashRate);
  const price = parseNumber(body?.price);
  const slotSize = parseSlotSize(body?.slotSize);
  const imageUrl = normalizeImageUrl(body?.imageUrl);
  const isActive = parseIsActive(body?.isActive);
  const showInShop = parseOptionalBoolean(body?.showInShop);

  if (!name || !slug) {
    return { ok: false, message: "Name and slug are required." };
  }

  if (!/^[a-z0-9-]{3,60}$/i.test(slug)) {
    return { ok: false, message: "Slug must be 3-60 chars, letters, numbers, or hyphens." };
  }

  if (baseHashRate === null || baseHashRate <= 0) {
    return { ok: false, message: "Base hash rate must be greater than 0." };
  }

  if (price === null || price < 0) {
    return { ok: false, message: "Price must be 0 or higher." };
  }

  if (!slotSize) {
    return { ok: false, message: "Slot size must be 1 or 2." };
  }

  return {
    ok: true,
    value: {
      name,
      slug,
      baseHashRate,
      price,
      slotSize,
      imageUrl,
      isActive,
      ...(showInShop === null ? {} : { showInShop })
    }
  };
}

function createAdminController() {
  async function getStats(_req, res) {
    try {
      const now = Date.now();
      const dayAgo = now - 24 * 60 * 60 * 1000;
      const weekAgo = now - 7 * 24 * 60 * 60 * 1000;

      const [
        usersTotal,
        usersBanned,
        usersNew24h,
        minersTotal,
        minersActive,
        inventoryTotal,
        balances,
        tx24h,
        referralsTotal,
        audit24h,
        youtubeActiveHash,
        youtubeClaims24h,
        youtubeUsers24h
      ] = await Promise.all([
        get("SELECT COUNT(*) AS count FROM users"),
        get("SELECT COUNT(*) AS count FROM users WHERE is_banned = 1"),
        get("SELECT COUNT(*) AS count FROM users WHERE created_at >= ?", [dayAgo]),
        get("SELECT COUNT(*) AS count FROM miners"),
        get("SELECT COUNT(*) AS count FROM miners WHERE is_active = 1"),
        get("SELECT COUNT(*) AS count FROM user_inventory"),
        get(
          "SELECT COALESCE(SUM(balance), 0) AS balance, COALESCE(SUM(lifetime_mined), 0) AS lifetime, COALESCE(SUM(total_withdrawn), 0) AS withdrawn FROM users_temp_power"
        ),
        get(
          "SELECT COUNT(*) AS count FROM transactions WHERE created_at >= ?",
          [dayAgo]
        ),
        get("SELECT COUNT(*) AS count FROM referrals"),
        get("SELECT COUNT(*) AS count FROM audit_logs WHERE created_at >= ?", [dayAgo]),
        get("SELECT COALESCE(SUM(hash_rate), 0) AS total FROM youtube_watch_user_powers WHERE is_expired = 0 AND expires_at > ?", [now]),
        get("SELECT COUNT(*) AS count FROM youtube_watch_power_history WHERE claimed_at >= ?", [dayAgo]),
        get("SELECT COUNT(DISTINCT user_id) AS count FROM youtube_watch_power_history WHERE claimed_at >= ?", [dayAgo])
      ]);

      const serverMetrics = await collectServerMetrics();

      const lockoutsWeek = await get(
        "SELECT COUNT(*) AS count FROM auth_lockouts WHERE last_at >= ?",
        [weekAgo]
      ).catch(() => ({ count: 0 }));

      res.json({
        ok: true,
        stats: {
          usersTotal: Number(usersTotal?.count || 0),
          usersBanned: Number(usersBanned?.count || 0),
          usersNew24h: Number(usersNew24h?.count || 0),
          minersTotal: Number(minersTotal?.count || 0),
          minersActive: Number(minersActive?.count || 0),
          inventoryTotal: Number(inventoryTotal?.count || 0),
          balanceTotal: Number(balances?.balance || 0),
          lifetimeMinedTotal: Number(balances?.lifetime || 0),
          totalWithdrawn: Number(balances?.withdrawn || 0),
          transactions24h: Number(tx24h?.count || 0),
          referralsTotal: Number(referralsTotal?.count || 0),
          auditEvents24h: Number(audit24h?.count || 0),
          lockouts7d: Number(lockoutsWeek?.count || 0),
          youtubeActiveHash: Number(youtubeActiveHash?.total || 0),
          youtubeClaims24h: Number(youtubeClaims24h?.count || 0),
          youtubeUsers24h: Number(youtubeUsers24h?.count || 0),
          ...serverMetrics
        }
      });
    } catch (error) {
      logger.error("Admin stats error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to load admin stats." });
    }
  }

  async function getServerMetrics(_req, res) {
    try {
      const metrics = await collectServerMetrics();
      res.json({ ok: true, metrics });
    } catch (error) {
      logger.error("Admin server metrics error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to load server metrics." });
    }
  }

  async function listRecentUsers(req, res) {
    try {
      const page = Math.max(1, Number(req.query?.page || 1));
      const pageSize = Math.max(1, Math.min(200, Number(req.query?.pageSize || req.query?.limit || 25)));
      const offset = (page - 1) * pageSize;
      const queryText = toTrimmedString(req.query?.q).toLowerCase();
      const fromDate = toTrimmedString(req.query?.from);
      const toDate = toTrimmedString(req.query?.to);

      const whereParts = [];
      const whereParams = [];

      if (queryText) {
        whereParts.push("(LOWER(COALESCE(u.email, '')) LIKE ? OR LOWER(COALESCE(u.username, '')) LIKE ? OR LOWER(COALESCE(u.name, '')) LIKE ?)");
        const likeQuery = `%${queryText}%`;
        whereParams.push(likeQuery, likeQuery, likeQuery);
      }

      if (fromDate) {
        const fromMs = Date.parse(`${fromDate}T00:00:00Z`);
        if (Number.isFinite(fromMs)) {
          whereParts.push("u.created_at >= ?");
          whereParams.push(fromMs);
        }
      }

      if (toDate) {
        const toMs = Date.parse(`${toDate}T23:59:59.999Z`);
        if (Number.isFinite(toMs)) {
          whereParts.push("u.created_at <= ?");
          whereParams.push(toMs);
        }
      }

      const whereSql = whereParts.length > 0 ? `WHERE ${whereParts.join(" AND ")}` : "";

      const totalRow = await get(
        `
          SELECT COUNT(*) AS total
          FROM users u
          ${whereSql}
        `,
        whereParams
      );

      const users = await all(
        `
          SELECT
            u.id,
            u.username,
            u.name,
            u.email,
            u.ip,
            u.is_banned,
            u.created_at,
            u.last_login_at,
            COALESCE(utp.wallet_address, '') AS wallet_address,
            COALESCE(utp.rigs, 0) AS rigs,
            COALESCE(utp.base_hash_rate, 0) AS base_hash_rate,
            COALESCE(utp.balance, 0) AS pool_balance,
            COALESCE(utp.lifetime_mined, 0) AS lifetime_mined,
            COALESCE(utp.total_withdrawn, 0) AS total_withdrawn,
            COALESCE(fc.total_claims, 0) AS faucet_claims,
            COALESCE(sc.daily_runs, 0) AS shortlink_daily_runs,
            COALESCE(amg.total_claimed_ever, 0) AS auto_gpu_claims,
            COALESCE(yth.total_claimed_ever, 0) AS youtube_claims,
            COALESCE(ytp.active_hash, 0) AS youtube_active_hash
          FROM users u
          LEFT JOIN users_temp_power utp ON utp.user_id = u.id
          LEFT JOIN faucet_claims fc ON fc.user_id = u.id
          LEFT JOIN shortlink_completions sc ON sc.user_id = u.id
          LEFT JOIN (
            SELECT user_id, COUNT(*) AS total_claimed_ever
            FROM auto_mining_gpu_logs
            WHERE action = 'claim'
            GROUP BY user_id
          ) amg ON amg.user_id = u.id
          LEFT JOIN (
            SELECT user_id, COUNT(*) AS total_claimed_ever
            FROM youtube_watch_power_history
            GROUP BY user_id
          ) yth ON yth.user_id = u.id
          LEFT JOIN (
            SELECT user_id, COALESCE(SUM(hash_rate), 0) AS active_hash
            FROM youtube_watch_user_powers
            WHERE is_expired = 0 AND expires_at > ?
            GROUP BY user_id
          ) ytp ON ytp.user_id = u.id
          ${whereSql}
          ORDER BY u.created_at DESC
          LIMIT ? OFFSET ?
        `,
        [Date.now(), ...whereParams, pageSize, offset]
      );

      res.json({
        ok: true,
        users,
        page,
        pageSize,
        total: Number(totalRow?.total || 0)
      });
    } catch (error) {
      logger.error("Admin list users error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to load users." });
    }
  }

  async function listAuditLogs(req, res) {
    try {
      const limit = Math.max(1, Math.min(300, Number(req.query?.limit || 50)));
      const logs = await all(
        `
          SELECT a.id, a.user_id, u.email AS user_email, a.action, a.ip, a.created_at
          FROM audit_logs a
          LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.created_at DESC
          LIMIT ?
        `,
        [limit]
      );
      res.json({ ok: true, logs });
    } catch (error) {
      logger.error("Admin list audit logs error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to load audit logs." });
    }
  }

  async function setUserBan(req, res) {
    try {
      const userId = Number(req.params?.id);
      if (!Number.isInteger(userId) || userId <= 0) {
        res.status(400).json({ ok: false, message: "Invalid user id" });
        return;
      }

      const isBanned = Boolean(req.body?.isBanned);
      await run("UPDATE users SET is_banned = ? WHERE id = ?", [isBanned ? 1 : 0, userId]);
      const updated = await get("SELECT id, email, is_banned FROM users WHERE id = ?", [userId]);
      res.json({ ok: true, user: updated });
    } catch (error) {
      logger.error("Admin set user ban error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to update user." });
    }
  }

  async function listMiners(_req, res) {
    try {
      const miners = await minersModel.listAllMiners();
      res.json({ ok: true, miners });
    } catch (error) {
      logger.error("Admin list miners error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to load miners." });
    }
  }

  async function createMiner(req, res) {
    const validation = validateMinerPayload(req.body);
    if (!validation.ok) {
      res.status(400).json({ ok: false, message: validation.message });
      return;
    }

    const imageValidation = await validateLocalMinerImagePath(validation.value.imageUrl);
    if (!imageValidation.ok) {
      res.status(400).json({ ok: false, message: imageValidation.message });
      return;
    }

    const uniqueImageValidation = await validateUploadedImageUniqueness(validation.value.imageUrl, null);
    if (!uniqueImageValidation.ok) {
      res.status(400).json({ ok: false, message: uniqueImageValidation.message });
      return;
    }

    try {
      const miner = await minersModel.createMiner(validation.value);
      res.json({ ok: true, miner });
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed: miners.slug")) {
        res.status(409).json({ ok: false, message: "Slug already exists." });
        return;
      }
      logger.error("Admin create miner error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to create miner." });
    }
  }

  async function updateMiner(req, res) {
    const minerId = Number(req.params?.id);
    if (!Number.isInteger(minerId) || minerId <= 0) {
      res.status(400).json({ ok: false, message: "Invalid miner ID." });
      return;
    }

    const validation = validateMinerPayload(req.body);
    if (!validation.ok) {
      res.status(400).json({ ok: false, message: validation.message });
      return;
    }

    const imageValidation = await validateLocalMinerImagePath(validation.value.imageUrl);
    if (!imageValidation.ok) {
      res.status(400).json({ ok: false, message: imageValidation.message });
      return;
    }

    const uniqueImageValidation = await validateUploadedImageUniqueness(validation.value.imageUrl, minerId);
    if (!uniqueImageValidation.ok) {
      res.status(400).json({ ok: false, message: uniqueImageValidation.message });
      return;
    }

    try {
      const existing = await minersModel.getMinerById(minerId);
      if (!existing) {
        res.status(404).json({ ok: false, message: "Miner not found." });
        return;
      }

      const miner = await minersModel.updateMiner(minerId, validation.value);
      res.json({ ok: true, miner });
    } catch (error) {
      if (String(error?.message || "").includes("UNIQUE constraint failed: miners.slug")) {
        res.status(409).json({ ok: false, message: "Slug already exists." });
        return;
      }
      logger.error("Admin update miner error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to update miner." });
    }
  }

  async function setMinerShopVisibility(req, res) {
    const minerId = Number(req.params?.id);
    if (!Number.isInteger(minerId) || minerId <= 0) {
      res.status(400).json({ ok: false, message: "Invalid miner ID." });
      return;
    }

    if (typeof req.body?.showInShop !== "boolean") {
      res.status(400).json({ ok: false, message: "showInShop must be boolean." });
      return;
    }

    try {
      const existing = await minersModel.getMinerById(minerId);
      if (!existing) {
        res.status(404).json({ ok: false, message: "Miner not found." });
        return;
      }

      const miner = await minersModel.setMinerShowInShop(minerId, req.body.showInShop);
      res.json({
        ok: true,
        miner,
        message: req.body.showInShop ? "Miner added to shop." : "Miner removed from shop."
      });
    } catch (error) {
      logger.error("Admin set miner shop visibility error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to update shop visibility." });
    }
  }

  async function auditMinerImageDuplicates(_req, res) {
    try {
      const [duplicatesAll, duplicatesUploaded] = await Promise.all([
        listDuplicateImageUrlGroups({ uploadedOnly: false }),
        listDuplicateImageUrlGroups({ uploadedOnly: true })
      ]);

      res.json({
        ok: true,
        duplicatesAll,
        duplicatesUploaded,
        summary: {
          allGroups: duplicatesAll.length,
          uploadedGroups: duplicatesUploaded.length
        }
      });
    } catch (error) {
      logger.error("Admin audit miner image duplicates error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to audit duplicate image URLs." });
    }
  }

  async function fixMinerImageDuplicates(req, res) {
    try {
      const scope = String(req.body?.scope || "uploaded").trim().toLowerCase();
      const uploadedOnly = scope !== "all";

      const updates = await fixDuplicateImageUrls({ uploadedOnly });
      const [duplicatesAll, duplicatesUploaded] = await Promise.all([
        listDuplicateImageUrlGroups({ uploadedOnly: false }),
        listDuplicateImageUrlGroups({ uploadedOnly: true })
      ]);

      res.json({
        ok: true,
        updated: updates,
        updatedCount: updates.length,
        scope: uploadedOnly ? "uploaded" : "all",
        duplicatesAll,
        duplicatesUploaded,
        message: updates.length > 0
          ? `Updated ${updates.length} miner image URL(s).`
          : "No duplicate image URLs needed fixes for this scope."
      });
    } catch (error) {
      logger.error("Admin fix miner image duplicates error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to fix duplicate image URLs." });
    }
  }

  // === Manual Withdrawal Management ===

  async function listPendingWithdrawals(req, res) {
    try {
      const walletModel = require("../models/walletModel");
      const withdrawals = await walletModel.getPendingWithdrawals();
      res.json({ ok: true, withdrawals });
    } catch (error) {
      logger.error("Admin list pending withdrawals error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to load pending withdrawals." });
    }
  }

  async function approveWithdrawal(req, res) {
    try {
      const { withdrawalId } = req.params;

      if (!withdrawalId) {
        return res.status(400).json({ ok: false, message: "Missing withdrawal ID" });
      }

      // Get the withdrawal
      const withdrawal = await get(
        "SELECT id, user_id, amount, address, status FROM transactions WHERE id = ? AND type = 'withdrawal'",
        [withdrawalId]
      );

      if (!withdrawal) {
        return res.status(404).json({ ok: false, message: "Withdrawal not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({ ok: false, message: `Withdrawal is already ${withdrawal.status}` });
      }

      // Just mark as approved - NO automatic blockchain processing
      // User will manually pay and confirm with completeWithdrawalManually()
      await run(
        "UPDATE transactions SET status = 'approved', updated_at = ? WHERE id = ?",
        [Date.now(), withdrawalId]
      );

      res.json({
        ok: true,
        message: "Withdrawal approved. Ready to pay manually. Click '✓ Confirm Paid' after you send the funds.",
        withdrawal: {
          id: withdrawalId,
          status: "approved",
          amount: withdrawal.amount,
          address: withdrawal.address
        }
      });
    } catch (error) {
      logger.error("Admin approve withdrawal error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to approve withdrawal." });
    }
  }

  async function rejectWithdrawal(req, res) {
    try {
      const walletModel = require("../models/walletModel");
      const { withdrawalId } = req.params;

      if (!withdrawalId) {
        return res.status(400).json({ ok: false, message: "Missing withdrawal ID" });
      }

      // Get the withdrawal
      const withdrawal = await get(
        "SELECT id, user_id, amount, address, status FROM transactions WHERE id = ? AND type = 'withdrawal'",
        [withdrawalId]
      );

      if (!withdrawal) {
        return res.status(404).json({ ok: false, message: "Withdrawal not found" });
      }

      if (withdrawal.status !== "pending") {
        return res.status(400).json({ ok: false, message: `Withdrawal is already ${withdrawal.status}` });
      }

      // Mark as failed (this will refund the balance)
      await walletModel.updateTransactionStatus(withdrawalId, "failed");

      res.json({
        ok: true,
        message: "Withdrawal rejected and balance refunded",
        withdrawal: {
          id: withdrawalId,
          status: "failed"
        }
      });
    } catch (error) {
      logger.error("Admin reject withdrawal error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to reject withdrawal." });
    }
  }

  async function completeWithdrawalManually(req, res) {
    try {
      const walletModel = require("../models/walletModel");
      const { withdrawalId } = req.params;
      const { txHash } = req.body || {};

      if (!withdrawalId) {
        return res.status(400).json({ ok: false, message: "Missing withdrawal ID" });
      }

      // Get the withdrawal
      const withdrawal = await get(
        "SELECT id, user_id, amount, address, status FROM transactions WHERE id = ? AND type = 'withdrawal'",
        [withdrawalId]
      );

      if (!withdrawal) {
        return res.status(404).json({ ok: false, message: "Withdrawal not found" });
      }

      if (withdrawal.status === "completed") {
        return res.status(400).json({ ok: false, message: "Withdrawal is already completed" });
      }

      if (withdrawal.status === "failed") {
        return res.status(400).json({ ok: false, message: "Withdrawal is already failed" });
      }

      // Mark as completed (with optional tx_hash)
      await walletModel.updateTransactionStatus(withdrawalId, "completed", txHash || null);

      res.json({
        ok: true,
        message: "Withdrawal marked as completed",
        withdrawal: {
          id: withdrawalId,
          status: "completed",
          txHash: txHash || null
        }
      });
    } catch (error) {
      logger.error("Admin complete withdrawal error", { error: error?.message || String(error), stack: error?.stack });
      res.status(500).json({ ok: false, message: "Unable to complete withdrawal." });
    }
  }

  return {
    getStats,
    getServerMetrics,
    listRecentUsers,
    listAuditLogs,
    setUserBan,
    listMiners,
    createMiner,
    updateMiner,
    setMinerShopVisibility,
    auditMinerImageDuplicates,
    fixMinerImageDuplicates,
    listPendingWithdrawals,
    approveWithdrawal,
    rejectWithdrawal,
    completeWithdrawalManually
  };
}

module.exports = {
  createAdminController
};

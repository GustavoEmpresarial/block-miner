const crypto = require('crypto');
const { run, get, all } = require('../models/db');
const { getBrazilCheckinDateKey } = require('../utils/checkinDate');

const PTP_RATE_USD_PER_1000 = 0.10;
const PTP_EARNING_PER_VIEW_USD = PTP_RATE_USD_PER_1000 / 1000;
const ASSETS = {
  USDC: { column: "usdc_balance" }
};

const PROMOTE_SAMPLE_SIZE = 12;

// USDC is 1:1 with USD for PTP pricing.

function generateUserHash(userId) {
  return crypto.createHash('sha256').update(`${userId}-${Date.now()}`).digest('hex').substring(0, 16);
}

async function pickPromoteAd(userId, allowSelf) {
  const baseWhere = "status = 'active' AND (target_views = 0 OR views < target_views)";
  const params = [];
  let whereClause = baseWhere;

  if (!allowSelf) {
    whereClause += " AND user_id != ?";
    params.push(userId);
  }

  const countRow = await get(`SELECT COUNT(*) as total FROM ptp_ads WHERE ${whereClause}`, params);
  const total = Number(countRow?.total || 0);
  if (!total) {
    return null;
  }

  const bucketSize = Math.min(total, PROMOTE_SAMPLE_SIZE);
  const offset = Math.floor(Math.random() * bucketSize);
  const roll = Math.random();

  let orderBy = "created_at DESC";
  if (roll >= 0.34 && roll < 0.67) {
    orderBy = "created_at ASC";
  } else if (roll >= 0.67) {
    orderBy = "RANDOM()";
  }

  let query = `SELECT id, title, url, status, target_views, views FROM ptp_ads WHERE ${whereClause} ORDER BY ${orderBy} LIMIT 1`;

  if (orderBy === "RANDOM()") {
    return get(query, params);
  }

  query += " OFFSET ?";
  return get(query, [...params, offset]);
}

// POST /api/ptp/create-ad
async function createAd(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }
    const { title, url, views } = req.body;

    if (!title || !url) {
      return res.status(400).json({ ok: false, message: 'Title and URL required' });
    }

    const targetViews = Number(views || 0);
    if (!Number.isFinite(targetViews) || targetViews < 0) {
      return res.status(400).json({ ok: false, message: 'Valid views required' });
    }

    const assetKey = "USDC";
    const assetInfo = ASSETS[assetKey];
    const costUsd = (targetViews / 1000) * PTP_RATE_USD_PER_1000;
    const costAsset = costUsd;

    const user = await get(`SELECT ${assetInfo.column} as balance FROM users WHERE id = ?`, [userId]);
    const userBalance = user?.balance ?? 0;

    if (userBalance < costAsset) {
      return res.status(400).json({ ok: false, message: 'Insufficient balance' });
    }

    // Gerar hash único para o anúncio
    const adHash = generateUserHash(userId);

    // Criar anúncio no BD
    const result = await run(
      `
      INSERT INTO ptp_ads (user_id, title, url, hash, paid_usd, target_views, asset, cost_usd, cost_asset)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [userId, title, url, adHash, costUsd, targetViews, assetKey, costUsd, costAsset]
    );

    // Debitar saldo do usuário
    await run(`UPDATE users SET ${assetInfo.column} = ${assetInfo.column} - ? WHERE id = ?`, [costAsset, userId]);

    res.json({
      ok: true,
      message: 'Ad created successfully',
      ad: {
        id: result.lastID,
        hash: adHash,
        title,
        url,
        paid_usd: costUsd,
        target_views: targetViews,
        asset: assetKey,
        cost_usd: costUsd,
        cost_asset: costAsset
      }
    });
  } catch (error) {
    console.error('Error creating ad:', error);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// GET /api/ptp/my-ads
async function getMyAds(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }

    const ads = await all(
      `
      SELECT id, title, url, hash, views, paid_usd, created_at, status, target_views, asset, cost_usd, cost_asset
      FROM ptp_ads
      WHERE user_id = ?
      ORDER BY created_at DESC
    `,
      [userId]
    );
    res.json({ ok: true, ads });
  } catch (error) {
    console.error('Error fetching ads:', error);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// GET /api/ptp/promo-hash
async function getPromoHash(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }

    const ad = await get(
      `
      SELECT hash
      FROM ptp_ads
      WHERE user_id = ? AND status = 'active'
      ORDER BY created_at DESC
      LIMIT 1
    `,
      [userId]
    );

    if (!ad) {
      return res.status(404).json({ ok: false, message: 'No active ad found' });
    }

    const promoHash = ad.hash;
    const baseUrl = process.env.APP_URL || 'http://localhost:3000';
    const promoLink = `${baseUrl}/ptp-promo/${promoHash}`;

    res.json({
      ok: true,
      promoHash,
      promoLink
    });
  } catch (error) {
    console.error('Error generating promo hash:', error);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// POST /api/ptp/track-view
async function trackView(req, res) {
  try {
    const { adId, viewerHash, promoterId } = req.body;

    if (!adId || !viewerHash) {
      return res.status(400).json({ ok: false, message: 'Ad ID and viewer hash required' });
    }

    // Verificar se o anúncio existe
    const ad = await get('SELECT id, user_id, target_views, views FROM ptp_ads WHERE id = ?', [adId]);
    if (!ad) {
      return res.status(404).json({ ok: false, message: 'Ad not found' });
    }

    if (ad.target_views && ad.views >= ad.target_views) {
      return res.json({ ok: true, message: 'View limit reached' });
    }

    // Registrar exibição
    await run(
      `
      INSERT INTO ptp_views (ad_id, viewer_hash)
      VALUES (?, ?)
    `,
      [adId, viewerHash]
    );

    // Atualizar contador de views
    await run('UPDATE ptp_ads SET views = views + 1 WHERE id = ?', [adId]);

    const payUserId = Number.isFinite(Number(promoterId)) ? Number(promoterId) : ad.user_id;
    await run(
      "INSERT INTO ptp_earnings (user_id, ad_id, amount_usd) VALUES (?, ?, ?)",
      [payUserId, adId, PTP_EARNING_PER_VIEW_USD]
    );
    await run("UPDATE users SET usdc_balance = usdc_balance + ? WHERE id = ?", [PTP_EARNING_PER_VIEW_USD, payUserId]);

    const updatedAd = await get("SELECT views, target_views FROM ptp_ads WHERE id = ?", [adId]);
    if (updatedAd?.target_views && updatedAd.views >= updatedAd.target_views) {
      await run("UPDATE ptp_ads SET status = 'completed' WHERE id = ?", [adId]);
    }

    res.json({ ok: true, message: 'View tracked' });
  } catch (error) {
    console.error('Error tracking view:', error);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// GET /api/ptp/earnings
async function getEarnings(req, res) {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ ok: false, message: 'Unauthorized' });
    }

    const earnings = await all(
      `
      SELECT e.id, e.ad_id, e.amount_usd, e.paid_at, a.title
      FROM ptp_earnings e
      JOIN ptp_ads a ON e.ad_id = a.id
      WHERE e.user_id = ?
      ORDER BY e.paid_at DESC
    `,
      [userId]
    );

    const totalEarnings = earnings.reduce((sum, e) => sum + e.amount_usd, 0);

    const dailyRows = await all(
      `
      SELECT paid_at, amount_usd
      FROM ptp_earnings
      WHERE user_id = ? AND paid_at >= datetime('now', '-4 day')
      ORDER BY paid_at ASC
      `,
      [userId]
    );

    const dayKeys = [];
    for (let i = 2; i >= 0; i -= 1) {
      const now = new Date();
      const day = new Date(now.getTime() - i * 24 * 60 * 60 * 1000);
      dayKeys.push(getBrazilCheckinDateKey(day));
    }

    const totalsByDay = new Map(dayKeys.map((key) => [key, 0]));
    dailyRows.forEach((row) => {
      if (!row?.paid_at) return;
      const paidAt = new Date(`${row.paid_at}Z`);
      const key = getBrazilCheckinDateKey(paidAt);
      if (!totalsByDay.has(key)) return;
      totalsByDay.set(key, totalsByDay.get(key) + Number(row.amount_usd || 0));
    });

    const dailyTotals = dayKeys.map((key) => {
      const totalUsd = totalsByDay.get(key) || 0;
      const dateObj = new Date(`${key}T00:00:00Z`);
      const label = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return { day: key, label, totalUsd };
    });

    res.json({
      ok: true,
      earnings,
      totalUsd: totalEarnings,
      totalUsdc: totalEarnings,
      dailyTotals
    });
  } catch (error) {
    console.error('Error fetching earnings:', error);
    res.status(500).json({ ok: false, message: 'Server error' });
  }
}

// GET /ptp-promo/:hash
async function viewPromoPage(req, res) {
  try {
    const { hash } = req.params;

    const ad = await get(
      "SELECT id, title, url, status FROM ptp_ads WHERE hash = ?",
      [hash]
    );

    if (!ad || ad.status !== "active") {
      return res.status(404).send("Ad not found");
    }

    const safeTitle = String(ad.title || "Anuncio").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeUrl = String(ad.url || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle} | PTP</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #0b1226; color: #e6eefc; }
          .wrap { min-height: 100vh; display: flex; flex-direction: column; }
          .navbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: #111a33; border-bottom: 1px solid rgba(255,255,255,0.08); gap: 12px; }
          .title { font-size: 16px; font-weight: 700; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .timer { font-size: 14px; color: #9fb0c9; }
          .done { color: #4cc182; font-weight: 700; }
          .frame { flex: 1; border: 0; width: 100%; background: #000; min-height: 70vh; }
          @media (max-width: 720px) {
            .title { font-size: 14px; }
            .timer { font-size: 13px; }
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <header class="navbar">
            <div class="title">${safeTitle}</div>
            <div class="timer" id="timerText">Wait <span id="countdown">5</span>s to count.</div>
            <div class="timer done" id="done" style="display:none;">View counted.</div>
          </header>
          <iframe class="frame" src="${safeUrl}" title="${safeTitle}" sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
        </div>
        <script>
          (function () {
            const countdownEl = document.getElementById("countdown");
            const doneEl = document.getElementById("done");
            let remaining = 5;
            const viewerHash = localStorage.getItem('viewer_hash') || '${crypto.randomBytes(8).toString('hex')}';
            localStorage.setItem('viewer_hash', viewerHash);

            const tick = () => {
              remaining -= 1;
              if (remaining <= 0) {
                countdownEl.textContent = "0";
                fetch("/api/ptp/track-view", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ adId: ${ad.id}, viewerHash })
                }).finally(() => {
                  const timerText = document.getElementById("timerText");
                  if (timerText) timerText.style.display = "none";
                  doneEl.style.display = "block";
                });
                clearInterval(timerId);
                return;
              }
              countdownEl.textContent = String(remaining);
            };

            const timerId = setInterval(tick, 1000);
          })();
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Error viewing promo:", error);
    res.status(500).send("Error");
  }
}

// GET /ptp/promote-:userId
async function viewPromotePage(req, res) {
  try {
    const userId = Number(req.params.userId);
    if (!Number.isFinite(userId) || userId <= 0) {
      return res.status(404).send("Ad not found");
    }

    let ad = await pickPromoteAd(userId, false);
    if (!ad) {
      ad = await pickPromoteAd(userId, true);
    }
    if (!ad) {
      return res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0" />
          <title>PTP | No Ads</title>
          <style>
            body { margin: 0; font-family: Arial, sans-serif; background: #0b1226; color: #e6eefc; }
            .wrap { min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 24px; }
            .card { max-width: 520px; width: 100%; background: #111a33; border: 1px solid rgba(255,255,255,0.08); border-radius: 12px; padding: 24px; text-align: center; }
            .title { font-size: 20px; font-weight: 700; margin-bottom: 12px; }
            .desc { color: #9fb0c9; margin-bottom: 16px; }
            .btn { display: inline-block; padding: 10px 16px; background: #2a56ff; color: #fff; text-decoration: none; border-radius: 8px; font-weight: 600; }
          </style>
        </head>
        <body>
          <div class="wrap">
            <div class="card">
              <div class="title">Nenhum anuncio disponivel</div>
              <div class="desc">No momento nao ha anuncios ativos para promover. Tente novamente em alguns minutos.</div>
              <a class="btn" href="/ptp">Voltar ao PTP</a>
            </div>
          </div>
        </body>
        </html>
      `);
    }

    const safeTitle = String(ad.title || "Anuncio").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const safeUrl = String(ad.url || "").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>${safeTitle} | PTP</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #0b1226; color: #e6eefc; }
          .wrap { min-height: 100vh; display: flex; flex-direction: column; }
          .navbar { display: flex; align-items: center; justify-content: space-between; padding: 14px 18px; background: #111a33; border-bottom: 1px solid rgba(255,255,255,0.08); gap: 12px; }
          .title { font-size: 16px; font-weight: 700; margin: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
          .timer { font-size: 14px; color: #9fb0c9; }
          .done { color: #4cc182; font-weight: 700; }
          .frame { flex: 1; border: 0; width: 100%; background: #000; min-height: 70vh; }
          @media (max-width: 720px) {
            .title { font-size: 14px; }
            .timer { font-size: 13px; }
          }
        </style>
      </head>
      <body>
        <div class="wrap">
          <header class="navbar">
            <div class="title">${safeTitle}</div>
            <div class="timer" id="timerText">Wait <span id="countdown">5</span>s to count.</div>
            <div class="timer done" id="done" style="display:none;">View counted.</div>
          </header>
          <iframe class="frame" src="${safeUrl}" title="${safeTitle}" sandbox="allow-scripts allow-forms allow-same-origin"></iframe>
        </div>
        <script>
          (function () {
            const countdownEl = document.getElementById("countdown");
            const doneEl = document.getElementById("done");
            let remaining = 5;
            const viewerHash = localStorage.getItem('viewer_hash') || '${crypto.randomBytes(8).toString('hex')}';
            localStorage.setItem('viewer_hash', viewerHash);

            const tick = () => {
              remaining -= 1;
              if (remaining <= 0) {
                countdownEl.textContent = "0";
                fetch("/api/ptp/track-view", {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ adId: ${ad.id}, viewerHash, promoterId: ${userId} })
                }).finally(() => {
                  const timerText = document.getElementById("timerText");
                  if (timerText) timerText.style.display = "none";
                  doneEl.style.display = "block";
                });
                clearInterval(timerId);
                return;
              }
              countdownEl.textContent = String(remaining);
            };

            const timerId = setInterval(tick, 1000);
          })();
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Error viewing promote:", error);
    res.status(500).send("Error");
  }
}

module.exports = {
  createAd,
  getMyAds,
  getPromoHash,
  trackView,
  getEarnings,
  viewPromoPage,
  viewPromotePage
};

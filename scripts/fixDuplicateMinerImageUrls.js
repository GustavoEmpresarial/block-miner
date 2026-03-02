const sqlite3 = require("sqlite3").verbose();

const DB_PATH = "data/blockminer.db";
const FALLBACK_CANDIDATES = [
  "/assets/machines/reward2.png",
  "/assets/machines/reward3.png",
  "/assets/machines/1.png",
  "/assets/machines/2.png",
  "/assets/machines/3.png"
];

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
      if (error) reject(error);
      else resolve(rows || []);
    });
  });
}

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function onRun(error) {
      if (error) reject(error);
      else resolve(this);
    });
  });
}

async function main() {
  const db = new sqlite3.Database(DB_PATH);

  try {
    const miners = await all(
      db,
      "SELECT id, name, image_url FROM miners ORDER BY id ASC"
    );

    if (!miners.length) {
      console.log("No miners found.");
      db.close();
      return;
    }

    const byUrl = new Map();
    const usedUrls = new Set();

    for (const miner of miners) {
      const imageUrl = String(miner.image_url || "").trim();
      if (!imageUrl) continue;
      usedUrls.add(imageUrl);
      if (!byUrl.has(imageUrl)) byUrl.set(imageUrl, []);
      byUrl.get(imageUrl).push(miner);
    }

    const updates = [];

    for (const [, grouped] of byUrl) {
      if (grouped.length <= 1) continue;

      for (let index = 1; index < grouped.length; index += 1) {
        const miner = grouped[index];
        const currentUrl = String(miner.image_url || "").trim();

        let replacement = null;
        for (const candidate of FALLBACK_CANDIDATES) {
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
      console.log("No duplicate image URLs detected.");
      db.close();
      return;
    }

    await run(db, "BEGIN TRANSACTION");
    for (const change of updates) {
      await run(
        db,
        "UPDATE miners SET image_url = ? WHERE id = ?",
        [change.to, change.id]
      );
    }
    await run(db, "COMMIT");

    console.log(`Updated ${updates.length} miner(s):`);
    for (const change of updates) {
      console.log(
        `- #${change.id} ${change.name}: ${change.from} -> ${change.to || "(null)"}`
      );
    }
  } catch (error) {
    try {
      await run(db, "ROLLBACK");
    } catch {
    }
    console.error(`Failed to fix duplicate image URLs: ${error.message}`);
    process.exitCode = 1;
  } finally {
    db.close();
  }
}

main();

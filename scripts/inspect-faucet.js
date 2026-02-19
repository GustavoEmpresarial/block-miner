const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("data/blockminer.db");

db.serialize(() => {
  db.all(
    "SELECT id, name, slug, image_url FROM miners WHERE slug = ? OR name = ?",
    ["faucet-1ghs", "Faucet Miner"],
    (err, rows) => {
      if (err) {
        console.error("miners query error:", err);
        return;
      }
      console.log("miners:", rows);
    }
  );

  db.all(
    "SELECT id, user_id, miner_id, miner_name FROM user_inventory WHERE LOWER(miner_name) = LOWER(?)",
    ["Faucet Miner"],
    (err, rows) => {
      if (err) {
        console.error("inventory query error:", err);
        return;
      }
      console.log("inventory:", rows);
    }
  );
});

db.close();

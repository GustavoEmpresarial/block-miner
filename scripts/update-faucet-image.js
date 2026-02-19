const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("data/blockminer.db");

const imageUrl = "/assets/machines/reward1.png";

db.serialize(() => {
  db.run(
    "UPDATE miners SET image_url = ? WHERE slug = ? OR name = ?",
    [imageUrl, "faucet-1ghs", "Faucet Miner"]
  );
});

db.close();

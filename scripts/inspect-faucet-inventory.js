const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("data/blockminer.db");

db.serialize(() => {
  db.all(
    "SELECT id, user_id, miner_id, miner_name, hash_rate FROM user_inventory WHERE hash_rate = 1",
    [],
    (err, rows) => {
      if (err) {
        console.error("inventory query error:", err);
        return;
      }
      console.log("inventory hash_rate=1:", rows);
    }
  );
});

db.close();

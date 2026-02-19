const sqlite3 = require("sqlite3").verbose();

const db = new sqlite3.Database("data/blockminer.db");

const statements = [
  "DELETE FROM ptp_views",
  "DELETE FROM ptp_earnings",
  "DELETE FROM ptp_ads",
  "DELETE FROM sqlite_sequence WHERE name IN ('ptp_ads','ptp_views','ptp_earnings')"
];

db.serialize(() => {
  statements.forEach((sql) => db.run(sql));
});

db.close();

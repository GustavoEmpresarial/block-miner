const { db, run, get } = require("../src/db/sqlite");

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(rows || []);
    });
  });
}

module.exports = {
  db,
  run,
  get,
  all
};

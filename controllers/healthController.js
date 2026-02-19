function createHealthController() {
  function health(_req, res) {
    res.json({ ok: true, message: "BlockMiner online" });
  }

  return {
    health
  };
}

module.exports = {
  createHealthController
};

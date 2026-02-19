function createMachinesDeprecatedController() {
  async function addMachine(_req, res) {
    res.status(410).json({ ok: false, message: "Use the inventory to install miners." });
  }

  async function purchaseMachine(_req, res) {
    res.status(410).json({ ok: false, message: "Direct purchase disabled. Use the shop and inventory." });
  }

  return {
    addMachine,
    purchaseMachine
  };
}

module.exports = {
  createMachinesDeprecatedController
};

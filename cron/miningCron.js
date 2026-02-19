const DEFAULT_TICK_MS = 1000;
const DEFAULT_PERSIST_MS = 15000;

function startMiningLoop({ engine, io, persistMinerProfile, buildPublicState }, options = {}) {
  const tickMs = Number(options.tickMs || DEFAULT_TICK_MS);
  const persistMs = Number(options.persistMs || DEFAULT_PERSIST_MS);

  const tick = async () => {
    engine.tick();
    if (buildPublicState) {
      const state = await buildPublicState();
      io.emit("state:update", state);
      return;
    }
    io.emit("state:update", engine.getPublicState());
  };

  tick();
  const tickTimer = setInterval(() => {
    tick().catch((error) => {
      console.error("Mining tick error:", error);
    });
  }, tickMs);

  const persist = async () => {
    const saves = [...engine.miners.values()].map((miner) => persistMinerProfile(miner));
    await Promise.allSettled(saves);
  };

  const persistTimer = setInterval(persist, persistMs);

  return { tickTimer, persistTimer };
}

module.exports = {
  startMiningLoop
};

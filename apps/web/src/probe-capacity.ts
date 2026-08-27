const WORKER_CAP = 4;

const GIB_PER_WORKER = 1.5;

const probeCapacity = () => {
  const cores = navigator.hardwareConcurrency || 4;
  const reported: unknown = "deviceMemory" in navigator ? navigator.deviceMemory : undefined;
  const budget = typeof reported === "number" ? reported : 4;

  const byCores = cores - 2;
  const byMemory = Math.floor(budget / GIB_PER_WORKER);

  return { maxWorkers: Math.min(Math.max(Math.min(byCores, byMemory), 1), WORKER_CAP) };
};

export { probeCapacity, WORKER_CAP };

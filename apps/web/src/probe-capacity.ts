// Every worker holds pdf.js, a Tesseract worker per language and page-sized canvases,
// so workerpool's default of one per core runs a laptop out of memory.
const WORKER_CAP = 4;

const GIB_PER_WORKER = 1.5;

// hardwareConcurrency is the only figure every browser reports. deviceMemory is
// Chromium-only, rounded down and capped at 8, and WebGPU never exposes VRAM at all,
// so this reads a tier rather than a budget and the pool corrects itself from there.
const probeCapacity = (): { maxWorkers: number } => {
  const cores = navigator.hardwareConcurrency || 4;
  const reported: unknown = Reflect.get(navigator, "deviceMemory");
  const budget = typeof reported === "number" ? reported : 4;

  // Two cores held back: one for the model worker, one for the page itself.
  const byCores = cores - 2;
  const byMemory = Math.floor(budget / GIB_PER_WORKER);

  return { maxWorkers: Math.min(Math.max(Math.min(byCores, byMemory), 1), WORKER_CAP) };
};

export { probeCapacity, WORKER_CAP };

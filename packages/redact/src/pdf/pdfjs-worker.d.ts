// pdf.js ships no types for its worker module; importing it registers globalThis.pdfjsWorker.
declare const WorkerMessageHandler: unknown;

export { WorkerMessageHandler };

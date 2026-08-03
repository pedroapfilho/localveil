type CanvasEntry = {
  canvas: OffscreenCanvas | null;
  context: OffscreenCanvasRenderingContext2D | null;
};

class OffscreenCanvasFactory {
  create(width: number, height: number): CanvasEntry {
    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }

    const canvas = new OffscreenCanvas(width, height);

    return { canvas, context: canvas.getContext("2d", { willReadFrequently: true }) };
  }

  reset(entry: CanvasEntry, width: number, height: number) {
    if (entry.canvas === null) {
      throw new Error("Canvas is not specified");
    }

    if (width <= 0 || height <= 0) {
      throw new Error("Invalid canvas size");
    }

    entry.canvas.width = width;
    entry.canvas.height = height;
  }

  destroy(entry: CanvasEntry) {
    if (entry.canvas === null) {
      throw new Error("Canvas is not specified");
    }

    entry.canvas.width = 0;
    entry.canvas.height = 0;
    entry.canvas = null;
    entry.context = null;
  }
}

export { OffscreenCanvasFactory };
export type { CanvasEntry };

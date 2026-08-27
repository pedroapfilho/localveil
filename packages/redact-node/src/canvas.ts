import { createCanvas, DOMMatrix, Image, ImageData, Path2D } from "@napi-rs/canvas";

type ConvertToBlobOptions = { quality?: number; type?: string };

const createNodeCanvas = (width: number, height: number) => {
  const canvas = createCanvas(width, height);

  const encode = canvas.convertToBlob.bind(canvas);

  return Object.assign(canvas, {
    async convertToBlob(options: ConvertToBlobOptions = {}) {
      const encoded = await encode({ mime: options.type ?? "image/png", quality: options.quality });

      return encoded;
    },

    *[Symbol.iterator]() {
      yield* canvas.toBuffer("image/png");
    },
  });
};

// oxlint-disable-next-line anti-slop/no-unknown-parameters -- `this` is annotated only so the shim can be new-called as the global OffscreenCanvas; the body ignores it
function NodeOffscreenCanvas(this: unknown, width: number, height: number) {
  return createNodeCanvas(width, height);
}

const createNodeImageBitmap = async (source: Blob) => {
  const image = new Image();

  image.src = new Uint8Array(await source.arrayBuffer());

  return Object.assign(image, { close: () => undefined });
};

let installed = false;

const installCanvas = () => {
  if (installed) {
    return;
  }

  installed = true;

  Object.assign(globalThis, {
    createImageBitmap: createNodeImageBitmap,

    DOMMatrix,
    ImageData,
    OffscreenCanvas: NodeOffscreenCanvas,
    Path2D,
  });
};

export { createNodeCanvas, installCanvas };

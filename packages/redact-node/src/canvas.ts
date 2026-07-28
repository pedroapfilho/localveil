import { createCanvas, DOMMatrix, Image, ImageData, Path2D } from "@napi-rs/canvas";

type ConvertToBlobOptions = { quality?: number; type?: string };

// skia type-checks `drawImage` natively and takes nothing but a canvas or an image it
// made itself, so the surface handed back here has to be a real one. An object holding
// a canvas is refused, and so is a subclass: a napi-rs constructor returns the native
// object it wrapped, which leaves the subclass prototype out of the chain and its
// methods unreachable. What works is the native canvas with the two browser-only
// methods hung off it as own properties.
//
// pdf.js asks its CanvasFactory for a scratch surface only when an image has to shrink
// by more than half, so getting this wrong throws on every PDF carrying a photo while a
// text-only one renders perfectly.
const createNodeCanvas = (width: number, height: number) => {
  const canvas = createCanvas(width, height);
  // Taken before the assignment below shadows it, which is also what keeps
  // `convertToBlob` from calling itself.
  const encode = canvas.convertToBlob.bind(canvas);

  return Object.assign(canvas, {
    // skia calls the format `mime`, the canvas API the redactors are written against
    // calls it `type`, and an unrecognised key quietly falls back to PNG. Renaming it
    // is the difference between a redacted JPEG and a JPEG that is really a PNG.
    async convertToBlob(options: ConvertToBlobOptions = {}) {
      const encoded = await encode({ mime: options.type ?? "image/png", quality: options.quality });

      return encoded;
    },

    // tesseract.js resolves its node image loader statically, and it ends in
    // `new Uint8Array(image)` with no branch for a canvas. A byte iterator is the one
    // shape that call reads.
    *[Symbol.iterator]() {
      yield* canvas.toBuffer("image/png");
    },
  });
};

// A declaration rather than the arrow functions used everywhere else: all three
// redactors ask for a surface with `new OffscreenCanvas(width, height)`, and an arrow
// cannot be constructed.
function NodeOffscreenCanvas(this: unknown, width: number, height: number) {
  return createNodeCanvas(width, height);
}

const createNodeImageBitmap = async (source: Blob) => {
  const image = new Image();

  image.src = new Uint8Array(await source.arrayBuffer());

  // An ImageBitmap owns memory its holder is expected to hand back; a decoded skia
  // image is collected like any other object, so there is nothing for close to do.
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
    // pdf.js builds its clips and transforms out of these three, and node has none.
    DOMMatrix,
    ImageData,
    OffscreenCanvas: NodeOffscreenCanvas,
    Path2D,
  });
};

export { createNodeCanvas, installCanvas };

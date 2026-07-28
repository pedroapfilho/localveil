import { createCanvas, DOMMatrix, Image, ImageData, Path2D } from "@napi-rs/canvas";

type ConvertToBlobOptions = { quality?: number; type?: string };

// skia type-checks `drawImage` natively and takes nothing but a canvas or an image it
// made itself, so the surface handed back here has to be a real one. An object holding
// a canvas is refused, and so is a subclass: a napi-rs constructor returns the native
// object it wrapped, which leaves the subclass prototype out of the chain and its
// methods unreachable. What works is the native canvas with the two browser-only
// methods hung off it as own properties.
//
// This is not cosmetic. pdf.js asks its CanvasFactory for a scratch surface whenever
// an image has to shrink by more than half, draws the decoded image onto it, then
// draws that surface onto the page. Get it wrong and every PDF carrying a photo throws
// while a text-only one renders perfectly, which is how it got past the first round.
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

    // tesseract.js picks its image loader at resolution time, and the node one ends in
    // `new Uint8Array(image)` with no branch for a canvas: only the browser loader
    // knows to call `convertToBlob` first. An iterator over the encoded page is the one
    // shape that call reads, so this is how a rendered PDF page reaches the recogniser
    // without redact-pdf having to know which runtime it is in.
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

// Installed once at the edge rather than branched on inside each redactor: the
// redactors are written against the browser canvas and stay that way.
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

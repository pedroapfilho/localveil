import { describe, expect, it } from "vitest";

import { OffscreenCanvasFactory } from "./canvas-factory.ts";
import { NoFilterFactory } from "./filter-factory.ts";

import { documentOptions } from "./index.ts";

const options = documentOptions(new Uint8Array([1, 2, 3]));

describe("documentOptions", () => {
  it("draws glyph outlines rather than asking for a font face there is no document to hold", () => {
    expect(options.disableFontFace).toBe(true);
  });

  it("brings its own canvas factory, since pdf.js reaches for document.createElement", () => {
    expect(options.CanvasFactory).toBe(OffscreenCanvasFactory);
  });

  it("brings its own filter factory, which would otherwise append SVG to a body", () => {
    expect(options.FilterFactory).toBe(NoFilterFactory);
  });

  it("passes the bytes through untouched", () => {
    expect(options.data).toEqual(new Uint8Array([1, 2, 3]));
  });
});

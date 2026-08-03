import { documentOptions } from "@repo/redact-pdf";
import { describe, expect, it } from "vitest";

import { createNodeCanvas, installCanvas } from "./canvas.ts";

const PNG_MAGIC = new Uint8Array([137, 80, 78, 71]);

const filled = (width: number, height: number) => {
  const canvas = createNodeCanvas(width, height);
  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);

  return canvas;
};

installCanvas();

describe("installCanvas", () => {
  it("gives a process with no browser in it the drawing surfaces the redactors expect", () => {
    expect(typeof globalThis.OffscreenCanvas).toBe("function");
    expect(typeof globalThis.createImageBitmap).toBe("function");
  });

  it("gives pdf.js the geometry classes it builds clips and transforms out of", () => {
    expect(typeof globalThis.DOMMatrix).toBe("function");
    expect(typeof globalThis.Path2D).toBe("function");
    expect(typeof globalThis.ImageData).toBe("function");
  });

  it("decodes a bitmap a redactor can draw and then close", async () => {
    const png = await filled(30, 20).convertToBlob({ type: "image/png" });
    const bitmap = await createImageBitmap(png);

    expect(bitmap.width).toBe(30);
    expect(bitmap.height).toBe(20);

    bitmap.close();
  });

  it("hands pdf.js a scratch surface its own drawImage will take", () => {
    const factory = new (documentOptions(new Uint8Array()).CanvasFactory)();
    const scratch = factory.create(16, 16).canvas;
    const page = new OffscreenCanvas(64, 64).getContext("2d");

    if (page === null || scratch === null) {
      throw new Error("The installed canvas gave back nothing to draw on");
    }

    expect(() => {
      page.drawImage(scratch, 0, 0);
    }).not.toThrow();
  });
});

describe("createNodeCanvas", () => {
  it("hands back a 2d context that paints", () => {
    const canvas = filled(10, 10);

    expect(canvas.getContext("2d")).not.toBeNull();
    expect(canvas.width).toBe(10);
  });

  it("resizes the surface underneath it, which is how pdf.js recycles a canvas", () => {
    const canvas = filled(10, 10);

    canvas.width = 40;
    canvas.height = 25;

    expect(canvas.width).toBe(40);
    expect(canvas.height).toBe(25);
  });

  it("encodes the image type it was asked for rather than always a PNG", async () => {
    const canvas = filled(20, 20);

    await expect(canvas.convertToBlob({ type: "image/jpeg" })).resolves.toHaveProperty(
      "type",
      "image/jpeg",
    );
    await expect(canvas.convertToBlob({ type: "image/png" })).resolves.toHaveProperty(
      "type",
      "image/png",
    );
  });

  it("defaults to a PNG when nobody says which type they want", async () => {
    await expect(filled(20, 20).convertToBlob()).resolves.toHaveProperty("type", "image/png");
  });

  it("spells itself out as a PNG for a recogniser that only reads bytes", () => {
    const bytes = new Uint8Array(filled(20, 20));

    expect(bytes.slice(0, 4)).toEqual(PNG_MAGIC);
  });
});

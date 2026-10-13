import { readFile } from "node:fs/promises";

type FontRequest = { filename: string };

class StandardFontFactory {
  async fetch({ filename }: FontRequest) {
    return new Uint8Array(
      await readFile(
        new URL(`../node_modules/pdfjs-dist/standard_fonts/${filename}`, import.meta.url),
      ),
    );
  }
}

export { StandardFontFactory };

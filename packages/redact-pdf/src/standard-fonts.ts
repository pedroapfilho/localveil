type FontRequest = { filename: string };

class StandardFontFactory {
  async fetch({ filename }: FontRequest) {
    const response = await fetch(
      new URL(`../node_modules/pdfjs-dist/standard_fonts/${filename}`, import.meta.url),
    );

    if (!response.ok) {
      throw new Error(`Could not load the standard font ${filename}`);
    }

    return new Uint8Array(await response.arrayBuffer());
  }
}

export { StandardFontFactory };

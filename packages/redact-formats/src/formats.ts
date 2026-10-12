type Format = {
  // A file read off a disk carries no type, so each extension names the type it implies.
  extensions: Readonly<Record<string, string>>;
  mimeTypes: ReadonlyArray<string>;
  redactor: string;
};

const FORMATS = [
  {
    extensions: {
      ".csv": "text/csv",
      ".json": "application/json",
      ".log": "text/plain",
      ".md": "text/markdown",
      ".txt": "text/plain",
    },
    mimeTypes: ["text/*", "application/json"],
    redactor: "text",
  },
  {
    extensions: { ".pdf": "application/pdf" },
    mimeTypes: ["application/pdf"],
    redactor: "pdf",
  },
  {
    extensions: {
      ".avif": "image/avif",
      ".bmp": "image/bmp",
      ".gif": "image/gif",
      ".heic": "image/heic",
      ".jpeg": "image/jpeg",
      ".jpg": "image/jpeg",
      ".png": "image/png",
      ".tif": "image/tiff",
      ".tiff": "image/tiff",
      ".webp": "image/webp",
    },
    mimeTypes: ["image/*"],
    redactor: "image",
  },
] as const satisfies ReadonlyArray<Format>;

type RedactorName = (typeof FORMATS)[number]["redactor"];

/* Under Node, createImageBitmap is @napi-rs/canvas, which has no HEIC or TIFF decoder, so the CLI
   leaves both out. The web keeps them because Safari decodes them; Chromium and Firefox reject them
   at createImageBitmap and the file fails there. */
const UNDECODABLE_IN_NODE = new Set([".heic", ".tif", ".tiff"]);

const extensionOf = (name: string) => {
  const dot = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot).toLowerCase() : "";
};

const typeMatches = (pattern: string, type: string) =>
  pattern.endsWith("/*") ? type.startsWith(pattern.slice(0, -1)) : type === pattern;

const accepts = ({ extensions, mimeTypes }: Format, file: File) =>
  mimeTypes.some((pattern) => typeMatches(pattern, file.type)) ||
  Object.hasOwn(extensions, extensionOf(file.name));

const redactorFor = (file: File): RedactorName | undefined =>
  FORMATS.find((format) => accepts(format, file))?.redactor;

const BROWSER_ACCEPT = FORMATS.flatMap(({ extensions, mimeTypes }) => [
  ...Object.keys(extensions),
  ...mimeTypes,
]).join(",");

const NODE_FORMATS: ReadonlyMap<string, string> = new Map(
  FORMATS.flatMap(({ extensions }) => Object.entries(extensions)).filter(
    ([extension]) => !UNDECODABLE_IN_NODE.has(extension),
  ),
);

export { BROWSER_ACCEPT, NODE_FORMATS, redactorFor };
export type { RedactorName };

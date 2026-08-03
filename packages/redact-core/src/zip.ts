import { zip } from "fflate";

type ZipEntry = { blob: Blob; name: string };

const splitExtension = (name: string) => {
  const dot = name.lastIndexOf(".");

  if (dot <= 0) {
    return { base: name, extension: "" };
  }

  return { base: name.slice(0, dot), extension: name.slice(dot) };
};

const uniqueFilename = (name: string, taken: Set<string>): string => {
  if (!taken.has(name)) {
    return name;
  }

  const { base, extension } = splitExtension(name);
  let counter = 2;

  while (taken.has(`${base} (${counter})${extension}`)) {
    counter += 1;
  }

  return `${base} (${counter})${extension}`;
};

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer => {
  const { buffer, byteLength, byteOffset } = bytes;

  if (buffer instanceof ArrayBuffer && byteOffset === 0 && byteLength === buffer.byteLength) {
    return buffer;
  }

  return new Uint8Array(bytes).buffer;
};

const buildZip = async (files: Array<ZipEntry>): Promise<Blob> => {
  if (files.length === 0) {
    throw new RangeError("Cannot build an archive with no files");
  }

  const taken = new Set<string>();

  const named = files.map((file) => {
    const name = uniqueFilename(file.name, taken);

    taken.add(name);

    return { blob: file.blob, name };
  });

  const entries = await Promise.all(
    named.map(async (file) => {
      const bytes = new Uint8Array(await file.blob.arrayBuffer());

      return [file.name, bytes] as const;
    }),
  );

  const contents = Object.fromEntries(entries);

  const bytes = await new Promise<Uint8Array>((resolve, reject) => {
    zip(contents, { level: 6 }, (error, data) => {
      if (error) {
        reject(error);
        return;
      }

      resolve(data);
    });
  });

  return new Blob([toArrayBuffer(bytes)], { type: "application/zip" });
};

export { buildZip, toArrayBuffer, uniqueFilename };
export type { ZipEntry };

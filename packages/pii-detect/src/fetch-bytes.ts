const readBytes = async (
  response: Response,
  onProgress: (fraction: number) => void,
): Promise<Uint8Array> => {
  if (!response.ok) {
    throw new Error(`The model download answered ${String(response.status)}`);
  }

  const total = Number(response.headers.get("content-length") ?? 0);
  const body = response.body;

  if (body === null) {
    const bytes = new Uint8Array(await response.arrayBuffer());

    onProgress(1);

    return bytes;
  }

  const reader = body.getReader();
  const parts: Array<Uint8Array> = [];
  let loaded = 0;

  // oxlint-disable-next-line eslint/no-await-in-loop, react-doctor/async-await-in-loop
  for (let step = await reader.read(); !step.done; step = await reader.read()) {
    parts.push(step.value);
    loaded += step.value.length;

    if (total > 0) {
      onProgress(Math.min(loaded / total, 1));
    }
  }

  const bytes = new Uint8Array(loaded);
  let at = 0;

  for (const part of parts) {
    bytes.set(part, at);
    at += part.length;
  }

  onProgress(1);

  return bytes;
};

export { readBytes };

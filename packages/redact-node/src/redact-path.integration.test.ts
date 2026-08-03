import type { Detect } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import { redactPath } from "./redact-path.ts";

const FIXTURES = new URL("../../../fixtures/", import.meta.url).pathname;
const IDENTITY_CARD = new URL("../fixtures/identity-card.pdf", import.meta.url).pathname;

const PNG_MAGIC = new Uint8Array([137, 80, 78, 71]);

const tagging =
  (target: string): Detect =>
  (text) => {
    const spans = [];

    for (let start = text.indexOf(target); start !== -1; start = text.indexOf(target, start + 1)) {
      spans.push({
        end: start + target.length,
        label: "private_person" as const,
        score: 0.9,
        start,
      });
    }

    return Promise.resolve(spans);
  };

describe.skipIf(process.env.OCR_PIPELINE_TEST === undefined)(
  "redactPath against a real canvas and recogniser",
  () => {
    it("rebuilds a PDF with the name covered", async () => {
      const { bytes, redactionCount } = await redactPath(
        `${FIXTURES}sample.pdf`,
        tagging("John"),
        () => undefined,
      );

      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      expect(redactionCount).toBeGreaterThan(0);
    }, 600_000);

    it("covers a word that exists only inside an image on the page", async () => {
      const { bytes, redactionCount } = await redactPath(
        IDENTITY_CARD,
        tagging("Registro"),
        () => undefined,
      );

      expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
      expect(redactionCount).toBeGreaterThan(0);
    }, 600_000);

    it("paints over the name in an image", async () => {
      const { bytes, redactionCount } = await redactPath(
        `${FIXTURES}sample.png`,
        tagging("John"),
        () => undefined,
      );

      expect(bytes.slice(0, 4)).toEqual(PNG_MAGIC);
      expect(redactionCount).toBeGreaterThan(0);
    }, 600_000);
  },
);

import { describe, expect, it } from "vitest";

import { createDetector } from "./detector.ts";

// Downloads ~809 MB of weights, so it stays out of the default run.
describe.skipIf(process.env.PII_MODEL_TEST === undefined)(
  "createDetector against the real model",
  () => {
    it("finds a person and an email in one sentence", async () => {
      const detect = await createDetector();
      const spans = await detect("Contact John Smith at john@example.com");

      expect(spans.map((span) => span.label)).toContain("private_person");
      expect(spans.map((span) => span.label)).toContain("private_email");
    }, 600_000);
  },
);

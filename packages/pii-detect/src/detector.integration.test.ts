import { describe, expect, it } from "vitest";

import { createDetector } from "./detector.ts";

// Downloads ~349 MB of weights, so it stays out of the default run.
describe.skipIf(process.env.PII_MODEL_TEST === undefined)(
  "createDetector against the real model",
  () => {
    it("finds a person and an email in one sentence", async () => {
      const detect = await createDetector();
      const spans = await detect("Contact John Smith at john@example.com");

      expect(spans.map((span) => span.label)).toContain("private_person");
      expect(spans.map((span) => span.label)).toContain("private_email");
    }, 600_000);

    // The reason this model was chosen: Portuguese is in its training languages,
    // and Brazilian documents are the primary real input.
    it("finds Brazilian PII in Portuguese text", async () => {
      const detect = await createDetector();
      const spans = await detect(
        "O motorista José da Silva, nascido em 12/03/1985, mora na Rua das Flores 123, São Paulo. Telefone (11) 98765-4321.",
      );

      expect(spans.map((span) => span.label)).toContain("private_person");
      expect(spans.map((span) => span.label)).toContain("private_phone");
    }, 600_000);
  },
);

import { describe, expect, it } from "vitest";

import { MODELS } from "./catalog";
import { createDetector } from "./detector";

describe.skipIf(process.env.PII_MODEL_TEST === undefined)(
  "createDetector against the real model",
  () => {
    it("finds Brazilian PII in Portuguese text", async () => {
      const detect = await createDetector();
      const spans = await detect(
        "O motorista José da Silva, nascido em 12/03/1985, mora na Rua das Flores 123, São Paulo. Telefone (11) 98765-4321.",
      );

      expect(spans.map((span) => span.label)).toContain("private_person");
      expect(spans.map((span) => span.label)).toContain("private_phone");
    }, 600_000);

    // Every catalogued model, span-level and token-level alike, has to clear the plainest case.
    it.each(MODELS.map((model) => [model.id, model.id] as const))(
      "finds a person and an email in one sentence with %s",
      async (_name, model) => {
        const detect = await createDetector({ model });
        const spans = await detect("Contact John Smith at john@example.com");

        expect(spans.map((span) => span.label)).toContain("private_person");
        expect(spans.map((span) => span.label)).toContain("private_email");
      },
      600_000,
    );
  },
);

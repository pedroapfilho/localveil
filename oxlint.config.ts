import { defineConfig } from "oxlint";
import awesomeness from "oxlint-config-awesomeness";

export default defineConfig({
  extends: [awesomeness],
  jsPlugins: ["@shadcn/lint"],
  overrides: [
    {
      files: ["packages/ui/src/lib/utils.test.ts"],
      rules: { "shadcn/no-unknown-classes": ["error", { allow: ["foo", "bar", "baz"] }] },
    },
    {
      files: ["packages/ui/src/components/**"],
      rules: {
        "shadcn/no-restyle": "off",
        "shadcn/require-static-classes": "off",
      },
    },
    {
      files: ["**/__tests__/**/*.ts", "**/__tests__/**/*.tsx", "**/*.test.ts", "**/*.test.tsx"],
      rules: {
        "number-literal-case": "off",
      },
    },
  ],
  rules: {
    "shadcn/no-restyle": [
      "error",
      {
        allow: ["layout"],
        contracts: [
          { allow: ["layout", "gap-*"], pattern: "^PopoverContent$" },
          { allow: ["layout", "spacing", "scroll-fade", "no-scrollbar"], pattern: "^ScrollArea$" },
          { allow: ["layout", "gap-*", "text-pretty"], pattern: "^AttachmentDescription$" },
        ],
      },
    ],
    "shadcn/no-unknown-classes": "error",
    "shadcn/require-static-classes": "error",
  },
  settings: { shadcn: { ui: "@repo/ui/components" } },
});

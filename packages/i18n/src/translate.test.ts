import { describe, expect, it } from "vitest";

import { translate } from "./translate";

const messages = {
  greeting: "Hello {name}, you have {count} files",
  plain: "Nothing to fill in",
};

describe("translate", () => {
  it("returns a message with no placeholders untouched", () => {
    expect(translate(messages, "plain")).toBe("Nothing to fill in");
  });

  it("fills every placeholder, numbers included", () => {
    expect(translate(messages, "greeting", { count: 3, name: "Ana" })).toBe(
      "Hello Ana, you have 3 files",
    );
  });

  it("throws on a key the catalogue does not have", () => {
    expect(() => translate(messages, "missing")).toThrow('No translation for "missing"');
  });

  it("throws when a placeholder has no value rather than rendering it raw", () => {
    expect(() => translate(messages, "greeting", { name: "Ana" })).toThrow(
      'Translation "greeting" needs a value for "count"',
    );
  });

  it("does not read inherited properties as translations", () => {
    expect(() => translate(messages, "toString")).toThrow('No translation for "toString"');
  });
});

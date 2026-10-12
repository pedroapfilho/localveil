import { assert, describe, expect, it, vi } from "vitest";

import type { AnalysedReading } from "./analysis";
import { analyseUnits, isAnalysedReading, keptSpans, redactionCount } from "./analysis";
import type { Decisions, Detect, Detection, PiiLabel, Span } from "./types";

type Tag = { from?: number; label?: PiiLabel; score?: number };

const spanOver = (
  text: string,
  value: string,
  { from = 0, label = "private_person", score = 0.9 }: Tag = {},
): Span => {
  const start = text.indexOf(value, from);

  assert.isAtLeast(start, 0, `"${value}" does not occur in "${text}"`);

  return { end: start + value.length, label, score, start };
};

const tagging =
  (...values: Array<string>): Detect =>
  (text) =>
    Promise.resolve(
      values.filter((value) => text.includes(value)).map((value) => spanOver(text, value)),
    );

const taggingEvery =
  (...values: Array<string>): Detect =>
  (text) =>
    Promise.resolve(
      values.flatMap((value) =>
        [...text.matchAll(new RegExp(value.replaceAll(".", String.raw`\.`), "gv"))].map(
          (match) => ({
            end: match.index + value.length,
            label: "private_person" as const,
            score: 0.9,
            start: match.index,
          }),
        ),
      ),
    );

const onlyIn =
  (opening: string, value: string): Detect =>
  (text) =>
    Promise.resolve(text.startsWith(opening) ? [spanOver(text, value)] : []);

const answering = (...replies: Array<Array<Span>>): Detect => {
  const queue = [...replies];

  return () => Promise.resolve(queue.shift() ?? []);
};

const inFile = (text: string, detect: Detect) =>
  analyseUnits({ detect, kind: "file", units: [{ text }] });

const scanOf = (passes: Array<string>) => ({ readings: passes.map((text) => ({ text })) });

/* A string is a typed page; a list of strings is a scanned page, read once per pass. */
const inPages = (pages: Array<string | Array<string>>, detect: Detect) =>
  analyseUnits({
    detect,
    kind: "pages",
    units: pages.map((page) => (typeof page === "string" ? { text: page } : scanOf(page))),
  });

const inReadings = (passes: Array<string>, detect: Detect) =>
  analyseUnits({ detect, kind: "file", units: [scanOf(passes)] });

const previews = ({ detections }: { detections: Array<Detection> }) =>
  detections.map((detection) => detection.preview);

const previewsOf = async (text: string, detect: Detect) => previews(await inFile(text, detect));

const everything = ({ detections }: { detections: Array<Detection> }): Decisions => ({
  covered: detections.map((detection) => detection.id),
});

const coveredText = (reading: AnalysedReading, decisions: Decisions) =>
  new Set(keptSpans(reading, decisions).map(({ end, start }) => reading.text.slice(start, end)));

const coveredPerReading = (
  units: ReadonlyArray<ReadonlyArray<AnalysedReading>>,
  decisions: Decisions,
) => units.flat().map((reading) => coveredText(reading, decisions));

const accountNumber: Detect = (text) => {
  const start = text.indexOf("108");

  return Promise.resolve(
    start === -1
      ? []
      : [
          {
            end: start + (text.includes(".") ? 14 : 11),
            label: "account_number" as const,
            score: text.includes(".") ? 0.8 : 1,
            start,
          },
        ],
  );
};

describe("analyseUnits repeats", () => {
  it("covers every later mention of a phrase the model tagged once", async () => {
    const text = "Joao Goncalves came in. Later Joao Goncalves left. Ask joao goncalves about it.";

    expect(await previewsOf(text, tagging("Joao Goncalves"))).toEqual([
      "Joao Goncalves",
      "Joao Goncalves",
      "joao goncalves",
    ]);
  });

  it("carries the label and score of the span a repeat came from", async () => {
    const text = "write to ana@example.com or ana@example.com";
    const analysed = await inFile(
      text,
      answering([spanOver(text, "ana@example.com", { label: "private_email", score: 0.8 })]),
    );

    expect(analysed.detections.map(({ confidence, label }) => [label, confidence])).toEqual([
      ["private_email", 0.8],
      ["private_email", 0.8],
    ]);
  });

  it("finds a repeat however the document spaced either mention", async () => {
    const text = "Joao   Goncalves came in. Joao\nGoncalves left.";

    expect(await previewsOf(text, tagging("Joao   Goncalves"))).toEqual([
      "Joao   Goncalves",
      "Joao\nGoncalves",
    ]);
  });

  it("does not fire inside a longer word", async () => {
    expect(await previewsOf("Ana and Anabela and banana", tagging("Ana"))).toEqual(["Ana"]);
  });

  it("does not repeat a span too short to be a name", async () => {
    expect(await previewsOf("Sa lives here, Sa said", tagging("Sa"))).toEqual(["Sa"]);
  });

  it("does not repeat a span the model was not confident enough to act on", async () => {
    const text = "Ana Lima came. Ana Lima left.";

    const unsure = spanOver(text, "Ana Lima", { score: 0.49 });

    expect(await previewsOf(text, answering([unsure]))).toEqual(["Ana Lima"]);
  });

  it("repeats a phrase at the best score it was tagged with, in either order", async () => {
    const text = "Ana Lima came. Ana Lima left. Ana Lima stayed.";
    const weak = spanOver(text, "Ana Lima", { score: 0.7 });
    const strong = spanOver(text, "Ana Lima", { from: 10, score: 0.9 });

    for (const tagged of [
      [weak, strong],
      [strong, weak],
    ]) {
      const { detections } = await inFile(text, answering(tagged));

      expect(detections.map((detection) => detection.confidence)).toEqual([0.9, 0.9, 0.9]);
    }
  });

  it("does not spread a single word of a longer phrase across the document", async () => {
    const phrase = "the addresses set forth at the end of this Agreement";
    const text = `${phrase} bind the parties`;

    const address = spanOver(text, phrase, { label: "private_address" });

    expect(await previewsOf(text, answering([address]))).toEqual([phrase]);
  });

  it("reads every punctuation mark a repeat can hold as plain text", async () => {
    const tokens = ["a-b", "a/b", "a.b", "a+b", "a(b)", "a[b]", "a{b}", "a|b", "a^b", "a$b"];

    for (const token of [...tokens, "555-0100", "ana@example.com"]) {
      const text = `x ${token} y ${token}`;
      const tagged = spanOver(text, token, { label: "secret" });
      const { detections } = await inFile(text, answering([tagged]));

      expect({ found: detections.length, token }).toEqual({ found: 2, token });
    }
  });

  it("covers a name on the pages before and after the one the model tagged it on", async () => {
    const { detections } = await inPages(
      ["Invoice for Ana Lima", "Signed by Ana Lima", "Witnessed for Ana Lima"],
      onlyIn("Signed", "Ana Lima"),
    );

    expect(detections.map(({ page, preview }) => [page, preview])).toEqual([
      [0, "Ana Lima"],
      [1, "Ana Lima"],
      [2, "Ana Lima"],
    ]);
  });

  it("searches every reading for a value another reading found", async () => {
    const analysed = await inReadings(
      ["NUMERO 108.467.036-45", "CPF 108.467.036-45"],
      onlyIn("CPF", "108.467.036-45"),
    );

    expect(analysed.detections).toHaveLength(1);
    expect(coveredPerReading(analysed.units, everything(analysed))).toEqual([
      new Set(["108.467.036-45"]),
      new Set(["108.467.036-45"]),
    ]);
  });

  it("covers a name on a typed page that only a passed-over pass of a scanned page tagged", async () => {
    const { detections } = await inPages(
      ["Invoice for Ana Lima", ["Signed by", "Signed by Ana Lima"]],
      onlyIn("Signed by Ana", "Ana Lima"),
    );

    expect(detections.map(({ page, preview }) => [page, preview])).toEqual([
      [0, "Ana Lima"],
      [1, "Ana Lima"],
    ]);
  });

  it("never asks the detector about an empty unit", async () => {
    const detect = vi.fn<Detect>(() => Promise.resolve([]));

    await inPages(["", "Ana"], detect);

    expect(detect.mock.calls).toEqual([["Ana"]]);
  });
});

describe("analyseUnits defined terms", () => {
  it("drops a role the document defined, even where only a repeat found it", async () => {
    const text = 'Zora Labs, Inc. ("Client") engages Pedro Filho. Client will pay Pedro Filho.';
    const detect = answering([spanOver(text, "Client"), spanOver(text, "Pedro Filho")]);

    expect(await previewsOf(text, detect)).toEqual(["Pedro Filho", "Pedro Filho"]);
  });

  it("drops a role one page defined from the pages before and after it", async () => {
    const analysed = await inPages(
      ["Client will pay Ana Lima", 'Zora Labs, Inc. ("Client") engages Ana Lima', "Client signs"],
      taggingEvery("Client", "Ana Lima"),
    );

    expect(previews(analysed)).toEqual(["Ana Lima", "Ana Lima"]);
  });

  it("drops a role a passed-over pass of a scanned page defined from every page", async () => {
    const analysed = await inPages(
      ["Client will pay Ana Lima", ["Zora Labs engages", 'Zora Labs, Inc. ("Client") engages']],
      taggingEvery("Client", "Ana Lima"),
    );

    expect(previews(analysed)).toEqual(["Ana Lima"]);
  });

  it("reads the curly quotes and articles a word processor writes", async () => {
    const contract =
      "This Consulting Agreement (the “ Agreement ”) is made between Zora Labs, Inc., " +
      "a Delaware corporation (“ Client ”) and the consultant named on the signature page " +
      "(“ Consultant ”). Client may issue assignments to Consultant (each, a “ Project Assignment ”).";
    const detect = taggingEvery(
      "Agreement",
      "Zora Labs, Inc.",
      "Client",
      "Consultant",
      "Project Assignment",
    );

    expect(await previewsOf(contract, detect)).toEqual(["Zora Labs, Inc."]);
  });

  it("keeps an alias that shortens the name detected just before it", async () => {
    const text = 'Pedro Filho ("Pedro") will consult. Pedro agreed.';
    const detect = answering([
      spanOver(text, "Pedro Filho"),
      spanOver(text, "Pedro", { from: 20 }),
    ]);

    expect(await previewsOf(text, detect)).toEqual(["Pedro Filho", "Pedro", "Pedro"]);
  });

  it("drops a role even when a detected name sits right before it", async () => {
    const text = 'Pedro Filho ("Consultant") will consult. Consultant signs.';
    const detect = answering([
      spanOver(text, "Pedro Filho"),
      spanOver(text, "Consultant", { from: 30 }),
    ]);

    expect(await previewsOf(text, detect)).toEqual(["Pedro Filho"]);
  });

  it("drops a role a contract defines out of its own lowercase word", async () => {
    const text = 'the consultant named on the signature page ("Consultant") agrees';

    expect(await previewsOf(text, tagging("consultant"))).toEqual([]);
  });

  it("drops a defined term the model tagged together with its article", async () => {
    const text = 'The party of record ("Recipient") signs. The Recipient will return it.';

    expect(await previewsOf(text, tagging("The Recipient"))).toEqual([]);
  });

  it("keeps a name that merely follows a defined term", async () => {
    const text = 'The party ("Recipient") signs. the Recipient Ana Lima signed.';

    expect(await previewsOf(text, tagging("the Recipient Ana Lima"))).toEqual([
      "the Recipient Ana Lima",
    ]);
  });

  it("drops a term however the document cased it", async () => {
    const text = 'The firm ("Consultant") agrees. the CONSULTANT signs.';

    expect(await previewsOf(text, tagging("CONSULTANT"))).toEqual([]);
  });

  it("ignores brackets that hold no quoted term", async () => {
    const text = "Payment is due (within 30 days) of invoice.";

    expect(await previewsOf(text, tagging("within 30 days"))).toEqual(["within 30 days"]);
  });
});

describe("analyseUnits identity", () => {
  it("keeps one detection when two layers found the same span, at the better confidence", async () => {
    const text = "Signed by Ana Lima today";
    const { detections } = await inFile(
      text,
      answering([spanOver(text, "Ana Lima", { score: 0.6 }), spanOver(text, "Ana Lima")]),
    );

    expect(detections.map(({ confidence, preview }) => [preview, confidence])).toEqual([
      ["Ana Lima", 0.9],
    ]);
  });

  it("folds a nested span into the one that encloses it, carrying the better score", async () => {
    const text = "Signed by Ana Lima Souza today";
    const { detections } = await inFile(
      text,
      answering([
        spanOver(text, "Ana Lima Souza", { score: 0.7 }),
        spanOver(text, "Lima Souza", { score: 1 }),
      ]),
    );

    expect(detections.map(({ confidence, preview }) => [preview, confidence])).toEqual([
      ["Ana Lima Souza", 1],
    ]);
  });

  it("leaves a partial overlap or a different label as separate detections", async () => {
    const text = "Signed by Ana Lima today";
    const { detections } = await inFile(
      text,
      answering([
        spanOver(text, "Ana Lima"),
        spanOver(text, "Lima today"),
        spanOver(text, "Lima", { label: "private_address" }),
      ]),
    );

    expect(detections).toHaveLength(3);
  });

  it("keeps the pages apart and orders by page, then position", async () => {
    const { detections } = await inPages(
      ["Ana Lima and Rui", "Rui and Ana"],
      answering(
        [
          { end: 16, label: "private_person", score: 0.5, start: 13 },
          { end: 8, label: "private_person", score: 0.5, start: 0 },
        ],
        [{ end: 3, label: "private_person", score: 0.5, start: 0 }],
      ),
    );

    expect(detections.map(({ page, start }) => [page, start])).toEqual([
      [0, 0],
      [0, 13],
      [1, 0],
    ]);
  });

  it("addresses a page detection by its page and a file detection by position alone", async () => {
    const paged = await inPages(["Ana Lima", "Ana Lima"], tagging("Ana Lima"));
    const filed = await inFile("Ana Lima", tagging("Ana Lima"));

    expect(paged.detections.map((detection) => detection.page)).toEqual([0, 1]);
    expect(new Set(paged.detections.map((detection) => detection.id)).size).toBe(2);
    expect(filed.detections[0]?.page).toBeUndefined();
  });

  it("previews the covered text, cut to eighty graphemes", async () => {
    const [preview] = await previewsOf(
      "a".repeat(200),
      answering([{ end: 200, label: "secret", score: 0.5, start: 0 }]),
    );

    expect(preview).toHaveLength(80);
  });

  it("reports one detection for a value every reading found, however spelled and placed", async () => {
    const { detections } = await inReadings(
      ["CPF 108.467.036-45", "DOCUMENTO NUMERO 10846703645"],
      accountNumber,
    );

    expect(detections.map(({ confidence, preview }) => [preview, confidence])).toEqual([
      ["10846703645", 1],
    ]);
    expect(detections[0]?.page).toBeUndefined();
  });
});

describe("analyseUnits scanned pages", () => {
  const passes = ["Signed by Ana Lima", "Signed by Ana Lima, CPF 108.467.036-45"];

  it("reports a value the passes share once, and a value only a later pass read", async () => {
    const analysed = await inPages([passes], tagging("Ana Lima", "108.467.036-45"));

    expect(analysed.detections.map(({ page, preview }) => [page, preview])).toEqual([
      [0, "Ana Lima"],
      [0, "108.467.036-45"],
    ]);
    expect(coveredPerReading(analysed.units, everything(analysed))).toEqual([
      new Set(["Ana Lima"]),
      new Set(["Ana Lima", "108.467.036-45"]),
    ]);
  });

  it("uncovers a dismissed value on every pass", async () => {
    const analysed = await inPages([passes], tagging("Ana Lima", "108.467.036-45"));
    const decisions = everything({
      detections: analysed.detections.filter(({ preview }) => preview !== "Ana Lima"),
    });

    expect(coveredPerReading(analysed.units, decisions)).toEqual([
      new Set(),
      new Set(["108.467.036-45"]),
    ]);
  });

  it("marks each place a value sits once, though a repeat finds it there again", async () => {
    const analysed = await inPages([passes], tagging("Ana Lima"));

    expect(
      analysed.units.flat().map((reading) => keptSpans(reading, everything(analysed)).length),
    ).toEqual([1, 1]);
  });

  it("keeps a value on two scanned pages as one detection per page", async () => {
    const { detections } = await inPages(
      [
        ["Ana Lima", "Ana Lima"],
        ["Ana Lima", "Ana Lima"],
      ],
      tagging("Ana Lima"),
    );

    expect(detections.map(({ page, preview }) => [page, preview])).toEqual([
      [0, "Ana Lima"],
      [1, "Ana Lima"],
    ]);
    expect(new Set(detections.map(({ id }) => id)).size).toBe(2);
  });

  it("leaves a typed page beside them addressing each mention by where it sits", async () => {
    const { detections } = await inPages(
      ["Ana Lima met Ana Lima", ["Ana Lima signed", "Ana Lima signed"]],
      tagging("Ana Lima"),
    );

    expect(detections.map(({ page, start }) => [page, start])).toEqual([
      [0, 0],
      [0, 13],
      [1, 0],
    ]);
  });
});

describe("keptSpans", () => {
  it("keeps the spans of the detections the decisions cover, unit by unit", async () => {
    const { detections, units } = await inPages(
      ["Invoice for Ana Lima", "Signed by Rui Costa"],
      tagging("Ana Lima", "Rui Costa"),
    );
    const decisions = everything({ detections: detections.filter((entry) => entry.page === 1) });

    expect(units.flat().map((reading) => keptSpans(reading, decisions))).toEqual([
      [],
      [expect.objectContaining({ end: 19, start: 10 })],
    ]);
  });

  it("covers the span a nested detection was folded into", async () => {
    const text = "Signed by Ana Lima Souza today";
    const analysed = await inFile(
      text,
      answering([spanOver(text, "Ana Lima Souza"), spanOver(text, "Lima Souza")]),
    );
    const [reading] = analysed.units.flat();

    assert.isDefined(reading);

    expect(keptSpans(reading, everything(analysed)).map(({ end, start }) => [start, end])).toEqual([
      [10, 24],
    ]);
  });

  it("covers a value in every reading while its one detection is kept", async () => {
    const analysed = await inReadings(
      ["CPF 108.467.036-45", "DOCUMENTO 10846703645"],
      accountNumber,
    );

    expect(coveredPerReading(analysed.units, everything(analysed))).toEqual([
      new Set(["108.467.036-45"]),
      new Set(["10846703645"]),
    ]);
    expect(coveredPerReading(analysed.units, { covered: [] })).toEqual([new Set(), new Set()]);
  });

  it("ignores an id that names no detection", async () => {
    const { units } = await inFile("Hi Ana!", tagging("Ana"));
    const [reading] = units.flat();

    assert.isDefined(reading);

    expect(keptSpans(reading, { covered: ["nothing"] })).toEqual([]);
  });
});

describe("redactionCount", () => {
  it("counts overlapping spans as the one redaction they become", async () => {
    const analysed = await inFile("Hi Ana Silva!", tagging("Ana", "na Silva"));

    expect(analysed.detections).toHaveLength(2);
    expect(redactionCount(analysed.units, everything(analysed))).toBe(1);
  });

  it("counts what it covered on every page", async () => {
    const analysed = await inPages(
      ["Invoice for Ana Lima", "Signed by Ana Lima"],
      tagging("Ana Lima"),
    );

    expect(redactionCount(analysed.units, everything(analysed))).toBe(2);
  });

  it("counts a value every reading shows once", async () => {
    const analysed = await inReadings(
      ["CPF 108.467.036-45", "CPF 10846703645 NOME"],
      accountNumber,
    );

    expect(redactionCount(analysed.units, everything(analysed))).toBe(1);
  });

  it("counts a value as often as the reading that shows it most", async () => {
    const analysed = await inReadings(["Ana met Ana", "Ana left"], tagging("Ana"));

    expect(redactionCount(analysed.units, everything(analysed))).toBe(2);
  });

  it("counts the distinct values of different readings apart", async () => {
    const analysed = await inReadings(["Ana", "Jose Silva"], tagging("Ana", "Jose Silva"));

    expect(redactionCount(analysed.units, everything(analysed))).toBe(2);
  });

  it("counts each page apart, a scanned one as often as its pass that shows a value most", async () => {
    const analysed = await inPages(
      ["Ana Lima and Ana Lima", ["Ana Lima", "Ana Lima, Ana Lima"]],
      tagging("Ana Lima"),
    );

    expect(redactionCount(analysed.units, everything(analysed))).toBe(4);
  });

  it("counts nothing once every detection is dismissed", async () => {
    const analysed = await inPages(["Ana Lima", "Ana Lima"], tagging("Ana Lima"));

    expect(redactionCount(analysed.units, { covered: [] })).toBe(0);
  });
});

describe("isAnalysedReading", () => {
  it("recognises the reading an analysis hands out and nothing less", async () => {
    const { units } = await inFile("Hi Ana!", tagging("Ana"));

    expect(isAnalysedReading(structuredClone(units[0]?.[0]))).toBe(true);

    for (const partial of [undefined, "Hi Ana!", { text: "Hi Ana!" }, { marks: [] }]) {
      expect(isAnalysedReading(partial)).toBe(false);
    }
  });
});

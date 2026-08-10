import type { PiiLabel, Span } from "@repo/redact-core";
import { describe, expect, it } from "vitest";

import type { LabelledSpan } from "./corpus.ts";
import type { Counts } from "./score.ts";
import { addCounts, countMatches, emptyCounts, scoreOf, totalCounts } from "./score.ts";

const want = (start: number, end: number, label: PiiLabel = "private_person"): LabelledSpan => ({
  end,
  label,
  start,
});

const got = (start: number, end: number, label: PiiLabel = "private_person"): Span => ({
  end,
  label,
  score: 0.9,
  start,
});

const counted = (expected: Array<LabelledSpan>, predicted: Array<Span>, exact = false) =>
  totalCounts(countMatches(expected, predicted, exact));

describe("countMatches", () => {
  it("pairs a prediction that lands exactly", () => {
    expect(counted([want(0, 8)], [got(0, 8)])).toEqual({
      falseNegative: 0,
      falsePositive: 0,
      truePositive: 1,
    });
  });

  it("pairs a prediction that only overlaps", () => {
    expect(counted([want(0, 8)], [got(4, 12)])).toEqual({
      falseNegative: 0,
      falsePositive: 0,
      truePositive: 1,
    });
  });

  it("refuses to pair a prediction that only touches the boundary", () => {
    expect(counted([want(0, 8)], [got(8, 12)])).toEqual({
      falseNegative: 1,
      falsePositive: 1,
      truePositive: 0,
    });
  });

  it("refuses to pair across labels even when the range overlaps", () => {
    expect(counted([want(0, 8)], [got(0, 8, "private_email")])).toEqual({
      falseNegative: 1,
      falsePositive: 1,
      truePositive: 0,
    });
  });

  it("pairs one to one, so a second prediction over the same span is a false positive", () => {
    expect(counted([want(0, 12)], [got(0, 6), got(6, 12)])).toEqual({
      falseNegative: 0,
      falsePositive: 1,
      truePositive: 1,
    });
  });

  it("keeps the larger overlap when two predictions compete", () => {
    const byLabel = countMatches([want(0, 12)], [got(0, 2), got(0, 11)]);
    const counts = byLabel.get("private_person");

    expect(counts).toEqual({ falseNegative: 0, falsePositive: 1, truePositive: 1 });
  });

  it("counts every expected span as missed when nothing was predicted", () => {
    expect(counted([want(0, 8), want(9, 14)], [])).toEqual({
      falseNegative: 2,
      falsePositive: 0,
      truePositive: 0,
    });
  });

  it("counts every prediction as spurious when nothing was expected", () => {
    expect(counted([], [got(0, 8)])).toEqual({
      falseNegative: 0,
      falsePositive: 1,
      truePositive: 0,
    });
  });

  it("counts nothing at all when both sides are empty", () => {
    expect(counted([], [])).toEqual({ falseNegative: 0, falsePositive: 0, truePositive: 0 });
  });

  it("holds a drifting boundary against the exact rule but not the overlap rule", () => {
    expect(counted([want(0, 8)], [got(0, 9)])).toEqual({
      falseNegative: 0,
      falsePositive: 0,
      truePositive: 1,
    });

    expect(counted([want(0, 8)], [got(0, 9)], true)).toEqual({
      falseNegative: 1,
      falsePositive: 1,
      truePositive: 0,
    });
  });

  it("separates the counts by label", () => {
    const byLabel = countMatches(
      [want(0, 8), want(9, 20, "private_email")],
      [got(0, 8), got(30, 40, "private_phone")],
    );

    expect(byLabel.get("private_person")?.truePositive).toBe(1);
    expect(byLabel.get("private_email")?.falseNegative).toBe(1);
    expect(byLabel.get("private_phone")?.falsePositive).toBe(1);
  });
});

describe("scoreOf", () => {
  it("reads precision, recall and F1 off the counts", () => {
    const score = scoreOf({ falseNegative: 1, falsePositive: 1, truePositive: 3 });

    expect(score.precision).toBeCloseTo(0.75);
    expect(score.recall).toBeCloseTo(0.75);
    expect(score.f1).toBeCloseTo(0.75);
  });

  it("calls a label with nothing expected and nothing predicted perfect rather than undefined", () => {
    expect(scoreOf(emptyCounts())).toMatchObject({ f1: 1, precision: 1, recall: 1 });
  });

  it("reports zero F1 when nothing was found and everything was missed", () => {
    expect(scoreOf({ falseNegative: 4, falsePositive: 0, truePositive: 0 }).f1).toBe(0);
  });
});

describe("addCounts", () => {
  it("sums two tallies label by label", () => {
    const into = new Map<PiiLabel, Counts>([
      ["private_person", { falseNegative: 1, falsePositive: 0, truePositive: 2 }],
    ]);
    const from = new Map<PiiLabel, Counts>([
      ["private_person", { falseNegative: 0, falsePositive: 3, truePositive: 1 }],
    ]);

    expect(addCounts(into, from).get("private_person")).toEqual({
      falseNegative: 1,
      falsePositive: 3,
      truePositive: 3,
    });
  });
});

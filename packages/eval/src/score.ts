import type { PiiLabel, Span } from "@repo/redact-core";

import type { LabelledSpan } from "./corpus";

type Counts = { falseNegative: number; falsePositive: number; truePositive: number };

type LabelScore = Counts & { f1: number; precision: number; recall: number };

type Match = { expected: number; overlap: number; predicted: number };

const overlapOf = (left: LabelledSpan, right: Span) =>
  Math.max(0, Math.min(left.end, right.end) - Math.max(left.start, right.start));

const mergeSpans = (spans: Array<Span>): Array<Span> => {
  const merged: Array<Span> = [];

  for (const span of spans.toSorted((left, right) => left.start - right.start)) {
    const previous = merged.findLast(
      (kept) => kept.label === span.label && kept.end > span.start && kept.start < span.end,
    );

    if (previous === undefined) {
      merged.push({ ...span });
      continue;
    }

    previous.end = Math.max(previous.end, span.end);
    previous.score = Math.max(previous.score, span.score);
  }

  return merged.toSorted((left, right) => left.start - right.start);
};

const emptyCounts = (): Counts => ({ falseNegative: 0, falsePositive: 0, truePositive: 0 });

const pairUp = (expected: Array<LabelledSpan>, predicted: Array<Span>, exact: boolean) => {
  const candidates: Array<Match> = [];

  expected.forEach((want, wantAt) => {
    predicted.forEach((got, gotAt) => {
      if (want.label !== got.label) {
        return;
      }

      const overlap = overlapOf(want, got);

      if (overlap === 0 || (exact && (want.start !== got.start || want.end !== got.end))) {
        return;
      }

      candidates.push({ expected: wantAt, overlap, predicted: gotAt });
    });
  });

  const takenExpected = new Set<number>();
  const takenPredicted = new Set<number>();

  for (const match of candidates.toSorted((a, b) => b.overlap - a.overlap)) {
    if (takenExpected.has(match.expected) || takenPredicted.has(match.predicted)) {
      continue;
    }

    takenExpected.add(match.expected);
    takenPredicted.add(match.predicted);
  }

  return { takenExpected, takenPredicted };
};

const countMatches = (
  expected: Array<LabelledSpan>,
  found: Array<Span>,
  exact = false,
): Map<PiiLabel, Counts> => {
  const predicted = mergeSpans(found);
  const { takenExpected, takenPredicted } = pairUp(expected, predicted, exact);
  const byLabel = new Map<PiiLabel, Counts>();

  const countsFor = (label: PiiLabel) => {
    const existing = byLabel.get(label);

    if (existing !== undefined) {
      return existing;
    }

    const fresh = emptyCounts();

    byLabel.set(label, fresh);

    return fresh;
  };

  expected.forEach((want, at) => {
    const counts = countsFor(want.label);

    if (takenExpected.has(at)) {
      counts.truePositive += 1;
    } else {
      counts.falseNegative += 1;
    }
  });

  predicted.forEach((got, at) => {
    if (!takenPredicted.has(at)) {
      countsFor(got.label).falsePositive += 1;
    }
  });

  return byLabel;
};

const addCounts = (into: Map<PiiLabel, Counts>, from: Map<PiiLabel, Counts>) => {
  for (const [label, counts] of from) {
    const target = into.get(label) ?? emptyCounts();

    target.falseNegative += counts.falseNegative;
    target.falsePositive += counts.falsePositive;
    target.truePositive += counts.truePositive;
    into.set(label, target);
  }

  return into;
};

const totalCounts = (byLabel: Map<PiiLabel, Counts>): Counts => {
  const total = emptyCounts();

  for (const counts of byLabel.values()) {
    total.falseNegative += counts.falseNegative;
    total.falsePositive += counts.falsePositive;
    total.truePositive += counts.truePositive;
  }

  return total;
};

const ratio = (hit: number, total: number) => (total === 0 ? 1 : hit / total);

const scoreOf = (counts: Counts): LabelScore => {
  const precision = ratio(counts.truePositive, counts.truePositive + counts.falsePositive);
  const recall = ratio(counts.truePositive, counts.truePositive + counts.falseNegative);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);

  return { ...counts, f1, precision, recall };
};

export { addCounts, countMatches, emptyCounts, mergeSpans, scoreOf, totalCounts };
export type { Counts, LabelScore };

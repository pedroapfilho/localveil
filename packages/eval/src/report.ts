import type { Counts } from "./score";
import { scoreOf } from "./score";

type Row = { counts: Counts; name: string };

const COLUMNS = ["prec", "rec", "f1", "tp", "fp", "fn"] as const;

const percent = (value: number) => (value * 100).toFixed(1).padStart(5);

const widthOf = (rows: Array<Row>) =>
  rows.reduce((widest, row) => Math.max(widest, row.name.length), "label".length);

const line = (name: string, width: number, counts: Counts) => {
  const score = scoreOf(counts);

  return [
    name.padEnd(width),
    percent(score.precision),
    percent(score.recall),
    percent(score.f1),
    String(counts.truePositive).padStart(5),
    String(counts.falsePositive).padStart(5),
    String(counts.falseNegative).padStart(5),
  ].join("  ");
};

const table = (title: string, rows: Array<Row>) => {
  const width = widthOf(rows);
  const header = ["label".padEnd(width), ...COLUMNS.map((column) => column.padStart(5))].join("  ");

  return [
    title,
    header,
    "-".repeat(header.length),
    ...rows.map((row) => line(row.name, width, row.counts)),
  ].join("\n");
};

export { table };
export type { Row };

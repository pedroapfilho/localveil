const REVIEW_AT = 0.5;

/* A file is analysed and then applied, often on two different workers with a review between them,
   so every stage owns a stretch of one bar, in this order, and the bar never runs back. Stages a
   redactor moves between inside one loop share a stretch. */
const STRETCHES = [
  { from: 0, stages: ["stage.reading"] },
  { from: 0.05, stages: ["stage.extracting", "stage.rendering", "stage.recognising"] },
  { from: 0.3, stages: ["stage.detecting"] },
  { from: REVIEW_AT, stages: ["stage.redacting", "stage.assembling"] },
  { from: 1, stages: ["stage.finished"] },
] as const;

type FileStageKey = (typeof STRETCHES)[number]["stages"][number];

type Stretch = { from: number; stages: ReadonlyArray<FileStageKey> };

const holds = (stage: FileStageKey) => (stretch: Stretch) => stretch.stages.includes(stage);

const fractionAt = (stage: FileStageKey, done = 0) => {
  const at = STRETCHES.findIndex(holds(stage));
  const from = STRETCHES[at]?.from ?? 0;
  const to = STRETCHES[at + 1]?.from ?? 1;

  return from + (to - from) * Math.min(Math.max(done, 0), 1);
};

export { fractionAt, REVIEW_AT };

export type { FileStageKey };

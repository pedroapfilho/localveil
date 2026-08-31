import type { WordInput } from "./word-index";

type Extent = { x0: number; x1: number; y0: number; y1: number };

type Block = Extent & { words: Array<WordInput> };

const SAME_LINE = 0.6;

const COLUMN_GAP = 1.5;

const BLOCK_GAP = 1.2;

const heightOf = (word: WordInput) => word.bbox.y1 - word.bbox.y0;

const unitOf = (words: ReadonlyArray<WordInput>) =>
  words.map(heightOf).toSorted((left, right) => left - right)[Math.floor(words.length / 2)];

const extentOf = (words: ReadonlyArray<WordInput>): Extent => ({
  x0: Math.min(...words.map((word) => word.bbox.x0)),
  x1: Math.max(...words.map((word) => word.bbox.x1)),
  y0: Math.min(...words.map((word) => word.bbox.y0)),
  y1: Math.max(...words.map((word) => word.bbox.y1)),
});

const onOneLine = (left: WordInput, right: WordInput, unit: number) =>
  Math.abs(left.bbox.y1 - right.bbox.y1) < unit * SAME_LINE;

/* A run is one line of one column. Splitting on a wide horizontal gap is what keeps a signed name
   away from the company block printed level with it: sorting by line alone would read the two as
   "UNLOCKERS SOFTWARE Pedro Filho HOUSE LTDA". */
const runsOf = (words: ReadonlyArray<WordInput>, unit: number) => {
  const runs: Array<Array<WordInput>> = [];

  for (const word of words) {
    const run = runs.at(-1);
    const previous = run?.at(-1);

    if (
      run === undefined ||
      previous === undefined ||
      !onOneLine(previous, word, unit) ||
      word.bbox.x0 - previous.bbox.x1 > unit * COLUMN_GAP
    ) {
      runs.push([word]);

      continue;
    }

    run.push(word);
  }

  return runs;
};

const continues = (block: Block, run: Extent, unit: number) =>
  run.y0 - block.y1 < unit * BLOCK_GAP &&
  run.y0 >= block.y0 - unit &&
  run.x0 < block.x1 &&
  run.x1 > block.x0;

const blocksOf = (runs: ReadonlyArray<Array<WordInput>>, unit: number) => {
  const blocks: Array<Block> = [];

  for (const run of runs) {
    const extent = extentOf(run);
    /* oxlint-disable-next-line react-doctor/js-index-maps -- the match is a box overlap, not a key,
       so there is nothing to index by; a page holds tens of blocks, not thousands. */
    const open = blocks.find((block) => continues(block, extent, unit));

    if (open === undefined) {
      blocks.push({ ...extent, words: [...run] });

      continue;
    }

    open.words.push(...run);
    open.x0 = Math.min(open.x0, extent.x0);
    open.x1 = Math.max(open.x1, extent.x1);
    open.y0 = extent.y0;
    open.y1 = extent.y1;
  }

  return blocks;
};

/* PDF producers append later content to the stream rather than weaving it into place, so a form
   filled in by a signing service hands back its captions first and the values the signer typed
   last. Reading the page by geometry puts each value back beside the caption it belongs to. */
const inReadingOrder = (words: ReadonlyArray<WordInput>): Array<WordInput> => {
  if (words.length === 0) {
    return [];
  }

  const unit = unitOf(words);
  const byLine = words.toSorted((left, right) =>
    onOneLine(left, right, unit) ? left.bbox.x0 - right.bbox.x0 : left.bbox.y1 - right.bbox.y1,
  );

  return blocksOf(runsOf(byLine, unit), unit).flatMap((block) => block.words);
};

export { inReadingOrder };

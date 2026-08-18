type EncodeWord = (word: string) => Array<number>;

type TokenFrame = { cls: number; sep: number };

type SpanWord = { end: number; line?: number; start: number; text: string };

type GlinerInput = {
  attentionMask: Array<number>;
  inputIds: Array<number>;

  keptWords: Array<SpanWord>;
  spanIdx: Array<number>;
  spanMask: Array<number>;
  wordsMask: Array<number>;
};

const ENT_TOKEN = "<<ENT>>";
const SEP_TOKEN = "<<SEP>>";

type EncodeOptions = {
  encodeWord: EncodeWord;
  frame: TokenFrame;
  maxWidth: number;
  prompts: Array<string>;
  words: Array<SpanWord>;
};

const encodeGlinerInput = ({
  encodeWord,
  frame,
  maxWidth,
  prompts,
  words,
}: EncodeOptions): GlinerInput => {
  const attentionMask = [1];
  const inputIds = [frame.cls];
  const wordsMask = [0];

  const pushPrompt = (word: string) => {
    for (const id of encodeWord(word)) {
      attentionMask.push(1);
      inputIds.push(id);
      wordsMask.push(0);
    }
  };

  for (const prompt of prompts) {
    pushPrompt(ENT_TOKEN);
    pushPrompt(prompt);
  }

  pushPrompt(SEP_TOKEN);

  const keptWords: Array<SpanWord> = [];

  for (const word of words) {
    const ids = encodeWord(word.text);

    if (ids.length === 0) {
      continue;
    }

    keptWords.push(word);

    ids.forEach((id, at) => {
      attentionMask.push(1);
      inputIds.push(id);

      wordsMask.push(at === 0 ? keptWords.length : 0);
    });
  }

  attentionMask.push(1);
  inputIds.push(frame.sep);
  wordsMask.push(0);

  const count = keptWords.length;
  const spanIdx: Array<number> = [];
  const spanMask: Array<number> = [];

  for (let start = 0; start < count; start += 1) {
    for (let width = 0; width < maxWidth; width += 1) {
      spanIdx.push(start, Math.min(start + width, count - 1));
      spanMask.push(start + width < count ? 1 : 0);
    }
  }

  return { attentionMask, inputIds, keptWords, spanIdx, spanMask, wordsMask };
};

export { encodeGlinerInput };
export type { EncodeOptions, EncodeWord, GlinerInput, SpanWord, TokenFrame };

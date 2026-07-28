import type { Recognition } from "./recognize.ts";

// Tesseract reports confidence out of 100. Above this a page is worth trusting;
// below it, some words are guesses and the reader should be told.
const GOOD = 70;

// Below this the recogniser is not reading, it is hallucinating. A page that came
// back at 28 was a wall of "sn ssss inan fs n inn", and the detection model tagged
// the whole run, confidently, as one person's name. Fed to the redactor that is a
// black rectangle over every line: a page destroyed rather than protected.
//
// Nothing legible can be found in text like that, so nothing is looked for. The page
// comes back untouched and carries a warning, which is the honest outcome: a reader
// who can see the page was unreadable can go and check it themselves.
const LEGIBLE = 50;

type Readability = "good" | "shaky" | "unreadable";

const readabilityOf = ({ confidence, words }: Recognition): Readability => {
  if (words.length === 0) {
    return "unreadable";
  }

  if (confidence < LEGIBLE) {
    return "unreadable";
  }

  return confidence < GOOD ? "shaky" : "good";
};

export { GOOD, LEGIBLE, readabilityOf };
export type { Readability };

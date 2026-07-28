// Written as escapes on purpose: U+2028 and U+2029 are line terminators in
// JavaScript source too, so a literal one ends the regex mid-expression.
const LINE_SEPARATOR = "\u2028";
const PARAGRAPH_SEPARATOR = "\u2029";

const BREAKS = new Set(["\n", "\r", "\r\n", LINE_SEPARATOR, PARAGRAPH_SEPARATOR]);

// A newline is not personal data. A span that runs off the end of one line and into
// the next would otherwise take the break with it and weld two rows of a log or a
// CSV together.
const isLineBreak = (segment: string) => BREAKS.has(segment);

export { isLineBreak };

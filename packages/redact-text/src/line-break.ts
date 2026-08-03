const LINE_SEPARATOR = "\u2028";
const PARAGRAPH_SEPARATOR = "\u2029";

const BREAKS = new Set(["\n", "\r", "\r\n", LINE_SEPARATOR, PARAGRAPH_SEPARATOR]);

const isLineBreak = (segment: string) => BREAKS.has(segment);

export { isLineBreak };

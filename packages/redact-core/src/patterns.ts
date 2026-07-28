import type { PiiLabel, Span } from "./types.ts";

// A model can walk past an identifier; a pattern cannot. These cover the shapes that
// are worth matching literally, and every one of them carries a check digit, so a
// number that merely looks right is rejected rather than blacked out. That matters
// on an invoice, where a page is mostly digits that are not identifiers.
type Pattern = {
  label: PiiLabel;
  matcher: RegExp;
  verify?: (value: string) => boolean;
};

const digitsOf = (value: string) => value.replaceAll(/\D/gv, "");

// Brazilian CPF: nine digits then two check digits, each a weighted sum mod 11.
const cpfDigit = (digits: string, upto: number) => {
  let sum = 0;

  for (let index = 0; index < upto; index += 1) {
    sum += Number(digits[index]) * (upto + 1 - index);
  }

  const rest = (sum * 10) % 11;

  return rest === 10 ? 0 : rest;
};

const isCpf = (value: string) => {
  const digits = digitsOf(value);

  // A run of one repeated digit passes the arithmetic and is never a real number.
  if (digits.length !== 11 || /^(?<same>\d)\k<same>+$/v.test(digits)) {
    return false;
  }

  return cpfDigit(digits, 9) === Number(digits[9]) && cpfDigit(digits, 10) === Number(digits[10]);
};

const CNPJ_WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];

const cnpjDigit = (digits: string, upto: number) => {
  const weights = CNPJ_WEIGHTS.slice(CNPJ_WEIGHTS.length - upto);
  let sum = 0;

  for (const [index, weight] of weights.entries()) {
    sum += Number(digits[index]) * weight;
  }

  const rest = sum % 11;

  return rest < 2 ? 0 : 11 - rest;
};

const isCnpj = (value: string) => {
  const digits = digitsOf(value);

  if (digits.length !== 14 || /^(?<same>\d)\k<same>+$/v.test(digits)) {
    return false;
  }

  return (
    cnpjDigit(digits, 12) === Number(digits[12]) && cnpjDigit(digits, 13) === Number(digits[13])
  );
};

const luhn = (value: string) => {
  const digits = digitsOf(value);

  if (digits.length < 13 || digits.length > 19) {
    return false;
  }

  let sum = 0;

  // Right to left, doubling every second digit. Indexing backwards avoids building
  // a reversed copy of what can be a nineteen-character string.
  for (let offset = 0; offset < digits.length; offset += 1) {
    const digit = Number(digits[digits.length - 1 - offset]);
    const doubled = offset % 2 === 1 ? digit * 2 : digit;

    sum += doubled > 9 ? doubled - 9 : doubled;
  }

  return sum % 10 === 0;
};

// IBAN: move the first four characters to the end, turn letters into numbers, and
// the whole thing read as an integer must leave 1 when divided by 97.
const isIban = (value: string) => {
  const compact = value.replaceAll(/\s/gv, "").toUpperCase();
  const rotated = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;

  const A = "A".codePointAt(0) ?? 0;

  for (const character of rotated) {
    const numeric = /\d/v.test(character)
      ? character
      : String((character.codePointAt(0) ?? 0) - A + 10);

    for (const digit of numeric) {
      remainder = (remainder * 10 + Number(digit)) % 97;
    }
  }

  return remainder === 1;
};

const PATTERNS: ReadonlyArray<Pattern> = [
  {
    label: "private_email",
    matcher: /[\p{Letter}\p{Number}._%+\-]+@[\p{Letter}\p{Number}.\-]+\.\p{Letter}{2,}/giv,
  },
  {
    label: "account_number",
    matcher: /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{11}\b/gv,
    verify: isCpf,
  },
  {
    label: "account_number",
    matcher: /\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b|\b\d{14}\b/gv,
    verify: isCnpj,
  },
  {
    label: "account_number",
    matcher: /\b[A-Z]{2}\d{2}[A-Z0-9]{11,30}\b/gv,
    verify: isIban,
  },
  {
    label: "account_number",
    matcher: /\b(?:\d[ \-]?){12,18}\d\b/gv,
    verify: luhn,
  },
  {
    // A country code, brackets, or a hyphen is required. Two runs of digits either
    // side of a space is an amount or half a card number far more often than it is a
    // telephone number, and an invoice is full of both.
    label: "private_phone",
    matcher:
      /\+\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,5}[\s\-]?\d{3,5}|\(\d{2,4}\)\s?\d{3,5}[\s\-]\d{3,5}|\b\d{3,4}-\d{4}\b/gv,
  },
];

const patternSpans = (text: string): Array<Span> => {
  const found = new Map<string, Span>();

  for (const { label, matcher, verify } of PATTERNS) {
    for (const match of text.matchAll(matcher)) {
      if (verify !== undefined && !verify(match[0])) {
        continue;
      }

      const start = match.index;
      const end = start + match[0].length;

      found.set(`${String(start)}-${String(end)}`, { end, label, score: 1, start });
    }
  }

  return [...found.values()].toSorted((left, right) => left.start - right.start);
};

export { isCnpj, isCpf, isIban, luhn, patternSpans };

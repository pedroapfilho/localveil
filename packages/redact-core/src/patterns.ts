import type { PiiLabel, Span } from "./types.ts";

type Pattern = {
  capture?: boolean;
  label: PiiLabel;
  matcher: RegExp;
  verify?: (value: string) => boolean;
};

const digitsOf = (value: string) => value.replaceAll(/\D/gv, "");

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

  for (let offset = 0; offset < digits.length; offset += 1) {
    const digit = Number(digits[digits.length - 1 - offset]);
    const doubled = offset % 2 === 1 ? digit * 2 : digit;

    sum += doubled > 9 ? doubled - 9 : doubled;
  }

  return sum % 10 === 0;
};

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

const isYearRange = (value: string) => /^(?:19|20)\d{2}-(?:19|20)\d{2}$/v.test(value);

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
    matcher: /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gv,
    verify: isIban,
  },
  {
    label: "account_number",
    matcher: /\b(?:\d[ \-]?){12,18}\d\b/gv,
    verify: luhn,
  },
  {
    capture: true,
    label: "account_number",
    matcher: /\bRG[.:]?\s?(?<value>\d{1,2}\.?\d{3}\.?\d{3}-?[\dX])\b/dgv,
  },
  {
    capture: true,
    label: "account_number",
    matcher: /\b(?:CNH|[Rr]egistro)[.:]?\s?(?<value>\d{9,11})\b/dgv,
  },
  {
    capture: true,
    label: "private_address",
    matcher: /\bCEP[.:]?\s?(?<value>\d{5}-?\d{3})\b/dgv,
  },
  {
    label: "private_date",
    matcher: /\b(?:0?[1-9]|[12]\d|3[01])\/(?:0?[1-9]|1[0-2])\/(?:19|20)\d{2}\b/gv,
  },
  {
    label: "private_phone",
    matcher:
      /\+\d{1,3}[\s\-]?\(?\d{2,4}\)?[\s\-]?\d{3,5}[\s\-]?\d{3,5}|\(\d{2,4}\)\s?\d{3,5}[\s\-]\d{3,5}|\b\d{3,4}-\d{4}\b/gv,
    verify: (value) => !isYearRange(value),
  },
  {
    label: "private_phone",
    matcher: /\b\d{3}-\d{3}-\d{4}\b|\b\d{2}\s9?\d{4}-\d{4}\b|\b9\d{4}-\d{4}\b/gv,
  },
];

const patternSpans = (text: string): Array<Span> => {
  const found = new Map<string, Span>();

  for (const { capture, label, matcher, verify } of PATTERNS) {
    for (const match of text.matchAll(matcher)) {
      const range = capture === true ? match.indices?.groups?.value : undefined;
      const [start, end] = range ?? [match.index, match.index + match[0].length];

      if (verify !== undefined && !verify(text.slice(start, end))) {
        continue;
      }

      found.set(`${String(start)}-${String(end)}`, { end, label, score: 1, start });
    }
  }

  return [...found.values()].toSorted((left, right) => left.start - right.start);
};

export { isCnpj, isCpf, isIban, luhn, patternSpans };

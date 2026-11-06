const PII_LABELS = [
  "account_number",
  "private_address",
  "private_date",
  "private_email",
  "private_person",
  "private_phone",
  "private_url",
  "secret",
] as const;

type PiiLabel = (typeof PII_LABELS)[number];

const isPiiLabel = (value: string): value is PiiLabel =>
  PII_LABELS.some((label) => label === value);

export { isPiiLabel, PII_LABELS };

export type { PiiLabel };

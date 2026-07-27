import type { PiiLabel } from "@repo/redact-core";

const PII_LABELS: ReadonlyArray<PiiLabel> = [
  "account_number",
  "private_address",
  "private_date",
  "private_email",
  "private_person",
  "private_phone",
  "private_url",
  "secret",
];

const isPiiLabel = (value: string): value is PiiLabel =>
  PII_LABELS.some((label) => label === value);

export { isPiiLabel, PII_LABELS };

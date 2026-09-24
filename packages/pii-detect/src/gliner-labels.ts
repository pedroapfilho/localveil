import type { PiiLabel } from "@repo/redact-core";

type EntityPrompt = { label: PiiLabel; prompt: string };

// The wording is urchade's model card's own: an in-distribution string scores higher than a synonym.
const MULTI_PII_PROMPTS: ReadonlyArray<EntityPrompt> = [
  { label: "private_person", prompt: "person" },
  { label: "private_person", prompt: "username" },
  { label: "private_address", prompt: "address" },
  { label: "private_address", prompt: "postal code" },
  { label: "private_email", prompt: "email" },
  { label: "private_phone", prompt: "phone number" },
  { label: "private_phone", prompt: "mobile phone number" },
  { label: "private_date", prompt: "date of birth" },
  { label: "private_date", prompt: "date" },
  { label: "account_number", prompt: "cpf" },
  { label: "account_number", prompt: "cnpj" },
  { label: "account_number", prompt: "driver's license number" },
  { label: "account_number", prompt: "passport number" },
  { label: "account_number", prompt: "identity card number" },
  { label: "account_number", prompt: "national id number" },
  { label: "account_number", prompt: "tax identification number" },
  { label: "account_number", prompt: "bank account number" },
  { label: "account_number", prompt: "iban" },
  { label: "account_number", prompt: "credit card number" },
  { label: "account_number", prompt: "social security number" },
  { label: "account_number", prompt: "health insurance number" },
  { label: "account_number", prompt: "license plate number" },
  { label: "private_url", prompt: "social media handle" },
  { label: "secret", prompt: "password" },
];

// Knowledgator trained on its own vocabulary ("name", "dob", "location address"), listed on its card.
const PII_BASE_PROMPTS: ReadonlyArray<EntityPrompt> = [
  { label: "private_person", prompt: "name" },
  { label: "private_person", prompt: "username" },
  { label: "private_address", prompt: "location address" },
  { label: "private_address", prompt: "location street" },
  { label: "private_address", prompt: "location zip" },
  { label: "private_email", prompt: "email address" },
  { label: "private_phone", prompt: "phone number" },
  { label: "private_date", prompt: "dob" },
  { label: "private_date", prompt: "date" },
  { label: "account_number", prompt: "cpf" },
  { label: "account_number", prompt: "cnpj" },
  { label: "account_number", prompt: "driver license" },
  { label: "account_number", prompt: "passport number" },
  { label: "account_number", prompt: "ssn" },
  { label: "account_number", prompt: "account number" },
  { label: "account_number", prompt: "bank account" },
  { label: "account_number", prompt: "iban" },
  { label: "account_number", prompt: "credit card" },
  { label: "account_number", prompt: "healthcare number" },
  { label: "account_number", prompt: "vehicle id" },
  { label: "private_url", prompt: "social media handle" },
  { label: "secret", prompt: "password" },
];

export { MULTI_PII_PROMPTS, PII_BASE_PROMPTS };
export type { EntityPrompt };

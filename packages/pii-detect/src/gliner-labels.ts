import type { PiiLabel } from "@repo/redact-core";

type EntityPrompt = { label: PiiLabel; prompt: string };

// GLiNER classifies against label strings given at inference time. These come from
// the model card's training list because in-distribution wording scores higher than
// synonyms, and the array order fixes each classification head index. The model was
// trained with at most 25 types per pass, so this list must not grow past that.
const ENTITY_PROMPTS: ReadonlyArray<EntityPrompt> = [
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

const MAX_PROMPTS = 25;

if (ENTITY_PROMPTS.length > MAX_PROMPTS) {
  throw new RangeError(`GLiNER was trained with at most ${MAX_PROMPTS} entity types per pass`);
}

export { ENTITY_PROMPTS };
export type { EntityPrompt };

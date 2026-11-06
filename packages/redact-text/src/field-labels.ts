import type { DocumentLanguage, PiiLabel } from "@repo/redact-core";
import { isPiiLabel } from "@repo/redact-core";

/* Each language names its own fields, so a new document language has to say what its forms call a
   name or an email before it typechecks. A name shared across languages is listed under each. */
const FIELD_NAMES = {
  en: {
    account_number: [
      "accountnumber",
      "bankaccount",
      "cardnumber",
      "creditcard",
      "iban",
      "passport",
      "passportnumber",
      "ssn",
      "taxid",
    ],
    private_address: ["address", "postalcode", "streetaddress", "zip", "zipcode"],
    private_date: ["birthdate", "dateofbirth", "dob"],
    private_email: ["email", "emailaddress", "mail"],
    private_person: [
      "firstname",
      "fullname",
      "givenname",
      "lastname",
      "name",
      "surname",
      "username",
    ],
    private_phone: ["mobile", "phone", "phonenumber", "telephone", "whatsapp"],
    private_url: ["profileurl", "website"],
    secret: ["accesstoken", "apikey", "credential", "password", "secret", "token"],
  },
  es: {
    account_number: ["cuenta", "dni", "iban", "nie", "pasaporte", "tarjeta"],
    private_address: ["codigopostal", "direccion"],
    private_date: ["fechadenacimiento"],
    private_email: ["correo", "email"],
    private_person: ["apellido", "apellidos", "nombre", "nombrecompleto", "titular", "usuario"],
    private_phone: ["celular", "movil", "telefono", "whatsapp"],
    private_url: ["perfil"],
    secret: ["contrasena"],
  },
  pt: {
    account_number: ["cartao", "cnh", "cnpj", "conta", "cpf", "iban", "passaporte", "rg"],
    private_address: ["cep", "endereco", "logradouro"],
    private_date: ["datadenascimento", "nascimento"],
    private_email: ["correio", "email"],
    private_person: ["nome", "nomecompleto", "sobrenome", "titular", "usuario"],
    private_phone: ["celular", "telefone", "whatsapp"],
    private_url: ["perfil"],
    secret: ["senha"],
  },
} satisfies Record<DocumentLanguage, Record<PiiLabel, ReadonlyArray<string>>>;

const normaliseField = (name: string) =>
  name
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gv, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/gv, "");

// Headers are folded before the lookup, so the names are folded the same way here.
const BY_FIELD = new Map<string, PiiLabel>(
  Object.values(FIELD_NAMES).flatMap((byLabel) =>
    Object.entries(byLabel).flatMap(([label, fields]) =>
      isPiiLabel(label) ? fields.map((field) => [normaliseField(field), label] as const) : [],
    ),
  ),
);

const labelForField = (name: string) => BY_FIELD.get(normaliseField(name));

export { labelForField, normaliseField };

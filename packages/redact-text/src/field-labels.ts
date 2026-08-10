import type { PiiLabel } from "@repo/redact-core";

const FIELD_LABELS: ReadonlyArray<readonly [PiiLabel, ReadonlyArray<string>]> = [
  [
    "private_person",
    [
      "apellido",
      "apellidos",
      "firstname",
      "fullname",
      "givenname",
      "lastname",
      "name",
      "nome",
      "nomecompleto",
      "nombre",
      "nombrecompleto",
      "sobrenome",
      "surname",
      "titular",
      "usuario",
      "username",
    ],
  ],
  ["private_email", ["correio", "correo", "email", "emailaddress", "mail"]],
  [
    "private_phone",
    [
      "celular",
      "mobile",
      "movil",
      "phone",
      "phonenumber",
      "telefone",
      "telefono",
      "telephone",
      "whatsapp",
    ],
  ],
  [
    "private_address",
    [
      "address",
      "cep",
      "codigopostal",
      "direccion",
      "endereco",
      "logradouro",
      "postalcode",
      "streetaddress",
      "zip",
      "zipcode",
    ],
  ],
  [
    "private_date",
    ["birthdate", "datadenascimento", "dateofbirth", "dob", "fechadenacimiento", "nascimento"],
  ],
  [
    "account_number",
    [
      "accountnumber",
      "bankaccount",
      "cardnumber",
      "cartao",
      "cnh",
      "cnpj",
      "conta",
      "cpf",
      "creditcard",
      "cuenta",
      "dni",
      "iban",
      "nie",
      "pasaporte",
      "passaporte",
      "passport",
      "passportnumber",
      "rg",
      "ssn",
      "tarjeta",
      "taxid",
    ],
  ],
  [
    "secret",
    ["apikey", "accesstoken", "contrasena", "credential", "password", "secret", "senha", "token"],
  ],
  ["private_url", ["profileurl", "perfil", "website"]],
];

const BY_FIELD = new Map<string, PiiLabel>(
  FIELD_LABELS.flatMap(([label, fields]) => fields.map((field) => [field, label] as const)),
);

const normaliseField = (name: string) =>
  name
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gv, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]/gv, "");

const labelForField = (name: string) => BY_FIELD.get(normaliseField(name));

export { labelForField, normaliseField };

import { describe, expect, it } from "vitest";

import { labelForField, normaliseField } from "./field-labels";

describe("normaliseField", () => {
  it("folds case, separators and diacritics into one key", () => {
    expect(normaliseField("Nome_Completo")).toBe("nomecompleto");
    expect(normaliseField("nome completo")).toBe("nomecompleto");
    expect(normaliseField("nomeCompleto")).toBe("nomecompleto");
    expect(normaliseField("Endereço")).toBe("endereco");
    expect(normaliseField("e-mail")).toBe("email");
  });
});

describe("labelForField", () => {
  it("reads a person out of any of the three languages", () => {
    for (const field of ["full_name", "nome", "nombre", "apellidos", "username"]) {
      expect(labelForField(field)).toBe("private_person");
    }
  });

  it("reads the identifier fields", () => {
    expect(labelForField("cpf")).toBe("account_number");
    expect(labelForField("CNPJ")).toBe("account_number");
    expect(labelForField("IBAN")).toBe("account_number");
    expect(labelForField("passport_number")).toBe("account_number");
  });

  it("reads credentials", () => {
    expect(labelForField("senha")).toBe("secret");
    expect(labelForField("apiKey")).toBe("secret");
    expect(labelForField("contraseña")).toBe("secret");
  });

  it("refuses names too generic to be safe", () => {
    for (const field of ["id", "code", "number", "data", "date", "value", "type", "status"]) {
      expect(labelForField(field)).toBeUndefined();
    }
  });

  it("refuses a bare city, which the model does not cover in prose either", () => {
    for (const field of ["city", "cidade", "ciudad"]) {
      expect(labelForField(field)).toBeUndefined();
    }
  });

  it("refuses a field it has never seen", () => {
    expect(labelForField("sku")).toBeUndefined();
    expect(labelForField("")).toBeUndefined();
  });
});

import { describe, expect, it } from "vitest";

import { languageOf, traineddataFor } from "./languages";

describe("languageOf", () => {
  it("recognises English prose", () => {
    expect(
      languageOf("The meeting notes are in the folder, and they have to be sent with the report."),
    ).toBe("en");
  });

  it("recognises Portuguese prose", () => {
    expect(
      languageOf(
        "Ele não foi à reunião, então você deve enviar uma cópia dos documentos pelo correio.",
      ),
    ).toBe("pt");
  });

  it("recognises Spanish prose", () => {
    expect(
      languageOf(
        "El informe está en la carpeta, pero hay una copia de los documentos hasta el lunes.",
      ),
    ).toBe("es");
  });

  it("still recognises Portuguese once OCR has stripped the accents", () => {
    expect(
      languageOf(
        "Ele nao foi a reuniao, entao voce deve enviar uma copia dos documentos pelo correio.",
      ),
    ).toBe("pt");
  });

  it("does not confuse Portuguese articles with Spanish ones", () => {
    expect(languageOf("Os documentos dos clientes e as copias das faturas")).not.toBe("es");
    expect(languageOf("Los documentos del cliente y las copias de las facturas")).toBe("es");
  });

  it("names nothing when the text carries no signal at all", () => {
    expect(languageOf("0123456789 ---- ####")).toBeUndefined();
    expect(languageOf("")).toBeUndefined();
  });

  it("names nothing when two languages tie", () => {
    expect(languageOf("the el")).toBeUndefined();
  });

  it("names nothing on a stray hint or two", () => {
    expect(languageOf("Relatorio the documentos dos clientes")).toBeUndefined();
    expect(languageOf("nome da")).toBeUndefined();
  });

  it("recognises Portuguese from the fields of an identity document", () => {
    expect(
      languageOf(
        "NOME JOSE DA SILVA FILIACAO MARIA DA SILVA DATA NASCIMENTO VALIDADE EMISSAO ASSINATURA",
      ),
    ).toBe("pt");
  });

  it("recognises Spanish from the fields of an identity document", () => {
    expect(languageOf("NOMBRE FECHA DE VALIDEZ FIRMA DEL TITULAR EL DOCUMENTO")).toBe("es");
  });

  it("maps each language to its traineddata name", () => {
    expect(traineddataFor("en")).toBe("eng");
    expect(traineddataFor("pt")).toBe("por");
    expect(traineddataFor("es")).toBe("spa");
  });
});

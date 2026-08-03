import { describe, expect, it } from "vitest";

import { detectLanguage, traineddataFor } from "./languages.ts";

describe("detectLanguage", () => {
  it("recognises English prose", () => {
    const { language } = detectLanguage(
      "The meeting notes are in the folder, and they have to be sent with the report.",
    );

    expect(language).toBe("en");
  });

  it("recognises Portuguese prose", () => {
    const { language } = detectLanguage(
      "Ele não foi à reunião, então você deve enviar uma cópia dos documentos pelo correio.",
    );

    expect(language).toBe("pt");
  });

  it("recognises Spanish prose", () => {
    const { language } = detectLanguage(
      "El informe está en la carpeta, pero hay una copia de los documentos hasta el lunes.",
    );

    expect(language).toBe("es");
  });

  it("still recognises Portuguese once OCR has stripped the accents", () => {
    const { language } = detectLanguage(
      "Ele nao foi a reuniao, entao voce deve enviar uma copia dos documentos pelo correio.",
    );

    expect(language).toBe("pt");
  });

  it("does not confuse Portuguese articles with Spanish ones", () => {
    expect(detectLanguage("Os documentos dos clientes e as copias das faturas").language).not.toBe(
      "es",
    );
    expect(detectLanguage("Los documentos del cliente y las copias de las facturas").language).toBe(
      "es",
    );
  });

  it("falls back when the text carries no signal at all", () => {
    expect(detectLanguage("0123456789 ---- ####", "pt")).toEqual({
      confidence: 0,
      language: "pt",
    });
  });

  it("falls back on an empty string", () => {
    expect(detectLanguage("").language).toBe("en");
  });

  it("falls back when two languages tie", () => {
    expect(detectLanguage("the el", "pt").language).toBe("pt");
  });

  it("is more confident about prose than about a single hint", () => {
    const strong = detectLanguage("The report is in the folder and it was sent to the office.");
    const weak = detectLanguage("Relatorio the documentos dos clientes");

    expect(strong.confidence).toBeGreaterThan(weak.confidence);
  });

  it("recognises Portuguese from the fields of an identity document", () => {
    const { confidence, language } = detectLanguage(
      "NOME JOSE DA SILVA FILIACAO MARIA DA SILVA DATA NASCIMENTO VALIDADE EMISSAO ASSINATURA",
    );

    expect(language).toBe("pt");
    expect(confidence).toBeGreaterThanOrEqual(0.5);
  });

  it("recognises Spanish from the fields of an identity document", () => {
    const { language } = detectLanguage("NOMBRE FECHA DE VALIDEZ FIRMA DEL TITULAR EL DOCUMENTO");

    expect(language).toBe("es");
  });

  it("maps each language to its traineddata name", () => {
    expect(traineddataFor("en")).toBe("eng");
    expect(traineddataFor("pt")).toBe("por");
    expect(traineddataFor("es")).toBe("spa");
  });
});

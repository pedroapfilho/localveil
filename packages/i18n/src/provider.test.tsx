import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "./provider";
import { useTranslations } from "./use-translations";

const Probe = () => {
  const { locale, t } = useTranslations();

  return (
    <div>
      <span data-testid="locale">{locale}</span>

      <span data-testid="message">{t("app.skipToContent")}</span>

      <span data-testid="interpolated">{t("download.button", { count: 2 })}</span>
    </div>
  );
};

const preferLanguages = (languages: Array<string>) => {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
};

const setup = () => {
  render(
    <I18nProvider>
      <Probe />
    </I18nProvider>,
  );

  return {
    locale: screen.getByTestId("locale"),
    message: screen.getByTestId("message"),
  };
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("I18nProvider", () => {
  it("starts from the browser languages, matching pt-BR to pt", () => {
    preferLanguages(["pt-BR", "en-US"]);

    const { locale, message } = setup();

    expect(locale.textContent).toBe("pt");
    expect(message.textContent).toBe("Ir para o conteúdo");
  });

  it("takes the first supported language when the browser lists several", () => {
    preferLanguages(["de-DE", "es-AR", "pt-BR"]);

    expect(setup().locale.textContent).toBe("es");
  });

  it("falls back to English when no browser language is supported", () => {
    preferLanguages(["de-DE"]);

    const { locale, message } = setup();

    expect(locale.textContent).toBe("en");
    expect(message.textContent).toBe("Skip to content");
  });

  it("interpolates values into the active catalogue", () => {
    preferLanguages(["pt-BR"]);
    setup();

    expect(screen.getByTestId("interpolated").textContent).toBe("Baixar ZIP (2)");
  });
});

describe("useTranslations", () => {
  it("throws when it is called outside the provider", () => {
    const silenced = vi.fn<(...args: Array<unknown>) => void>();

    vi.spyOn(console, "error").mockImplementation(silenced);

    expect(() => render(<Probe />)).toThrow(
      "useTranslations must be called inside an <I18nProvider>",
    );
  });
});

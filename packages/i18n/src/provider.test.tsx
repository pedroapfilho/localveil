import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { I18nProvider, STORAGE_KEY } from "./provider";
import { useTranslations } from "./use-translations";

const Probe = () => {
  const { locale, setLocale, t } = useTranslations();

  return (
    <div>
      <span data-testid="locale">{locale}</span>

      <span data-testid="message">{t("app.skipToContent")}</span>

      <span data-testid="interpolated">{t("download.button", { count: 2 })}</span>

      <button
        onClick={() => {
          setLocale("es");
        }}
        type="button"
      >
        Español
      </button>
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

beforeEach(() => {
  window.localStorage.clear();
});

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

  it("falls back to English when no browser language is supported", () => {
    preferLanguages(["de-DE"]);

    const { locale, message } = setup();

    expect(locale.textContent).toBe("en");
    expect(message.textContent).toBe("Skip to content");
  });

  it("lets the stored locale win over the browser languages", () => {
    window.localStorage.setItem(STORAGE_KEY, "es");
    preferLanguages(["pt-BR"]);

    const { locale, message } = setup();

    expect(locale.textContent).toBe("es");
    expect(message.textContent).toBe("Ir al contenido");
  });

  it("ignores a stored value that is not a locale", () => {
    window.localStorage.setItem(STORAGE_KEY, "klingon");
    preferLanguages(["pt-BR"]);

    expect(setup().locale.textContent).toBe("pt");
  });

  it("re-renders in the new catalogue and persists the choice", () => {
    preferLanguages(["en-US"]);

    const { message } = setup();

    fireEvent.click(screen.getByRole("button", { name: "Español" }));

    expect(message.textContent).toBe("Ir al contenido");
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("es");
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

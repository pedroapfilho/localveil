import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Locale } from "./locale";
import { LOCALES } from "./locale";
import { STORAGE_KEY } from "./locale-storage";
import { I18nProvider } from "./provider";
import { useTranslations } from "./use-translations";

const Probe = () => {
  const { locale, setLocale, t } = useTranslations();

  return (
    <div>
      <span data-testid="locale">{locale}</span>

      <span data-testid="message">{t("app.skipToContent")}</span>

      <span data-testid="interpolated">{t("download.button", { count: 2 })}</span>

      {LOCALES.map((option) => (
        <button
          data-testid={`switch-${option}`}
          key={option}
          onClick={() => {
            setLocale(option);
          }}
          type="button"
        >
          {option}
        </button>
      ))}
    </div>
  );
};

const preferLanguages = (languages: Array<string>) => {
  vi.spyOn(window.navigator, "languages", "get").mockReturnValue(languages);
};

const silenceWarnings = () => {
  vi.spyOn(console, "warn").mockImplementation(vi.fn<(...args: Array<unknown>) => void>());
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
    switchTo: (option: Locale) => {
      fireEvent.click(screen.getByTestId(`switch-${option}`));
    },
  };
};

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
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

describe("I18nProvider with a remembered choice", () => {
  it("prefers the language saved on an earlier visit over the browser languages", () => {
    preferLanguages(["pt-BR"]);
    window.localStorage.setItem(STORAGE_KEY, "es");

    const { locale, message } = setup();

    expect(locale.textContent).toBe("es");
    expect(message.textContent).toBe("Ir al contenido");
  });

  it("ignores a saved value that is not a language we ship", () => {
    preferLanguages(["pt-BR"]);
    window.localStorage.setItem(STORAGE_KEY, "kl-GL");

    expect(setup().locale.textContent).toBe("pt");
  });

  it("asks the browser when nothing has been saved yet", () => {
    preferLanguages(["es-AR"]);

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(setup().locale.textContent).toBe("es");
  });
});

describe("setLocale", () => {
  it("swaps every consumer over to the new catalogue", () => {
    preferLanguages(["en-US"]);

    const { locale, message, switchTo } = setup();

    switchTo("pt");

    expect(locale.textContent).toBe("pt");
    expect(message.textContent).toBe("Ir para o conteúdo");
  });

  it("saves the choice so the next visit opens in the same language", () => {
    preferLanguages(["en-US"]);

    setup().switchTo("es");

    expect(window.localStorage.getItem(STORAGE_KEY)).toBe("es");
  });
});

describe("I18nProvider when storage is unavailable", () => {
  it("still renders when reading storage throws", () => {
    silenceWarnings();
    preferLanguages(["pt-BR"]);
    vi.spyOn(window.localStorage, "getItem").mockImplementation(() => {
      throw new Error("storage is disabled");
    });

    const { locale, message } = setup();

    expect(locale.textContent).toBe("pt");
    expect(message.textContent).toBe("Ir para o conteúdo");
  });

  it("still switches language for this session when writing to storage throws", () => {
    silenceWarnings();
    preferLanguages(["en-US"]);
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const { locale, switchTo } = setup();

    switchTo("es");

    expect(locale.textContent).toBe("es");
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

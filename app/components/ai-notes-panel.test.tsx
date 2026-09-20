import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AiNotesPanel } from "./ai-notes-panel";
import type { AiNotesState } from "./ai-notes-panel";

/**
 * `@testing-library/react` nie jest zależnością tego drzewa (sprawdzone
 * w `node_modules` i `package.json` — żaden istniejący `.test.tsx` go nie
 * używa, oba istniejące testują wyłącznie loader/akcję trasy, nie renderują
 * drzewa). Komponent jest czystą funkcją propsów bez stanu i efektów, więc
 * `renderToStaticMarkup` (`react-dom/server`, już zależność) wystarcza —
 * deterministyczny łańcuch znaków, bez `createRoot`/schedulera/DOM-a. Tagi
 * ścina się zgrubnym regexem: atrybuty (w tym `d` ścieżek SVG) siedzą
 * WEWNĄTRZ ściętych nawiasów, więc do tekstu nigdy nie przeciekają.
 */
function textOf(state: AiNotesState, notes: string | null): string {
  const html = renderToStaticMarkup(<AiNotesPanel state={state} notes={notes} />);
  return html.replace(/<[^>]*>/g, " ");
}

describe("AiNotesPanel — sześć stanów, sześć komunikatów", () => {
  it("brak odnośnika mówi, dlaczego notatki nie będzie", () => {
    expect(textOf("no-meeting-url", null)).toMatch(/odnośnik/i);
  });

  it("wyłączona integracja tłumaczy, że trzeba ją włączyć", () => {
    expect(textOf("disabled", null)).toMatch(/wyłączona/i);
  });

  it("zaplanowany bot mówi, że dopiero ma dołączyć", () => {
    expect(textOf("scheduled", null)).toMatch(/dołączyć/i);
  });

  it("trwające przetwarzanie mówi, że notatka się przygotowuje", () => {
    expect(textOf("pending", null)).toMatch(/przygotowywanie notatki/i);
  });

  it("porażka nagrania albo transkrypcji jest nazwana wprost", () => {
    expect(textOf("failed", null)).toMatch(/nie udał/i);
  });

  it("gotowa notatka pokazuje treść z aiNotes", () => {
    const text = textOf("ready", "## Podsumowanie\n\nOmówiliśmy plan na wrzesień.");
    expect(text).toContain("Omówiliśmy plan na wrzesień.");
  });

  it("stan `ready` bez treści NIE milczy — kontrakt złamany dostaje własny komunikat", () => {
    // Kontrakt gwarantuje `aiNotes` niepuste przy `aiNotesState: 'ready'`, ale
    // komponent nie ufa ciszy nawet wtedy, gdy założenie akurat nie trzyma.
    expect(textOf("ready", null)).toMatch(/nie udało się/i);
  });

  it("każdy z sześciu stanów renderuje niepusty, widoczny tekst", () => {
    const states: AiNotesState[] = [
      "disabled",
      "no-meeting-url",
      "scheduled",
      "pending",
      "ready",
      "failed",
    ];
    for (const state of states) {
      const text = textOf(state, state === "ready" ? "notatka" : null);
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });
});

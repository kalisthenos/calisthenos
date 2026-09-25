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

describe("AiNotesPanel — siedem stanów, siedem komunikatów", () => {
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

  it("niezlecony bot mówi, że notatki NIE BĘDZIE — i nie zgaduje dlaczego", () => {
    const text = textOf("not-booked", null);

    // Pierwsza asercja: rozstrzygnięcie, nie oczekiwanie. Ten stan zastąpił
    // `scheduled`, który w tym samym układzie obiecywał bota.
    expect(text).toMatch(/nie będzie/i);
    // Druga jest ważniejsza i pilnuje własności KONTRAKTU: `not-booked` nie
    // niesie przyczyny (`docs/04` §AI Notetaker), więc komunikat nie ma prawa
    // jej twierdzić. „Może być" wolno, „jest" nie — bez tego ktoś w dobrej
    // wierze dopisze tu „włącz integrację" i skłamie trenerowi, który ma ją
    // włączoną.
    expect(text).not.toMatch(/bot ma dołączyć/i);
  });

  it("gotowa notatka pokazuje treść z aiNotes", () => {
    const text = textOf("ready", "## Podsumowanie\n\nOmówiliśmy plan na wrzesień.");
    expect(text).toContain("Omówiliśmy plan na wrzesień.");
  });

  it("gotowa notatka NIE zlepia sekcji Markdown w jeden akapit — white-space: pre-wrap", () => {
    // W1: `aiNotes` wraca z pięcioma sekcjami `## Nagłówek` + punkty
    // (`notes-prompt.ts` w BE). `textOf` wyżej ścina WSZYSTKIE tagi razem
    // z atrybutem `style`, więc `toContain` na treści przechodzi identycznie
    // z `pre-wrap` i bez niego — nie jest to dowód na zachowanie odstępów.
    // Tu sprawdzamy SUROWE wyjście SSR (bez cięcia tagów): `renderToStaticMarkup`
    // serializuje `style` na `white-space:pre-wrap` (bez spacji po dwukropku —
    // `react-dom/…/react-dom-server-legacy.*.development.js`, stałe
    // `styleAssign`/`styleSeparator`), więc usunięcie `whiteSpace` z
    // `TEXT_STYLE` zaczerwienia dokładnie tę asercję.
    const html = renderToStaticMarkup(
      <AiNotesPanel state="ready" notes={"## Cele\n\n- pierwszy punkt"} />,
    );
    expect(html).toContain("white-space:pre-wrap");
  });

  it("stan `ready` bez treści NIE milczy — kontrakt złamany dostaje własny komunikat", () => {
    // Kontrakt gwarantuje `aiNotes` niepuste przy `aiNotesState: 'ready'`, ale
    // komponent nie ufa ciszy nawet wtedy, gdy założenie akurat nie trzyma.
    expect(textOf("ready", null)).toMatch(/nie udało się/i);
  });

  // Test „każdy z sześciu stanów renderuje niepusty, widoczny tekst" USUNIĘTY
  // przy przeglądzie (drobne d1, fe-review.md) — nie mógł się zaczerwienić.
  // Nagłówek karty „AI Notetaker" (`ai-notes-panel.tsx:121–127`) renderuje
  // się ZAWSZE, więc `textOf(...)` nigdy nie jest pusty, nawet gdyby
  // `renderBody` oddał pustkę dla wszystkich stanów — test w nazwie
  // obiecywał kompletność, a nie sprawdzał niczego, czego nie sprawdzają
  // testy wyżej. Prawdziwą bramką kompletności jest tu TYP:
  // `STATE_COPY: Record<Exclude<AiNotesState, "ready">, …>`
  // (`ai-notes-panel.tsx`) nie skompiluje się, gdy kontrakt dołoży kolejny
  // stan — silniejsza ochrona niż jakikolwiek test w tym pliku.
  //
  // **I dokładnie to się stało.** Klient `0.8.0` przyniósł siódmy stan,
  // `not-booked`, a `npx tsc --noEmit` po podbiciu zapalił się na tym typie —
  // jedyny błąd w całym drzewie. Zapisane tutaj, bo bramka, którą widziano
  // czerwoną, przestaje być wiarą: ten akapit opisuje odtąd zdarzenie,
  // nie przewidywanie.
});

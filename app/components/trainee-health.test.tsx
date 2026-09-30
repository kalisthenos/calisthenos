import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router";
import { describe, expect, it } from "vitest";
import type { BodyPhotoCoverageView } from "~/lib/stats";
import { CoverageCard } from "./trainee-health";

/**
 * Wzorem `ai-notes-panel.test.tsx`: `renderToStaticMarkup` zamiast
 * `@testing-library/react`, którego to drzewo nie ma. Router jest potrzebny, bo
 * karta niesie `<Link>` do galerii, a ten poza routerem rzuca — i musi to być
 * `StaticRouter`, nie `MemoryRouter`: ten drugi woła `useLayoutEffect`, a render
 * serwerowy odpowiada na to ostrzeżeniem przy każdym przypadku (sprawdzone
 * 2026-09-30). Po ścięciu tagów białe znaki są zwijane — sąsiednie węzły tekstu
 * nie mają rozstrzygać o asercji.
 */
function textOf(photos: BodyPhotoCoverageView): string {
  const html = renderToStaticMarkup(
    <StaticRouter location="/trener/podopieczni/t-1">
      <CoverageCard video={{ pct: 25, withVideo: 5, total: 20 }} photos={photos} traineeId="t-1" />
    </StaticRouter>,
  );
  return html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ");
}

describe("CoverageCard — pokrycie zdjęciami sylwetki", () => {
  it("bez udostępnienia mówi to wprost — nie „0 łącznie” i nie trzy „brak ujęcia”", () => {
    // Wartości neutralne z kontraktu wyglądają dokładnie jak „zero zdjęć”. Karta
    // czytająca je bez flagi podawałaby trenerowi liczbę, której nikt mu nie dał:
    // przy `shared: false` kontrakt nie mówi, ile zdjęć jest — mówi tylko, że nie
    // dla niego (ADR-0047 BE).
    const tekst = textOf({
      shared: false,
      totalPhotos: 0,
      daysSinceLast: null,
      views: { front: false, side: false, back: false },
    });

    expect(tekst).toMatch(/nie udostępnia/);
    expect(tekst).not.toMatch(/łącznie/);
    expect(tekst).not.toMatch(/Przód|Bok|Tył/);
  });

  it("z udostępnieniem pokazuje liczbę zdjęć i ujęcia tak jak dotąd", () => {
    const tekst = textOf({
      shared: true,
      totalPhotos: 6,
      daysSinceLast: 12,
      views: { front: true, side: true, back: false },
    });

    expect(tekst).toMatch(/6 łącznie/);
    expect(tekst).toMatch(/Przód/);
    expect(tekst).not.toMatch(/nie udostępnia/);
  });
});

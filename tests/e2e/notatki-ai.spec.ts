import { expect, test } from "@playwright/test";

/**
 * Włącznik notatek AI (`app/routes/trener/integracje.notatki-ai.tsx`, Zadanie 15)
 * przez PRAWDZIWY backend (`e2e-test` SKILL.md) — **drugi plik w `tests/e2e/`**,
 * więc dziedziczy konwencje `sesja-poza-planem.spec.ts` (konto z seedera,
 * `getByRole`/`getByLabel`, asercja na TREŚCI, nie na samej obecności) i
 * dokłada jedną swoją, opisaną niżej.
 *
 * **Konto** — jedyny zasiany trener, `trener@kalisthenos.test` / `Kalisthenos123!`
 * (`DEV_TRAINER_EMAIL`, `SEED_PASSWORD` w `calisthenos-be/libs/shared/testing/
 * src/lib/seeders/dev.seeder.ts`). Seeder NIE zakłada żadnego wiersza
 * `calendar_connections` — trener startuje więc zawsze ze stanem kalendarza
 * `disconnected`, nigdy `connected` ani `broken`. To jedyny fakt o stanie
 * kalendarza, jaki ten plik ma prawo zakładać.
 *
 * **Wejście na ekran KLIKIEM w menu trenera**, nie `page.goto` — zgodnie
 * z bazową konwencją katalogu („nawigacja klikiem, nie zgadywanym URL-em",
 * `tests/README.md`). `_layout.tsx` dołożył pozycję „Notatki AI" do
 * `NAV_ITEMS` commitem `a977d0e` — PO napisaniu tego pliku, więc pierwsza
 * wersja wchodziła przez `page.goto` na sam adres (uzasadnienie: reguła
 * „klikiem" chroni przed identyfikatorami losowanymi w bazie, nie przed
 * nawigacją na segment znany z góry, a `/trener/integracje/notatki-ai`
 * takiego segmentu nie ma — `tests/README.md` dopuszcza to osobno, dla
 * scenariuszy, którym nie zależy akurat na dowiedzeniu tego przejścia).
 * Poprawione przy przeglądzie (W3a, `fe-review.md`): skoro link już
 * istnieje, klik dowodzi PRZY OKAZJI, że faktycznie prowadzi na właściwy
 * ekran — jedyny element nawigacji, który ta gałąź wniosła, i który do tej
 * pory nie miał żadnego testu.
 *
 * **Czego ten plik CELOWO nie dowodzi: połączonego kalendarza i samego
 * włączenia.** Brief Zadania 17 opisuje też drugą połowę przepływu — trenera
 * Z kalendarzem, który włącza integrację i widzi ją aktywną po przeładowaniu.
 * Sprawdzone PRZED napisaniem tego pliku, że nie da się jej tu dowieść:
 *   1. `dev.seeder.ts` nie tworzy żadnego wiersza `calendar_connections` (cały
 *      plik przeszukany) — nie ma zasianego trenera z gotowym połączeniem.
 *   2. Jedyna droga do wiersza `connected` to prawdziwa zgoda Google
 *      (`CalendarConnectionController.authorize` → ekran zgody u dostawcy →
 *      `callback` z prawdziwym `code`, `calendar.controller.ts`) — w tym
 *      repozytorium nie ma konta testowego Google ani sekretów do niego.
 *   3. Backend chroni się przed tym we WŁASNYCH testach: `calendar-port.ts`
 *      (`calisthenos-be/apps/api-e2e/src/support/`) podstawia porty, które
 *      **rzucają** przy każdym wywołaniu sieciowym do Google, właśnie po to,
 *      żeby pierwszy test zakładający wiersz `calendar_connections` nie
 *      uderzył po cichu w prawdziwego dostawcę. Test tutaj, idący tą samą
 *      drogą, byłby dokładnie tym, przed czym backend się broni.
 * Gałąź „kalendarz podłączony → włączenie działa i przeżywa przeładowanie" to
 * czysta kontrola przepływu bez efektu specyficznego dla przeglądarki (branch
 * na `CalendarConnectionView.status`, wywołanie `enableNotetaker`) — dokładnie
 * to, co `e2e-test` SKILL.md każe dowodzić PODSTAWIONYM klientem, nie tutaj.
 * `integracje.google.tsx` ma taki test (`integracje.google.test.tsx`);
 * Zadanie 17 zgłosiło w raporcie brak tego samego dla `integracje.notatki-
 * ai.tsx` jako rekomendację, celowo nie dopisaną bez pytania — a przy
 * przeglądzie tej gałęzi (W2, `fe-review.md`) dopisaną: `integracje.notatki-
 * ai.test.tsx`, ten sam katalog, ten sam wzorzec.
 */
const TRAINER_EMAIL = "trener@kalisthenos.test";
const TRAINER_PASSWORD = "Kalisthenos123!";

test("trener bez podłączonego kalendarza widzi wyjaśnienie i nieaktywny przełącznik notatek AI", async ({
  page,
}) => {
  await test.step("logowanie", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TRAINER_EMAIL);
    await page.getByLabel("Hasło").fill(TRAINER_PASSWORD);
    await page.getByRole("button", { name: "Zaloguj" }).click();
    await expect(page).toHaveURL(/\/trener\/?$/);
  });

  await test.step("wejście na ekran notatek AI PRZEZ MENU trenera", async () => {
    // Jedyny element nawigacji, który ta gałąź wniosła (`_layout.tsx`,
    // `a977d0e`) — i dotąd nieklikany przez żaden test. Klik zamiast
    // `page.goto` dowodzi przy okazji przejścia z loaderem po drugiej
    // stronie, tak jak krok „odnośnik naprawczy" niżej.
    await page.getByRole("link", { name: "Notatki AI" }).click();
    await expect(page).toHaveURL(/\/trener\/integracje\/notatki-ai\/?$/);
    await expect(page.getByRole("heading", { name: "Notatki AI" })).toBeVisible();
  });

  await test.step("wyjaśnienie mówi o BRAKU kalendarza, nie o zepsutym", async () => {
    // Scoped do banera, nie `page.getByText` gołe: `broken` ma INNY tekst
    // (`CALENDAR_BLOCK_MESSAGES` w `integracje.notatki-ai.tsx`) — asercja na
    // złym wariancie przeszłaby równie łatwo, gdyby ekran pomylił rozłączony
    // kalendarz ze zepsutym. `toContainText`, nie sama obecność elementu.
    const explanation = page.locator(".alert.alert-error");
    await expect(explanation).toContainText(
      "Najpierw podłącz kalendarz Google — bez niego bot nie ma dokąd dołączyć.",
    );
    await expect(explanation).not.toContainText("przestało działać");
  });

  await test.step("przełącznik jest NIEAKTYWNY, nie ukryty", async () => {
    const enableButton = page.getByRole("button", { name: "Włącz" });
    await expect(enableButton).toBeVisible();
    await expect(enableButton).toBeDisabled();
  });

  await test.step("odnośnik naprawczy prowadzi na prawdziwy ekran kalendarza", async () => {
    // Dowodzi przejścia między trasami (loader po drugiej stronie), nie tylko
    // że `<a href>` ma poprawną wartość.
    await page.getByRole("link", { name: "Przejdź do integracji Google" }).click();
    await expect(page).toHaveURL(/\/trener\/integracje\/google\/?$/);
    await expect(page.getByRole("heading", { name: "Google Calendar" })).toBeVisible();
  });
});

import { expect, test } from "@playwright/test";

/**
 * Rejestracja samoobsługowa trenera przez PRAWDZIWY backend (`e2e-test` SKILL.md): krok 1 od
 * strony logowania, strona linku, którego nie ma, i strona dokumentu zgody, którego nie ma.
 * **Trzeci plik w `tests/e2e/` i pierwszy BEZ konta z seedera**: to ścieżka osoby, która konta
 * jeszcze nie ma, więc konwencja „Konto” z `tests/README.md` jej nie dotyczy; reszta (rola,
 * etykieta albo tekst w selektorach, asercja na TREŚCI, nie na samej obecności) obowiązuje.
 *
 * **Warunek: BE z `REGISTRATION_OPEN=true`.** Wyłącznik (spec tras rejestracji, U6) stoi na całym
 * kontrolerze rejestracji, PRZED walidacją — zamyka tak samo zgłoszenie adresu (scenariusz 1)
 * i podgląd linku (scenariusz 2). Bez zmiennej BE odpowiada `409 REGISTRATION_CLOSED` (jej brak
 * znaczy „zamknięta”) i oba scenariusze widzą „Rejestracja kont trenerów jest chwilowo zamknięta.”
 * zamiast tego, czego szukają. Scenariusz 3 jej nie potrzebuje: dokumentu zgody wyłącznik nie
 * dotyczy. BE musi też w ogóle odpowiadać pod `API_URL`: bez niego FE pokazuje stronę błędu, a
 * scenariusze czerwienią się na asercjach z komunikatami niżej — sprawdź najpierw BE.
 *
 * **Poczta niepotrzebna i nieczytana.** Link z kroku 1 żyje tylko w mailu, więc krok 2 (formularz
 * z linku, zgody, założenie konta) leży poza tym plikiem — pokrywa go e2e BE
 * (`apps/api-e2e/src/api/registrations.e2e.spec.ts`) i test trasy przeciw podstawionemu klientowi
 * (`app/routes/rejestracja.token.test.ts`). Uruchamiaj BE bez `LETTERMINT_API_TOKEN`: wtedy worker
 * tylko loguje maile; z tokenem każdy przebieg wysłałby prawdziwe wiadomości.
 *
 * **Adres bez `+tag`.** `e2e-<znacznik>@kalisthenos.test`: domena z konwencji tego katalogu (konta
 * seedera), zastrzeżona (RFC 2606) — poza DNS i poza listami skrzynek tymczasowych (tabelę ładuje
 * operator; test zakłada, że nikt jej tam nie wpisał). **NIE `e2e+<znacznik>@…`:** BE liczy limit
 * zgłoszeń (3 na godzinę) po adresie KANONICZNYM, obciętym od pierwszego `+`
 * (`canonicalForCounting`), więc takie adresy to jedna skrzynka i drugi przebieg w tej samej
 * godzinie dostałby odmowę zamiast „Sprawdź skrzynkę” — unikalność adresu nic by nie dała.
 *
 * **Budżet limitu po łączu.** `POST /v1/registrations` ma 10 żądań na godzinę po adresie klienta
 * (`REGISTRATION_THROTTLE_LIMIT`), a cały ruch z tej maszyny to jeden adres. Scenariusz 1 zużywa
 * dwa żądania na projekt, cztery na przebieg pliku (`desktop` i `mobile`) — dwa pełne przebiegi na
 * godzinę. Więcej: `--project=desktop` albo podniesiony limit w `.env` BE. Wyczerpany limit
 * czerwieni scenariusz 1 już przy PIERWSZYM wysłaniu (alert „Za dużo prób…” pod polem) — to nie
 * usterka FE.
 *
 * **`page.goto` na token i dokument** — wyjątek dozwolony w `tests/README.md`: adres linku z maila
 * nie ma wejścia z żadnej strony aplikacji, a oba segmenty są znane z góry.
 *
 * **Dlaczego „Wyślij ponownie” podmienia adres w ukrytym polu.** Ukryte pole `email` jest jedynym
 * powiązaniem widoku sukcesu z akcją (przegląd Zadania 13), a widok po ponownym wysłaniu jest
 * IDENTYCZNY z widokiem przed nim (ten sam nagłówek, ten sam akapit) — stary widok stoi, dopóki
 * odpowiedź go nie zmieni. „Znów ten nagłówek” przeszłoby więc także bez pola, i to PRZED
 * odpowiedzią. Dlatego wartość pola zamieniamy na INNY poprawny adres: tylko odpowiedź akcji na
 * ten adres pokaże go w akapicie, więc asercja czeka na prawdziwy wynik. Ciało wysłanego żądania
 * jest drugim dowodem — jedynym w gałęzi, w której BE odmawia limitem i niczego nie odbija.
 *
 * **Czego plik nie dowodzi:** kroku 2 (wyżej); strony ISTNIEJĄCEGO dokumentu (katalog zgód ładuje
 * operator, seeder go nie zakłada, więc test nie ma czego otworzyć); tego, że 404 w scenariuszu 3
 * pochodzi z loadera, a nie z braku trasy — rejestrację trasy w `app/routes.ts` żaden test nie
 * pinuje, a odpowiedź jest ta sama.
 */

test("krok 1 rejestracji: z logowania do „Sprawdź skrzynkę” i „Wyślij ponownie”", async ({
  page,
}) => {
  // W teście, nie na poziomie modułu: każdy projekt i każdy przebieg ma dostać własne skrzynki.
  // Drugi adres to osobna skrzynka kanoniczna (`-b` nie jest obcinane), więc dwa zgłoszenia nie
  // dzielą limitu 3 na godzinę.
  const stamp = Date.now();
  const address = `e2e-${stamp}@kalisthenos.test`;
  const otherAddress = `e2e-${stamp}-b@kalisthenos.test`;

  await test.step("odnośnik z logowania prowadzi na /rejestracja", async () => {
    await page.goto("/login");
    await page.getByRole("link", { name: "Załóż konto trenera" }).click();
    await expect(page).toHaveURL(/\/rejestracja\/?$/);
    await expect(page.getByRole("heading", { name: "Załóż konto trenera" })).toBeVisible();
  });

  await test.step("wysłanie adresu pokazuje „Sprawdź skrzynkę” z tym adresem", async () => {
    await page.getByLabel("Email").fill(address);
    await page.getByRole("button", { name: "Wyślij link" }).click();

    await expect(
      page.getByRole("heading", { name: "Sprawdź skrzynkę" }),
      "po wysłaniu adresu nie ma „Sprawdź skrzynkę” — BE bez REGISTRATION_OPEN=true, wyczerpany " +
        "limit (alert pod polem) albo BE, który nie odpowiada; patrz nagłówek pliku",
    ).toBeVisible();
    // Adres z kropką na końcu: akapit niesie go w całości, nie tylko jako początek innego tekstu.
    await expect(page.getByText(`Wysłaliśmy link na ${address}.`)).toBeVisible();
  });

  await test.step("„Wyślij ponownie” wysyła to, co stoi w ukrytym polu", async () => {
    // Pole nie ma w widoku żadnej innej drogi do akcji, więc to ono decyduje, na jaki adres
    // idzie zgłoszenie. Wartość ustawia się na elemencie (`fill` odmawia pola `hidden`).
    await page.locator('input[type="hidden"][name="email"]').evaluate((input, value) => {
      (input as HTMLInputElement).value = value;
    }, otherAddress);

    const [resend] = await Promise.all([
      page.waitForResponse(
        (res) =>
          res.request().method() === "POST" &&
          new URL(res.url()).pathname.startsWith("/rejestracja"),
      ),
      page.getByRole("button", { name: "Wyślij ponownie" }).click(),
    ]);

    // Dowód 1 — ciało żądania: adres z ukrytego pola doszedł do akcji (także gdy BE odmówi).
    const sent = new URLSearchParams(resend.request().postData() ?? "");
    expect(
      sent.get("email"),
      "„Wyślij ponownie” nie wysłało adresu z ukrytego pola email w widoku „Sprawdź skrzynkę”",
    ).toBe(otherAddress);

    // Dowód 2 — wynik widoczny: akapit z NOWYM adresem (więc nagłówek „Sprawdź skrzynkę” też)
    // albo odmowa limitu (limit zgłoszeń na skrzynkę albo po łączu). Stary widok niesie stary
    // adres, więc żadna z dwóch możliwości nie jest spełniona, dopóki odpowiedź nie wyląduje;
    // „Podaj poprawny adres e-mail.” — skutek zgubionego pola — nie spełnia żadnej.
    const echoed = page.getByText(`Wysłaliśmy link na ${otherAddress}.`);
    const limitAlert = page
      .getByRole("alert")
      .filter({ hasText: /Wysłaliśmy już kilka wiadomości|Za dużo prób/ });
    await expect(echoed.or(limitAlert)).toBeVisible();
  });
});

test("link rejestracyjny, którego nie ma: „Link jest nieważny albo wygasł” i nagłówki strony", async ({
  page,
}) => {
  const pageResponse = await page.goto("/rejestracja/nieistniejacy-token");
  if (!pageResponse) throw new Error("goto nie zwróciło odpowiedzi dokumentu");

  // Widok PRZED nagłówkami: gdy BE nie odpowiada, loader rzuca i trasa renderuje granicę błędu,
  // na której jej `headers()` nie działa (znana słabość z Zadania 14) — asercja nagłówków
  // czerwieniłaby się wtedy jak regresja `Referrer-Policy`, choć winny jest BE.
  await test.step("widok linku nieważnego", async () => {
    await expect(
      page.getByRole("heading", { name: "Link jest nieważny albo wygasł" }),
      "nie ma widoku linku nieważnego — BE bez REGISTRATION_OPEN=true pokazuje tu „Rejestracja " +
        "kont trenerów jest chwilowo zamknięta.”, a BE, który nie odpowiada, stronę błędu; " +
        "patrz nagłówek pliku",
    ).toBeVisible();
  });

  await test.step("strona z tokenem nie wycieka adresu i nie jest przechowywana", async () => {
    // `allHeaders`, nie `headers`: pełna lista z surowej odpowiedzi.
    const headers = await pageResponse.allHeaders();
    // `strict-origin`, nie `no-referrer` (spec §9.3): sam origin w `Referer`, a `Origin` zostaje przy
    // natywnym POST-cie. Wartość root.tsx to `strict-origin-when-cross-origin`, więc ta asercja
    // widzi nagłówek TRASY, nie odziedziczony.
    expect(headers["referrer-policy"]).toBe("strict-origin");
    expect(headers["cache-control"]).toBe("no-store");
    // Trasa z własnym `headers` nie dziedziczy nagłówków roota — kopiuje je z `parentHeaders`.
    // Utrata CSP nie ma żadnego objawu, a test jednostkowy widzi samą funkcję, nie odpowiedź.
    expect(headers["content-security-policy"]).toContain("default-src 'self'");
  });

  await test.step("odnośnik „Wyślij nowy link” prowadzi na /rejestracja", async () => {
    await page.getByRole("link", { name: "Wyślij nowy link" }).click();
    await expect(page).toHaveURL(/\/rejestracja\/?$/);
    await expect(page.getByRole("heading", { name: "Załóż konto trenera" })).toBeVisible();
  });
});

test("dokument zgody, którego nie ma, odpowiada 404", async ({ page }) => {
  const pageResponse = await page.goto("/dokumenty/nie-ma/1");

  // Status odpowiedzi dokumentu, nie treść strony: brak dokumentu wychodzi z loadera jako `Response`
  // 404, a nieznany klucz i nieznany numer wersji wyglądają tak samo (`dokumenty.test.ts`).
  expect(
    pageResponse?.status(),
    "dokument, którego nie ma, ma odpowiedzieć 404 — 500 oznacza zwykle BE, który nie odpowiada",
  ).toBe(404);
});

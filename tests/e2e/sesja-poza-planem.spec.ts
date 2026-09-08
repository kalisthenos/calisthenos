import { expect, test } from "@playwright/test";

/**
 * Ścieżka „sesja poza planem" przez PRAWDZIWY backend (`e2e-test` SKILL.md):
 * logowanie → wejście na sesję z planu → dołożenie serii ponad plan → wymiana
 * ćwiczenia W MIEJSCU → dodanie ćwiczenia spoza planu → zapis → szczegół logu
 * niesie wszystkie trzy fakty w TREŚCI, nie tylko w obecności elementu.
 *
 * **PIERWSZY plik w `tests/e2e/`** — nie ma się tu na czym wzorować, więc
 * poniższe ustalenia są konwencją dla każdego kolejnego scenariusza (patrz
 * raport Zadania 10 i `tests/README.md` z Zadania 11):
 *
 * 1. **Konto** — `podopieczny1@kalisthenos.test` / `Kalisthenos123!`, z
 *    `calisthenos-be/libs/shared/testing/src/lib/seeders/dev.seeder.ts`
 *    (`SEED_PASSWORD` jest wspólne wszystkim kontom demo). To JEDYNY zasiany
 *    podopieczny z aktywnym planem i sesjami — pozostali są puści celowo.
 * 2. **Pola serii adresujemy po `id`, nie po roli ani etykiecie.** Etykieta
 *    trudności to sama cyfra („5", „6" itd.) powtórzona w KAŻDYM wierszu, więc
 *    `getByRole` byłby niejednoznaczny bez zawężenia do jednego wiersza. `SetRow`
 *    (`app/components/log-exercise-card.tsx`) nadaje polu powtórzeń
 *    `id="reps-{eIdx}-{sIdx}"`, a każdej pigułce trudności
 *    `id="e_{eIdx}_s_{sIdx}_diff-{wartość}"` — `eIdx` to POZYCJA wpisu
 *    w formularzu (0 = pierwsze ćwiczenie sesji), nie identyfikator
 *    ćwiczenia, i nie zmienia się przy wymianie (wymiana podmienia wpis
 *    W MIEJSCU, nie dokłada się obok niego).
 * 3. **Pigułkę trudności KLIKAMY PRZEZ `<label for=…>`, nie `.check()` na
 *    samym inpucie.** `.diff-radio input` w `app/styles/tokens.css` ma
 *    `opacity: 0; pointer-events: none` — inputa nie da się „trafić" klikiem,
 *    bo klik zawsze ląduje na widocznej etykiecie obok. Real-browser detal,
 *    którego podstawiony klient nigdy by nie ujawnił.
 * 4. **Sesja „Dzień górny" ma dwa ćwiczenia w supersetowym bloku A**
 *    (`dev.seeder.ts`): Podciąganie nachwytem (eIdx 0) i Pompki klasyczne
 *    (eIdx 1), po 4 serie każde. Kolejność jest własnością SEEDERA — zmiana
 *    tam (np. odwrócenie pull-up/push-up) wymaga poprawki tu.
 *
 * Piąta seria (pierwsza z dwóch dołożonych) zostaje celowo PUSTA — asercja
 * dotyczy wyłącznie szóstej, więc wypełniamy tylko ją. Zamiennikowi i wpisowi
 * spoza planu wypełniamy dokładnie jedną serię: mniej niż jedna uczyniłaby
 * wpis niewidocznym w zapisanym logu — `buildLogPayload` (`app/lib/workouts.ts`)
 * odrzuca z ładunku CAŁKOWICIE wpis bez ani jednej wypełnionej serii, więc
 * plakietka „zamiast: …" nie miałaby się na czym pojawić na stronie szczegółu.
 *
 * Kolejność wymiana-PRZED-dodatkiem nie jest przypadkowa: wybierak ćwiczenia
 * spoza planu odsiewa też ćwiczenie WŁAŚNIE ZASTĄPIONE (komentarz przy
 * `pickerExcludeIds` w `loguj.$sessionId.tsx`), więc odwrócenie kolejności
 * dowodziłoby innej ścieżki kodu niż ta, którą realnie przechodzi podopieczny.
 */
const TRAINEE_EMAIL = "podopieczny1@kalisthenos.test";
const TRAINEE_PASSWORD = "Kalisthenos123!";

test("wymiana ćwiczenia i dodatek spoza planu trafiają do zapisanego logu z poprawną treścią", async ({
  page,
}) => {
  await test.step("logowanie", async () => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(TRAINEE_EMAIL);
    await page.getByLabel("Hasło").fill(TRAINEE_PASSWORD);
    await page.getByRole("button", { name: "Zaloguj" }).click();
    await expect(page).toHaveURL(/\/podopieczny\/?$/);
  });

  await test.step("wejście na sesję Dzień górny", async () => {
    await page.getByRole("link", { name: "Zarejestruj sesję" }).click();
    await expect(page).toHaveURL(/\/podopieczny\/sesje\/?$/);

    await page.getByRole("link", { name: "Otwórz sesję Dzień górny" }).click();

    // `exact: true` — druga „Zarejestruj wykonanie tej sesji" na tej samej
    // stronie ma dłuższy tekst i domyślne, podłańcuchowe dopasowanie
    // Playwrighta trafiłoby też w nią.
    await page.getByRole("link", { name: "Zarejestruj wykonanie", exact: true }).click();
    await expect(page).toHaveURL(/\/podopieczny\/loguj\//);
  });

  await test.step("dołożenie szóstej serii pierwszego ćwiczenia", async () => {
    const pullUpCard = page.locator(".card.card-padless", { hasText: "Podciąganie nachwytem" });
    const addSetButton = pullUpCard.getByRole("button", { name: "Dodaj serię" });

    await addSetButton.click(); // piąta seria — zostaje pusta, nie jest przedmiotem asercji
    await addSetButton.click(); // szósta seria — tę wypełniamy

    await page.locator("#reps-0-5").fill("13");
    await page.locator('label[for="e_0_s_5_diff-5"]').click();
  });

  await test.step("wymiana drugiego ćwiczenia", async () => {
    const pushUpCard = page.locator(".card.card-padless", { hasText: "Pompki klasyczne" });
    await pushUpCard.getByRole("button", { name: "Wymień" }).click();

    const swapDialog = page.getByRole("dialog", { name: "Zamiennik dla: Pompki klasyczne" });
    await swapDialog.getByRole("searchbox", { name: "Szukaj ćwiczenia" }).fill("Deska");
    await swapDialog.getByRole("button", { name: "Deska" }).click();
    await expect(swapDialog).toBeHidden();

    // Zamiana czyści serie wpisu (`swapEntry` w `loguj.$sessionId.tsx`) — bez
    // wypełnienia choćby jednej serii wpis wypadłby z zapisanego logu.
    await page.locator("#reps-1-0").fill("40");
    await page.locator('label[for="e_1_s_0_diff-6"]').click();
  });

  await test.step("dodanie ćwiczenia spoza planu", async () => {
    await page.getByRole("button", { name: "Dodaj ćwiczenie spoza planu" }).click();

    const extraDialog = page.getByRole("dialog", { name: "Ćwiczenie spoza planu" });
    await extraDialog.getByRole("searchbox", { name: "Szukaj ćwiczenia" }).fill("Rozciąganie");
    await extraDialog.getByRole("button", { name: "Rozciąganie barków" }).click();
    await expect(extraDialog).toBeHidden();

    // Bez oceny trudności (`tracksRpe: false` w seederze) — samo powtórzenie.
    await page.locator("#reps-2-0").fill("15");
  });

  await test.step("zapis", async () => {
    await page.getByRole("button", { name: "Zapisz sesję" }).click();
    await expect(page).toHaveURL(/\/podopieczny\/historia\//);
  });

  await test.step("szczegół logu niesie wymianę, dodatek i szóstą serię — w treści", async () => {
    const cards = page.locator(".card.card-padless");
    await expect(cards).toHaveCount(3);

    // 1) Wpis zamieniony niesie NAZWĘ zastąpionego ćwiczenia, nie samą etykietę.
    const swappedCard = page.locator(".card.card-padless", { hasText: "Deska" });
    await expect(swappedCard.locator(".badge")).toHaveText("zamiast: Pompki klasyczne");

    // 2) Wpis spoza planu jest oznaczony I stoi PO obu wpisach planowanych —
    //    przy dokładnie trzech kartach „ostatnia" znaczy „po pozostałych
    //    dwóch", a trzecią w tym scenariuszu może być wyłącznie dodatek.
    const lastCard = cards.last();
    await expect(lastCard.locator("h3")).toHaveText("Rozciąganie barków");
    await expect(lastCard.locator(".badge")).toHaveText("spoza planu");

    // 3) Szósta seria zapisała się z WPISANĄ wartością, nie jako pusty wiersz:
    //    element zaraz za etykietą „#6" niesie w wierszu wypełnionym liczbę
    //    powtórzeń, a w pominiętym słowo „Pominięta" (`historia.$logId.tsx`,
    //    `SetRowDisplay` / `SkippedSetRow`) — rozróżnia je sama treść, nie to,
    //    że coś w ogóle się wyrenderowało.
    const pullUpDetailCard = page.locator(".card.card-padless", {
      hasText: "Podciąganie nachwytem",
    });
    const sixthSetValue = pullUpDetailCard.locator('span.mono:text-is("#6") + span');
    await expect(sixthSetValue).toContainText("13");
  });
});

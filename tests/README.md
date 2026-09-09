# tests/ — testy przez sieć

**Testy integracyjne `*.itest.ts` zniknęły w segmencie S6** razem z bazą po
stronie FE: stały na testcontainerach i realnym Postgresie, a FE nie ma już
czego integrować — dane bierze z kontraktu BE. Ich rolę przejęły dwie rzeczy:

- **testy modułów `app/lib/*.test.ts`** przeciw podstawionemu klientowi
  (`createApiClient` z podstawionym `fetch`) — kontrakt jest typowany, więc
  atrapa nie rozjedzie się z prawdą w ciszy;
- **Playwright przeciw prawdziwemu BE** dla przepływów, które muszą przejść
  przez sieć: logowanie z rotacją tokenu, publikacja planu, zapis treningu,
  zakres tenanta, bramka formularza startowego (spec integracji §10).

Katalog `tests/e2e/` (wskazywany przez `playwright.config.ts`, uruchamiany
przez `npm run e2e`) niesie dziś jeden plik, `sesja-poza-planem.spec.ts`, a w nim
dwa scenariusze: wymianę ćwiczenia W MIEJSCU z dodatkiem spoza planu oraz
PRZESTAWIENIE ćwiczeń (2026-09-09) — oba dowodzone na TREŚCI zapisanego logu,
nie na samej obecności elementu na stronie. Drugi scenariusz powtarza kroki
logowania zamiast dzielić je `beforeEach`-em: przerobienie pierwszego wymagałoby
przebiegu, żeby wiedzieć, że nadal przechodzi, a przebieg prowadzi Właściciel.
Żaden z nich nie był jeszcze uruchomiony (Docker i stack prowadzi Właściciel) —
to pierwszy plik ustala poniższe konwencje, obowiązujące każdy kolejny scenariusz:

- **Konto** — dane demonstracyjne z `calisthenos-be` (`pnpm db:seed`):
  podopieczny `podopieczny1@kalisthenos.test` / hasło `Kalisthenos123!`
  (`dev.seeder.ts`, `SEED_PASSWORD`) — jedyny zasiany podopieczny z aktywnym
  planem i sesjami.
- **Nawigacja klikiem, nie `page.goto` na zgadywany URL** — identyfikatory
  sesji/logów są losowe (baza), a klikanie przez UI dowodzi przy okazji
  przejść między trasami z loaderami po drodze.
- **Selektory: rola/etykieta/tekst tam, gdzie jednoznaczne** (`getByRole`,
  `getByLabel`, plakietki po treści badge'a); **`id` elementu tam, gdzie
  etykieta się powtarza** — pigułka trudności w formularzu logowania ma
  etykietę będącą samą cyfrą, powtórzoną w każdym wierszu każdego ćwiczenia,
  więc pole i pigułka są adresowane przez `id="reps-{eIdx}-{sIdx}"` /
  `id="e_{eIdx}_s_{sIdx}_diff-{wartość}"` (`log-exercise-card.tsx`).
- **Pigułkę trudności klika się przez powiązany `<label for=…>`, nigdy
  `.check()` na samym `<input>`** — `.diff-radio input`
  (`app/styles/tokens.css`) ma `opacity: 0; pointer-events: none`, więc klik
  zawsze musi trafić w widoczną etykietę obok.
- **`eIdx` w identyfikatorach pól to POZYCJA wpisu w formularzu, nie ćwiczenie.**
  Wymiana podmienia wpis W MIEJSCU, więc jej nie rusza — ale przestawienie
  ćwiczeń owszem: po kliknięciu „wyżej" `#reps-0-0` należy już do innego
  ćwiczenia niż przed nim. Scenariusz, który przestawia, musi liczyć indeksy od
  kolejności PO przestawieniu.

---
Konwencja i zasady aktualizacji dokumentacji: [`../CLAUDE.md`](../CLAUDE.md).

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
przez `npm run e2e`) niesie dziś trzy pliki. `sesja-poza-planem.spec.ts` ma
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
- **`page.goto` na adres STATYCZNY jest dozwolony** — reguła „klikiem, nie
  zgadywanym URL-em" chroni przed identyfikatorami losowanymi w bazie (sesja,
  log), nie przed nawigacją na segment znany z góry: to wystarczy samo w
  sobie, niezależnie od tego, czy ekran ma akurat wejście z menu. Doszło przy
  pierwszej wersji `notatki-ai.spec.ts` (Zadanie 17), gdy ekran faktycznie
  nie miał jeszcze wejścia z nawigacji. `a977d0e` dołożył pozycję „Notatki AI"
  do menu trenera, więc ten plik dziś wchodzi na ekran KLIKIEM (poprawione
  przy przeglądzie, W3a) — wyjątek zostaje tu opisany jako możliwość dla
  przyszłych scenariuszy, którym nie zależy akurat na dowiedzeniu tego
  konkretnego przejścia.

`notatki-ai.spec.ts` (Zadanie 17) dowodzi jednej gałęzi włącznika notatek AI —
trenera BEZ podłączonego kalendarza (jedyny stan, jaki gwarantuje seeder: nie
zakłada wiersza `calendar_connections`). Gałąź „kalendarz podłączony → włączenie
działa" wymagałaby prawdziwej zgody Google, do której to repozytorium nie ma
konta testowego — i której backend celowo nie da się tu podstawić (`calendar-
port.ts` w `apps/api-e2e` rzuca na każde wywołanie sieciowe zamiast cicho
przepuszczać). Pełne uzasadnienie — w docblocku tego pliku. Test trasy przeciw podstawionemu
klientowi, wzorem `integracje.google.test.tsx`, dziś istnieje:
`integracje.notatki-ai.test.tsx` w tym samym katalogu co trasa — dopisany
przy przeglądzie tej gałęzi (W2), skoro dokładnie to zgłosił jako rekomendację
raport Zadania 17.

`rejestracja.spec.ts` (rejestracja trenera, krok 1 — 2026-10-03) jest jedynym plikiem BEZ
konta z seedera: dowodzi ścieżki osoby, która konta jeszcze nie ma, więc konwencja „Konto” go
nie dotyczy. Trzy scenariusze: (1) odnośnik z `/login` na `/rejestracja`, wysłanie unikalnego
adresu → „Sprawdź skrzynkę” z tym adresem, potem „Wyślij ponownie” — dowodem jest ciało
żądania: ukryte pole `email`, jedyne powiązanie widoku sukcesu z akcją, niesie ten sam adres.
Widoku po ponownym wysłaniu nie da się odróżnić od widoku sprzed kliknięcia, a wartości pola nie
podmienia się w teście — React je kontroluje i przywraca przy każdym renderze; (2)
`/rejestracja/nieistniejacy-token` → „Link jest nieważny albo wygasł”, droga po nowy link
i nagłówki strony z tokenem (`Referrer-Policy: strict-origin`, `Cache-Control: no-store`, CSP
odziedziczone z roota); (3) `/dokumenty/nie-ma/1` → `404`. Krok 2 (link z maila, zgody,
założenie konta) leży poza plikiem — pokrywa go e2e BE i test trasy przeciw podstawionemu
klientowi. Warunki, od których zależy zieleń (pełny opis — w docblocku pliku):

- **BE z `REGISTRATION_OPEN=true`** (scenariusze 1 i 2) — bez zmiennej rejestracja jest
  zamknięta i oba widzą „Rejestracja kont trenerów jest chwilowo zamknięta.”. Scenariusz 3 jej
  nie potrzebuje.
- **Adres bez `+tag`** (`e2e-<znacznik>@kalisthenos.test`) — limit zgłoszeń (3 na godzinę) liczy
  skrzynkę kanoniczną, więc `e2e+1@…` i `e2e+2@…` to jedna skrzynka.
- **Budżet limitu po łączu** — `POST /v1/registrations` ma 10 żądań na godzinę, a plik zużywa
  cztery na przebieg (dwa na projekt): przy domyślnym limicie to dwa pełne przebiegi na godzinę.
- **BE bez `LETTERMINT_API_TOKEN`** — poczty test nie czyta, a z tokenem poszłyby prawdziwe maile.

Uruchomienie: `npm run e2e -- tests/e2e/rejestracja.spec.ts` (oba projekty) albo z dopiskiem
`--project=desktop` (połowa budżetu). Plik nie był jeszcze uruchomiony — pisany na punkt
kontrolny C planu tras rejestracji.

---
Konwencja i zasady aktualizacji dokumentacji: [`../CLAUDE.md`](../CLAUDE.md).

# kalisthenos — mapa drzewa FE

Polskojęzyczna aplikacja webowa do współpracy **trener ↔ podopieczny** w kalistenice. Trener
prowadzi bibliotekę ćwiczeń, układa wersjonowane plany i ogląda historię treningów; podopieczny
loguje treningi seria-po-serii, wrzuca zdjęcia sylwetki i przegląda statystyki. UI podopiecznego
jest mobile-first i instalowalny jako PWA; UI trenera desktop-first.

> **Ten plik jest mapą, nie podręcznikiem.** Cykl pracy, reguły przekrojowe i bramki stoją
> w `CLAUDE.md` **korzenia** (`calisthenos-fullstack`), bo przecinają oba drzewa. Opis katalogu
> stoi w jego `README.md`. Tutaj jest tylko to, czego nie widać z żadnego z tych miejsc.

**Konwencja README-per-katalog pochodzi stąd i jest wzorcem dla całego układu.** Drzewo BE
przejęło ją w etapie E6 przebudowy cyklu pracy; ten katalog robił to od początku.

## Granica, której nie przekraczasz

- **Docker i uruchamianie stacku prowadzi Właściciel.** Testy Playwright i pętlę zrzutów
  ekranu piszesz, ale nie uruchamiasz.

Do 2026-09-07 granice były dwie — drugą był git. **Zniesiona decyzją Właściciela: agent
commituje w tym drzewie tak samo jak w BE.**

## Commit w tym drzewie kosztuje więcej uwagi niż w BE

Nie dlatego, że reguły są ostrzejsze — dlatego, że **nie ma tu żadnego hooka gita.** BE ma
lefthooka: prettier, eslint i commitlint biegną przy każdym commicie i nie przepuszczą pliku
niesformatowanego ani nagłówka spoza konwencji. Tutaj **nie biegnie nic**. Dopóki commitował
Właściciel, bramką był człowiek patrzący na diff; agenta ta bramka nie obejmuje.

Skutek praktyczny: **`npm run lint` NIE wystarcza przed commitem.** To `biome lint`, czyli sam
linter — formatowania nie dotyka. Pełne sprawdzenie to `npx biome check`, ale **na zmienionych
plikach, nie na `.`**: na tej maszynie `core.autocrlf=true` wypakowuje całe drzewo z CRLF,
a Biome chce LF, więc `check .` zwraca dziś **260 błędów** o samych zakończeniach linii
i Twój diff w nich ginie. To jest defekt środowiska, nie kodu — opisany jako D-FE-1
w `docs/defekty.md`.

Konwencja commita jest ta sama, co w BE: **konwencjonalny, po polsku**, nagłówek do 100 znaków,
treść opisująca decyzję. Gałąź robocza, nie `master` wprost — to drzewo idzie przez PR-y.

## Stack

| Warstwa | Wybór |
| --- | --- |
| Framework | **React Router v7** (framework mode, SSR, loadery i akcje na trasach) |
| Język | TypeScript (strict) |
| Dane | **Brak własnej bazy.** Wszystko przez kontrakt `calisthenos-be` (`@kalisthenos/api-client`) |
| Auth | sesja na tokenach z backendu, ciastko `__Host-kth_api`, rotacja w middlewarze |
| Pliki | **w całości w backendzie (R2)**; wysyłka dwufazowa, odczyt po podpisanych adresach |
| PWA | `vite-plugin-pwa` — cache statyków i instalowalność, bez synchronizacji offline |
| Wykresy | visx (SVG, przyjazne SSR) |
| Walidacja | Zod |
| Lint i format | **Biome** |
| Menedżer | **npm**, nie pnpm |
| Hosting | Railway — sama aplikacja, bez bazy i bez wolumenu |

## Mapa projektu

Każdy wpis linkuje do `README.md` katalogu — tam jest konkret.

- [`app/`](app/README.md) — [`routes/`](app/routes/README.md)
  ([trener](app/routes/trener/README.md), [podopieczny](app/routes/podopieczny/README.md)),
  [`components/`](app/components/README.md),
  [`lib/`](app/lib/README.md) ([api](app/lib/api/README.md), [auth](app/lib/auth/README.md)),
  [`styles/`](app/styles/README.md)
- [`design-system/`](design-system/README.md) — brand, tokeny, podgląd
- [`scripts/`](scripts/README.md) · [`public/`](public/README.md) · [`tests/`](tests/README.md)
  · [`docs/`](docs/README.md) · [`prototype/`](prototype/README.md)

**Driver niosą wyłącznie katalogi będące modułami kodu** — `app/lib`, `app/lib/api`,
`app/lib/auth`, `app/routes`, `app/components`. Pozostałe zostają tym, czym były.

Dwa świadome odstępstwa od konwencji drzewa BE:

- **README tego drzewa NIE mają sześciu stałych nagłówków.** Ich konwencja — liść opisuje swoje
  pliki, gałąź jest indeksem — jest starsza, działa i to **ona była wzorcem** dla całej
  przebudowy. Narzucanie na nią drugiej struktury zniszczyłoby jedną, żeby dołożyć drugą.
  Driver dochodzi jako blok, reszta zostaje.
- **Katalogi zasobów i `design-system/` drivera nie dostają.** `public/fonts` nie ma archetypu
  ani profilu obciążenia, a `design-system/` jest dokumentem systemu wizualnego, nie modułem
  kodu. Pole wypełniane „nie dotyczy" przestaje być czytane.

## Procedury tego drzewa

Pięć skilli w `calisthenos-fe/.claude/skills/`, wołanych **z prefiksem drzewa**:

| Skill | Kiedy |
| --- | --- |
| `calisthenos-fe:route` | nowa albo zmieniona trasa |
| `calisthenos-fe:lib-module` | moduł rozmawiający z backendem, test-first |
| `calisthenos-fe:component` | komponent współdzielony |
| `calisthenos-fe:list` | lista z sortowaniem, filtrowaniem, szukajką |
| `calisthenos-fe:e2e-test` | Playwright przeciw prawdziwemu backendowi |

Wejścia cyklu (`/feature`, `/change`, `/fix`, `/remove`, `/refactor`, `/probe`, `/finish`) są
bez prefiksu — mieszkają w korzeniu.

## Konwencje, których nie widać z kodu

- **Trasa to plik PLUS wpis w `app/routes.ts`.** Sam plik daje martwy komponent i nic tego nie
  zgłasza.
- **Trasy nie wołają klienta.** Zabroniony import **wartości** z `~/lib/api/client`
  i z `@kalisthenos/api-client`; `import type` wolno. Pilnuje tego
  `app/routes/no-direct-api.test.ts` — **następca `no-direct-db.test.ts`**, ten sam szew,
  zmieniła się druga strona.
- **Zakres najemcy niesie token, egzekwuje backend.** Moduły `app/lib/*` nie mają argumentu
  `trainerId`/`traineeId` jako filtra. Brak autoryzacji → **`404`**, nie `403`.
- **Kontrakt jest źródłem prawdy.** Typy DTO **re-eksportuj z pakietu**, nie przepisuj. Zmiana
  modelu zaczyna się w `calisthenos-be`.
- **Origin do plików dokłada `publicFileUrl` W MODULE**, nigdy w trasie ani w komponencie.
  Odnośnik przychodzi jako ścieżka, bo podpisuje go backend.
- **TDD jest normą.** Moduły `app/lib` test-first przeciw podstawionemu klientowi;
  `npx vitest run <wzorzec>`, **nie `npm test`** (to tryb obserwowania).
- **UI po polsku**, brand `kalisthenos` małą literą, angielskie tylko nazwy ćwiczeń.

## Komendy — pojedynczo, bez łańcuchowania

Reguły `allow` dopasowują **pojedynczą komendę po prefiksie**. Łańcuch (`&&`), potok albo
przekierowanie sprawia, że komenda przestaje pasować i wyskakuje okienko.

| Komenda | Do czego |
| --- | --- |
| `npm run typecheck` | sprawdzenie typów |
| `npm run lint` | Biome |
| `npm run build` | build SSR i klienta — **jedyna bramka łapiąca osierocony import** |
| `npx vitest run <wzorzec>` | testy jednostkowe |
| `npx biome format --write <plik>` | formatowanie |

`npm install` i Docker — **wyłącznie Właściciel**. Git prowadzi agent (patrz wyżej).

## Pułapka, która kosztuje najwięcej czasu

**Osierocony import wciąga serwer do bundla przeglądarki.** Nieużywany import modułu
serwerowego przechodzi `tsc` **bez słowa** i wywala się dopiero na `npm run build`. Dlatego
build jest w tym drzewie bramką, nie formalnością — i dlatego usuwa się importy, które
„zaraz się przydadzą".

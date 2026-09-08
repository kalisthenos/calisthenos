# Sesja poza planem (drzewo FE) — plan wykonania

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dać podopiecznemu na ekranie logowania trzy rzeczy, których dziś nie ma: dołożenie
serii ponad plan, wymianę ćwiczenia na inne z biblioteki trenera i dorzucenie ćwiczenia spoza
planu — a w szczegółach logu, po obu stronach, pokazać, skąd wziął się każdy wpis.

**Architecture:** Lista ćwiczeń w formularzu przestaje być odbiciem planu i staje się **stanem**:
wpisy niosą pochodzenie (`planned` / `substitute` / `extra`), a liczba wierszy serii jest
edytowalna. Wymiana **zastępuje wpis w miejscu**, bo N14 w backendzie zabrania logować
jednocześnie ćwiczenie zastąpione i jego zamiennik. Kształt listy wpisów jedzie do akcji jednym
ukrytym polem; wartości serii zostają w polach `name`, tak jak dziś.

**Tech Stack:** React Router v7 (framework mode, SSR), TypeScript strict, Zod, Biome, Vitest,
Playwright, npm. Dane wyłącznie przez `@kalisthenos/api-client`.

**Spec:** `calisthenos-be/docs/superpowers/specs/2026-09-07-sesja-poza-planem-design.md` §13

**Poprzednik:** `calisthenos-be/docs/superpowers/plans/2026-09-07-sesja-poza-planem-be.md` —
**domknięty 2026-09-07**, trzynaście zadań, gałąź `feat/sesja-poza-planem`, `c2f5da0..0af0ec1`.
Ten plan stoi na `origin` w kontrakcie i na trasie `GET /v1/me/exercises`, więc **zaczyna się
dopiero po wydaniu pakietu klienta** — patrz Zadanie 1.

**Gałąź:** `feat/sesja-poza-planem` **już istnieje w tym drzewie i jest wybrana** — nie zakładaj
jej ponownie. Gałąź główna tego drzewa nazywa się **`master`**, nie `main` (sprawdzone
2026-09-08); to drzewo idzie przez PR-y.

## Global Constraints

- **W tym drzewie NIE MA żadnego hooka gita.** Nic nie sprawdzi commita za Ciebie. Przed każdym
  commitem uruchamiasz sam: `npx tsc --noEmit`, `npx biome check <zmienione pliki>`.
- **`npx biome check .` jest bezużyteczne na tej maszynie** — `core.autocrlf=true` daje ~260
  błędów o zakończeniach linii i Twój diff w nich ginie (D-FE-1). Sprawdzaj **zmienione pliki**.
- **`npm run lint` NIE wystarcza** — to sam linter, formatowania nie dotyka.
- **Testy: `npx vitest run <wzorzec>`, nigdy `npm test`** (to tryb obserwowania i nigdy nie wraca).
- **`npm install` i Docker prowadzi Właściciel.** Testy e2e **piszesz, nie uruchamiasz**.
- **Git prowadzi agent** — od 2026-09-07, tą samą konwencją co w BE (`calisthenos-fe/CLAUDE.md`,
  „Granica, której nie przekraczasz"). **Pięć procedur tego drzewa mówi dziś inaczej** — mają
  w sekcji „Domknięcie" nieaktualne zdanie o gicie. Poprawia to **Zadanie 0** i dlatego stoi
  pierwsze; do czasu jego domknięcia obowiązuje `CLAUDE.md`, nie skill.
- **Przeczytaj procedurę swojego zadania PRZED pierwszą linią kodu.** Gdy sesja stoi
  w `calisthenos-fe`, wołasz ją nazwą (`calisthenos-fe:route`). Gdy stoi w **korzeniu**,
  narzędzie `Skill` procedur drzew **nie widzi** — wtedy czytasz plik wprost:
  `calisthenos-fe/.claude/skills/<nazwa>/SKILL.md`. Liczy się treść, nie mechanizm; pliki mają
  po 50–70 wierszy.
- **`npm run build` jest bramką, nie formalnością** — i w tym planie ma znaczenie szczególne.
  Osierocony import modułu serwerowego przechodzi `tsc` **bez słowa** i wywala się dopiero na
  buildzie. **Zadanie 7 przenosi trzysta linii między plikami**, czyli jest to dokładnie ten
  rodzaj zmiany, po którym w trasie zostają importy bez użytkownika. Uruchom build po Zadaniu 7
  **i** po Zadaniu 8.
- **Komendy pojedynczo, bez łańcuchowania.** Reguły `allow` dopasowują pojedynczą komendę po
  prefiksie; `&&`, potok albo przekierowanie wywołuje okienko uprawnień.
- **Trasa to plik PLUS wpis w `app/routes.ts`.** Sam plik daje martwy komponent i nic tego
  nie zgłasza.
- **Trasy nie wołają klienta.** Zabroniony import **wartości** z `~/lib/api/client`
  i z `@kalisthenos/api-client`; `import type` wolno. Pilnuje `app/routes/no-direct-api.test.ts`.
- **Typy DTO re-eksportuj z pakietu, nie przepisuj.** Kontrakt jest źródłem prawdy.
- **Zakres najemcy niesie token, egzekwuje backend.** Moduły `app/lib` nie mają argumentu
  `trainerId`/`traineeId` jako filtra. Brak autoryzacji → **`404`**, nie `403`.
- **TDD jest normą** dla modułów `app/lib` — test-first przeciw podstawionemu klientowi.
- **UI po polsku**, brand `kalisthenos` małą literą, angielskie tylko nazwy ćwiczeń.
- Commit konwencjonalny, po polsku, nagłówek do 100 znaków.

## Decyzja, która przenika cały plan

**Wymiana zastępuje wpis W MIEJSCU, nie dokłada się obok niego.** Backend odmawia
(`SUBSTITUTED_EXERCISE_ALSO_LOGGED`, N14), gdy ten sam log niesie ćwiczenie zastąpione jako
`planned` i jego zamiennik — bo „zamiast" i „oraz" wykluczają się. Zamiana w miejscu daje to
za darmo, zachowuje kolejność ćwiczeń z planu i sprawia, że `allDone` liczy się bez wyjątków:
wpis zamieniony **jest** wpisem, więc nie ma czego wyłączać z rachunku.

Wynika z tego jedna rzecz nieoczywista: **zamiana czyści wpisane serie tego wpisu**. Zamiennik
może mieć inną flagę oceny trudności, więc wiersze wypełnione pod stare ćwiczenie byłyby
niepoprawne. Liczba wierszy zostaje — cel serii z planu nadal obowiązuje.

## File Structure

| Plik | Odpowiedzialność | Zadanie |
| --- | --- | --- |
| `package.json` | podbicie `@kalisthenos/api-client` — **modyfikacja** | 1 |
| `app/lib/exercises.ts` | `listActiveExercisesForTrainee` — **modyfikacja** | 2 |
| `app/routes/biblioteka-cwiczen.tsx` | trasa zasobowa dla wybieraka — **nowy** | 3 |
| `app/routes.ts` | wpis trasy zasobowej — **modyfikacja** | 3 |
| `app/lib/log-draft.ts` | szkic v4: pochodzenie i zmienna liczba serii — **modyfikacja** | 4 |
| `app/lib/workouts.ts` | `toLogEntries`, budowanie ładunku — **modyfikacja** | 5 |
| `app/components/exercise-picker.tsx` | modal jednokrotnego wyboru — **nowy** | 6 |
| `app/components/log-exercise-card.tsx` | karta ćwiczenia wyjęta z trasy — **nowy** | 7 |
| `app/routes/podopieczny/loguj.$sessionId.tsx` | dynamiczne wiersze, wymiana, dodatek — **modyfikacja** | 8 |
| `app/routes/podopieczny/historia.$logId.tsx` | oznaczenie pochodzenia — **modyfikacja** | 9 |
| `app/routes/trener/podopieczni.$traineeId.log.$logId.tsx` | to samo u trenera — **modyfikacja** | 9 |
| `tests/e2e/sesja-poza-planem.spec.ts` | ścieżka wymiany i dodatku — **nowy** | 10 |
| `app/lib/README.md`, `app/components/README.md`, `app/routes/README.md`, `tests/README.md` | mapy katalogów — **modyfikacja** | 11 |
| `.claude/skills/{lib-module,list,route,component,e2e-test}/SKILL.md` | domknięcie zgodne z polityką gita — **modyfikacja** | 0 |

## Rejestr nowych bytów

**Żadne zadanie tego planu nie buduje konstruktu, którego katalog procedur nie zna.** Pięć
procedur drzewa FE plus `contract-change` z korzenia pokrywają komplet: moduł `app/lib`, trasa,
trasa zasobowa, komponent, test Playwrighta, druga połowa zmiany kontraktu. Nie zakłada się więc
żadnej nowej procedury — a to jest twierdzenie, nie przeoczenie.

Dwie kandydatury rozważono i **odrzucono świadomie**:

| Kandydat | Dlaczego nie osobna procedura |
| --- | --- |
| **Trasa zasobowa** (sam `loader`, bez komponentu) | to przypadek szczególny `calisthenos-fe:route`, nie inny konstrukt: te same dwa miejsca (plik + `app/routes.ts`), ten sam zakaz importu klienta. Drugie wystąpienie w drzewie (po `upload.wideo.tsx`) — **brakujący akapit w istniejącej procedurze, nie brakująca procedura**. Zapisać przy `/finish` |
| **Podbicie wersji szkicu** (`log-draft` v2 → v3 → v4) | wraca, ale **w jednym pliku**, więc jego domem jest docblock modułu i `app/lib/README.md`. Procedura z jednym klientem to procedura, której nikt nie znajdzie w chwili, gdy jej potrzebuje |

**Zadanie 0 nie zakłada procedury — poprawia pięć istniejących.** Powód niżej; jest to warunek
wykonalności całej reszty planu, nie porządki przy okazji.

---

# Blok 0 — warstwa procesu

### Task 0: Pięć procedur FE mówi nieprawdę o gicie

**Skill:** brak — to poprawka samych procedur, więc procedury opisującej ją nie ma i nie będzie:
korekta faktu w skillu jest jednorazowa z definicji, a jej ślad zostaje w commicie.

**Files:**

- Modify: `.claude/skills/lib-module/SKILL.md`
- Modify: `.claude/skills/list/SKILL.md`
- Modify: `.claude/skills/route/SKILL.md`
- Modify: `.claude/skills/component/SKILL.md`
- Modify: `.claude/skills/e2e-test/SKILL.md`

**Interfaces:**

- Consumes: `calisthenos-fe/CLAUDE.md`, wiersze 20–21 i 128.
- Produces: pięć procedur, których sekcja „Domknięcie" zgadza się z polityką drzewa.

**Dlaczego to stoi PRZED Zadaniem 1, a nie w `/finish`.** Wszystkie pięć procedur kończy się
zdaniem, że **git prowadzi Właściciel**. To był fakt do 2026-09-07 i przestał nim być decyzją
Właściciela — `calisthenos-fe/CLAUDE.md` mówi dziś wprost: „Zniesiona decyzją Właściciela: agent
commituje w tym drzewie tak samo jak w BE" (wiersz 20) i „Git prowadzi agent" (wiersz 128).

Procedury zostały z poprzednim stanem. Konsekwencja jest mechaniczna, nie teoretyczna: **każde
zadanie tego planu każe wykonawcy przeczytać swoją procedurę przed pierwszą linią kodu**, a każde
zadanie kończy się commitem. Wykonawca dostanie więc dwa sprzeczne polecenia i nie ma jak
rozstrzygnąć, które jest świeższe — plik skilla nie nosi daty.

To jest zmiana warstwy procesu, więc obowiązuje ją reguła z `CLAUDE.md` korzenia: **zmienia
sposób, w jaki powstaje kod, więc ciężar co najmniej średni.** Zakres jest jednak wąski —
korekta faktu, zero nowej reguły — i cała mieści się w sekcjach „Domknięcie".

- [ ] **Krok 1: Popraw pięć sekcji „Domknięcie"**

Zdania do zastąpienia, dosłownie takie stoją dziś w plikach:

| Plik | Dziś |
| --- | --- |
| `lib-module` | `Kończysz na /finish — **git prowadzi Właściciel**.` |
| `list` | `Kończysz na /finish — **git prowadzi Właściciel**.` |
| `route` | `pamiętaj, że **w tym drzewie git prowadzi Właściciel**, więc zamknięcie to relacja, nie commit.` |
| `component` | `Kończysz na /finish — **git i Docker prowadzi Właściciel**.` |
| `e2e-test` | `**Git i Docker prowadzi Właściciel.**` |

Nowa treść niesie **obie** granice — tę, która padła, i te, które stoją — bo skill, z którego
zniknęła granica, czyta się jak skill, w którym granic nie ma:

> Kończysz na `/finish`. **Git prowadzi agent** — od 2026-09-07, tą samą konwencją co w BE.
> Ale to drzewo **nie ma ani jednego hooka gita**, więc przed `git commit` uruchamiasz sam:
> `npx tsc --noEmit` i `npx biome check <zmienione pliki>` — po plikach, nie po `.` (D-FE-1).
> **`npm install` i Docker nadal prowadzi Właściciel.**

W `component` i `e2e-test` człon o Dockerze **zostaje** — tam jest nadal prawdziwy; zmienia się
wyłącznie człon o gicie. W `e2e-test` zostaje też zdanie o nieuruchamianiu Playwrighta.

- [ ] **Krok 2: Sprawdź, że nie została ani jedna kopia**

Run: `grep -rn "git prowadzi Właściciel\|Git i Docker prowadzi" calisthenos-fe/.claude/skills/`
Expected: brak trafień.

- [ ] **Krok 3: Commit**

Commit idzie w drzewie FE (`calisthenos-fe`), bo `.claude/skills/` tego drzewa należy do jego
repozytorium:

```bash
git add .claude/skills/lib-module/SKILL.md .claude/skills/list/SKILL.md .claude/skills/route/SKILL.md .claude/skills/component/SKILL.md .claude/skills/e2e-test/SKILL.md
git commit -m "docs(skille): pięć procedur FE nadąża za polityką gita z 2026-09-07"
```

---

# Blok A — kontrakt i moduły danych

### Task 1: Podbicie klienta API

**Skill:** `contract-change` — **kroki 5 i 6**, czyli druga połowa procedury przecinającej oba drzewa. Mieszka w **korzeniu** i wołasz ją **bez prefiksu**. Kroki 1–4 przeszły Zadaniem 12 planu BE; `calisthenos-be:regen-client` ma `disable-model-invocation: true` i **stąd go nie wołasz**.

Ta procedura nosi `status: proponowany`, a to zadanie jest **pierwszym przebiegiem jej drugiej
połowy** — kroki 5–6 nie były dotąd wykonane ani razu. Jeśli coś w niej nie zgadza się
z rzeczywistością, **to jest znalezisko do zapisania**, nie przeszkoda do obejścia: `/finish`
tego planu awansuje ją na `przyjęty` albo poprawia o to, co wyszło.

**Files:**

- Modify: `package.json`
- Modify: `package-lock.json` (przez `npm install`, nie ręką)

**Interfaces:**

- Consumes: pakiet `@kalisthenos/api-client` wydany po planie BE. **Dziś w tym drzewie stoi
  `0.3.0`**; changeset podnosi `0.4.0 → 0.5.0`.
- Produces — **nazwy dosłowne, odczytane z wygenerowanego klienta w BE 2026-09-08**, nie z opisu
  zmiany. Krok 6 procedury sprawdza tę listę, nie wymyśla własnej:

  | Co | Nazwa |
  | --- | --- |
  | operacja listy | `myExercisesControllerList` → `GET /v1/me/exercises` |
  | jej parametry | `page`, `q`, `sort`, `unit`, `tag` — **`status` NIE ISTNIEJE** |
  | typ `sort` | unia `'name' \| '-name' \| 'newest' \| 'oldest'`, nie goły napis |
  | odpowiedź | `ExercisePage` = `{ items: ExerciseView[]; page; totalPages; total }` |
  | pola potrzebne z `ExerciseView` | `id`, `name`, `unit`, **`tracksRpe`** |
  | zapis | `LogWorkoutExerciseDto.origin`, `.substitutedExerciseId` |
  | odczyt | `WorkoutLogExerciseView.origin`, `.substitutedExerciseId`, `.substitutedExerciseName` |
  | przegląd | `PlanSessionUsageView.offPlan`, `PlanExerciseUsageView.substitutedBy` |

  **`LogWorkoutExerciseDto.sets` nie ma `maxItems` i nie będzie miał** — sufit 50 serii
  egzekwuje reguła domenowa, a przekroczenie wraca jako `400 WORKOUT_LOG_TOO_LARGE`
  z `details.limit` i `details.got`. Decyzja Właściciela z 2026-09-08; nie odtwarzaj tej
  granicy po stronie FE jako twardej blokady pola, bo nie jest częścią kontraktu.

- [ ] **Krok 1: Poproś właściciela o podbicie zależności**

**`npm install` w tym drzewie należy do właściciela** (`CLAUDE.md` drzewa FE, sekcja Komendy).
Nie uruchamiaj go sam:

> Plan BE domknięty, klient wydany. Podbij proszę zależność:
> `npm install @kalisthenos/api-client@latest` — potrzebuję z niego `origin` na wpisie
> ćwiczenia i operacji listy dla `/v1/me/exercises`.

- [ ] **Krok 2: Sprawdź, że nowe pola faktycznie są w typach**

Dwa sprawdzenia, **nie jedno** — bo lista z pola **Produces** ma dwa rodzaje pozycji, a jedna
komenda widzi tylko jeden z nich. Operacja jest **eksportowaną funkcją**, więc widać ją w czasie
wykonania; pole DTO jest **typem**, więc znika przy kompilacji i `Object.keys` go nie zobaczy
**nigdy** — także wtedy, gdy regeneracja poszła bez zarzutu.

```bash
node -e "console.log(Object.keys(require('@kalisthenos/api-client')).filter(k=>/[Ee]xercise/.test(k)).join('\n'))"
```

Szukasz operacji listy dla `GET /v1/me/exercises` — funkcji, której dziś w tej liście **nie ma**.

```bash
grep -n -A9 "^export type WorkoutLogExerciseView" node_modules/@kalisthenos/api-client/dist/generated/types.gen.d.ts
```

Szukasz trzech pól: `origin`, `substitutedExerciseId`, `substitutedExerciseName`. Dziś ten typ ma
dokładnie cztery pola (`exerciseId`, `exerciseName`, `unit`, `sets`) — **sprawdzone 2026-09-08**,
więc masz z czym porównać wynik i „nic się nie zmieniło" nie przejdzie za sukces.

```bash
npx tsc --noEmit
```

**Jeśli którejkolwiek z tych rzeczy nie ma — zatrzymaj się i wróć do Kroku 5 procedury**, czyli
do prośby o instalację. Znaczy to, że któryś z kroków 2–4 (regeneracja, `oasdiff`, changeset) nie
doszedł do końca albo pakiet nie został wydany. **Nie obchodź tego ręcznym typem DTO** — kroki
6 i „Czego nie robić" procedury zabraniają tego wprost: przepisany typ przestaje być kontraktem
w chwili, gdy kontrakt się realnie zmieni, i nie zgłosi tego nic.

- [ ] **Krok 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): klient API z pochodzeniem wpisu i trasą /v1/me/exercises"
```

---

### Task 2: `listActiveExercisesForTrainee`

**Skill:** `calisthenos-fe:lib-module` — jedyne miejsce, które rozmawia z backendem, pisane test-first przeciw podstawionemu klientowi.

**`calisthenos-fe:list` świadomie NIE obowiązuje w tym zadaniu — rozstrzygnięte tutaj, nie
w wykonaniu.** Tamta procedura rządzi **widokiem nawigowalnym**: porządkiem, zawężaniem
i szukajką zapisanymi w adresie, przez `parseListControls` i `<ListControls>`. Wybierak jest
modalem — nie ma adresu, do którego miałby cokolwiek zapisać, nie przeżywa odświeżenia i nie da
się go wysłać odnośnikiem, więc trzy powody istnienia tamtej konwencji odpadają naraz.

Jedno ostrzeżenie z tamtej procedury **zostaje w mocy i trzeba je odnotować**: „lista pobierająca
wszystko i tnąca w locie działa do pierwszego trenera z setką podopiecznych". Tutaj granicą jest
biblioteka **jednego** trenera przy stronie po 24, a nie katalog — dokładnie ta sama granica,
którą przyjął i zapisał w docblocku `listActiveExercisesForTrainer`. Powielamy istniejący
precedens, nie zakładamy drugiej konwencji; gdy biblioteki urosną, zmiana zaczyna się
w kontrakcie, nie tutaj.

**Files:**

- Modify: `app/lib/exercises.ts`
- Test: `app/lib/exercises.test.ts`

**Interfaces:**

- Consumes: operacja listy `/v1/me/exercises` z klienta.
- Produces:
  `listActiveExercisesForTrainee(api: Api): Promise<Array<{ id: string; name: string; unit: "REPS" | "SEC"; tracksRpe: boolean }>>`

**Bliźniak `listActiveExercisesForTrainer` (`app/lib/exercises.ts:26`), z jedną różnicą:**
wozi `tracksRpe`. Wybierak trenera go nie potrzebował, bo trener wybiera ćwiczenie **do planu**,
gdzie flaga nie wpływa na formularz. Podopieczny wybiera ćwiczenie **do zalogowania** — a od
tej flagi zależy, czy wiersz serii pokaże pole oceny trudności.

- [ ] **Krok 1: Napisz test**

W `app/lib/exercises.test.ts`, wzorem istniejących przypadków tego pliku (podstawiony klient,
nie prawdziwy):

```ts
describe("listActiveExercisesForTrainee", () => {
  it("skleja wszystkie strony w jedną listę", async () => {
    const api = stubApi({
      // Dwie strony po dwa: pętla ma zejść po `totalPages`, nie po długości
      // pierwszej strony — inaczej biblioteka powyżej rozmiaru strony urywa się
      // po cichu, a wybierak pokazuje wycinek wyglądający jak całość.
      "/v1/me/exercises": [
        { items: [ex("a", "Podciąganie"), ex("b", "Deska")], page: 1, totalPages: 2, total: 4 },
        { items: [ex("c", "Rower"), ex("d", "Wiosło")], page: 2, totalPages: 2, total: 4 },
      ],
    });

    const wynik = await listActiveExercisesForTrainee(api);

    expect(wynik.map((e) => e.name)).toEqual(["Podciąganie", "Deska", "Rower", "Wiosło"]);
  });

  it("wozi tracksRpe, bo od niego zależy kształt wiersza serii", async () => {
    const api = stubApi({
      "/v1/me/exercises": [
        { items: [{ ...ex("a", "Deska"), tracksRpe: false }], page: 1, totalPages: 1, total: 1 },
      ],
    });

    expect(await listActiveExercisesForTrainee(api)).toEqual([
      { id: "a", name: "Deska", unit: "REPS", tracksRpe: false },
    ]);
  });
});
```

Nazwy pomocników (`stubApi`, `ex`) dopasuj do tych, które ten plik **już ma** — nie wprowadzaj
drugiej konwencji podstawiania klienta.

- [ ] **Krok 2: Uruchom — ma paść**

Run: `npx vitest run app/lib/exercises.test.ts`
Expected: FAIL — „listActiveExercisesForTrainee is not a function".

- [ ] **Krok 3: Napisz moduł**

**Dwie pułapki, obie sprawdzone w kodzie 2026-09-08, obie ciche.**

**Pierwsza: `allPages` nie istnieje.** Dziś `listActiveExercisesForTrainer`
(`app/lib/exercises.ts:26`) niesie pętlę `for` **w swoim ciele**, wołając prywatny
`activeExercisePage`. Wydzielenie wspólnego `allPages` jest więc **zmianą także wariantu
trenera**, a ten karmi edytor planu i formularz startowy. To refaktor jadący na barana:
`calisthenos-fe:lib-module` żąda test-first, a `/refactor` z korzenia — **zielonych testów przed
dotknięciem kodu**. Kolejność jest zatem sztywna: najpierw `npx vitest run
app/lib/exercises.test.ts` na nietkniętym pliku (istniejące testy wariantu trenera mają być
zielone), potem wydzielenie, potem znów ten sam przebieg. Jeśli wolisz tego uniknąć — **powiel
pętlę i zostaw wariant trenera nietknięty**; sześć wierszy duplikatu jest tańsze niż niezamierzona
zmiana w dwóch działających ekranach. Rozstrzygnij i **zapisz powód w ciele commita**.

**Druga: `status` w zapytaniu daje `400`, nie ciche pominięcie.** Wariant trenera wysyła
`query: { page, sort: "name", status: "active" }`. Kopiując go, skopiujesz `status` — a
`MyExerciseListQuery` **nie ma tego pola**: status jest po tamtej stronie wymuszony na `active`
i to jest zawężenie kontraktu, nie wartość domyślna. Backend stoi na `whitelist +
forbidNonWhitelisted`, więc `?status=active` wraca jako **`400`**, nie jako zignorowany parametr.
Dozwolone są `page`, `q`, `sort`, `unit`, `tag`.

Operacja klienta nazywa się **`myExercisesControllerList`** i bierze
`{ client: api, query: { page, sort: 'name' }, throwOnError: true }` — bez `status`. Kształt
docelowy niżej; pomocnik strony nazwij wzorem `activeExercisePage`, czyli `myExercisePage`:

```ts
export interface PickableExercise {
  id: string;
  name: string;
  unit: "REPS" | "SEC";
  tracksRpe: boolean;
}

/**
 * Czynne ćwiczenia trenera, do którego podopieczny jest przypięty
 * (`GET /v1/me/exercises`, ADR-0038). Zakres najemcy niesie token — ten moduł
 * NIE ma i nie może mieć argumentu `trainerId`.
 *
 * Wszystkie strony naraz, jak u trenera: wybierak filtruje po stronie klienta,
 * bo tak robi `OnboardingPicker` i druga konwencja na to samo zadanie kosztuje
 * więcej, niż daje. Biblioteka ma rozmiar biblioteki jednego trenera, nie katalogu.
 */
export async function listActiveExercisesForTrainee(api: Api): Promise<PickableExercise[]> {
  const items = await allPages((page) => myExercisePage(api, page));
  return items.map((e) => ({
    id: e.id,
    name: e.name,
    unit: e.unit,
    tracksRpe: e.tracksRpe,
  }));
}
```

- [ ] **Krok 4: Uruchom — ma przejść**

Run: `npx vitest run app/lib/exercises.test.ts`
Expected: PASS, razem z istniejącymi testami wariantu trenera.

- [ ] **Krok 5: Sprawdź i commituj**

```bash
npx tsc --noEmit
npx biome check app/lib/exercises.ts app/lib/exercises.test.ts
git add app/lib/exercises.ts app/lib/exercises.test.ts
git commit -m "feat(lib): czynna biblioteka trenera widziana przez podopiecznego"
```

---

### Task 3: Trasa zasobowa wybieraka

**Skill:** `calisthenos-fe:route` — plik PLUS wpis w `app/routes.ts`, i ten sam zakaz importu wartości z klienta.

**Trasa zasobowa jest przypadkiem, którego ta procedura NIE opisuje** — mówi „loader czyta, akcja
mutuje" i zakłada komponent. Tutaj komponentu nie ma: sam `loader`, wzorem
`app/routes/upload.wideo.tsx`. Reszta procedury obowiązuje bez zmian, bo trasa zasobowa to nadal
**dwa miejsca** (plik + `app/routes.ts`) i nadal nie wolno jej wołać klienta. Po tym zadaniu będą
w drzewie dwa takie pliki, więc **luka w procedurze przestaje być jednorazowa** — dopisanie do
niej akapitu o trasach zasobowych jest pozycją dla `/finish`, odnotowaną w rejestrze wyżej.

**Files:**

- Create: `app/routes/biblioteka-cwiczen.tsx`
- Modify: `app/routes.ts`
- Test: `app/routes/biblioteka-cwiczen.test.ts`

**Interfaces:**

- Consumes: `listActiveExercisesForTrainee` (Zadanie 2), `requireUser`.
- Produces: `GET /biblioteka-cwiczen` → `{ exercises: PickableExercise[] }`.

Trasa **zasobowa** — sam `loader`, bez komponentu, wzorem `app/routes/upload.wideo.tsx`. Stoi
**poza** blokiem `prefix("podopieczny", …)`, bo nie należy do layoutu; tak samo jak `upload/wideo`.

**Dlaczego osobna trasa, a nie ładowanie biblioteki w loaderze ekranu logowania:** wybierak
otwiera się rzadko, a ekran logowania ładuje się przy każdym wejściu na trening — na telefonie,
często na słabym zasięgu. Biblioteka schodzi więc **leniwie**, przy pierwszym otwarciu wybieraka,
przez `useFetcher`.

- [ ] **Krok 1: Napisz test**

```ts
it("oddaje czynne ćwiczenia trenera podopiecznej", async () => {
  const { loader } = await import("./biblioteka-cwiczen");
  const wynik = await loader(kontekstPodopiecznej());
  expect(wynik.exercises.map((e) => e.name)).toEqual(["Deska", "Podciąganie"]);
});

it("odmawia trenerowi", async () => {
  const { loader } = await import("./biblioteka-cwiczen");
  await expect(loader(kontekstTrenera())).rejects.toThrow();
});
```

- [ ] **Krok 2: Uruchom — ma paść**

Run: `npx vitest run app/routes/biblioteka-cwiczen.test.ts`
Expected: FAIL — plik nie istnieje.

- [ ] **Krok 3: Napisz trasę**

```tsx
import type { LoaderFunctionArgs } from "react-router";
import { requireUser } from "~/lib/api/auth";
import { listActiveExercisesForTrainee } from "~/lib/exercises";

/**
 * Trasa ZASOBOWA — sam `loader`, bez komponentu (wzorem `upload.wideo.tsx`).
 * Karmi wybierak ćwiczeń na ekranie logowania sesji: biblioteka schodzi leniwie,
 * przy pierwszym otwarciu modala, a nie przy każdym wejściu na trening.
 *
 * Zakres najemcy niesie token i egzekwuje backend — ta trasa nie zna i nie może
 * znać identyfikatora trenera.
 */
export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainee" });
  return { exercises: await listActiveExercisesForTrainee(api) };
}
```

- [ ] **Krok 4: Dopisz wpis do `app/routes.ts`**

Obok `route("upload/wideo", …)`, czyli **poza** blokiem `podopieczny`:

```ts
  route("biblioteka-cwiczen", "routes/biblioteka-cwiczen.tsx"),
```

**Bez tego wpisu trasa nie istnieje** i nic tego nie zgłosi — `useFetcher` dostanie `404`
dopiero w przeglądarce.

- [ ] **Krok 5: Uruchom testy trasy i strażnika importów**

Run: `npx vitest run app/routes/biblioteka-cwiczen.test.ts app/routes/no-direct-api.test.ts`
Expected: PASS. Drugi test pilnuje, żeby trasa nie zaimportowała **wartości** z klienta —
`requireUser` i `listActiveExercisesForTrainee` są w porządku, bezpośredni import z
`@kalisthenos/api-client` nie.

- [ ] **Krok 6: Sprawdź i commituj**

```bash
npx tsc --noEmit
npx biome check app/routes/biblioteka-cwiczen.tsx app/routes/biblioteka-cwiczen.test.ts app/routes.ts
git add app/routes/biblioteka-cwiczen.tsx app/routes/biblioteka-cwiczen.test.ts app/routes.ts
git commit -m "feat(trasy): zasobowa trasa biblioteki ćwiczeń dla wybieraka"
```

---

### Task 4: Szkic v4

**Skill:** `calisthenos-fe:lib-module` — mimo że ten moduł z backendem nie rozmawia. Obowiązuje z niego reguła test-first i konwencja modułu `app/lib`.

**Files:**

- Modify: `app/lib/log-draft.ts`
- Test: `app/lib/log-draft.test.ts`

**Interfaces:**

- Consumes: nic.
- Produces: `type DraftEntry`, `serializeDraft(planExerciseIds, entries)`,
  `parseDraft(raw, { planExerciseIds })`, `draftHasContent(entries)`.

Dzisiejszy `parseDraft` odrzuca szkic, gdy `row.length !== expected.setCounts[i]`
(`app/lib/log-draft.ts:73`) — czyli **każdy** szkic z dodatkową serią. Kryterium zgodności
przenosi się z „ta sama liczba serii" na „ten sam **plan**": lista ćwiczeń planu w tej samej
kolejności. Liczbę serii i pochodzenie szkic wozi teraz sam, bo to właśnie one są treścią.

- [ ] **Krok 1: Napisz testy**

```ts
const PLAN = ["a", "b"];

function wpis(over: Partial<DraftEntry> = {}): DraftEntry {
  return {
    exerciseId: "a",
    exerciseName: "Podciąganie",
    unit: "REPS",
    tracksRpe: true,
    origin: "planned",
    substitutedExerciseId: null,
    sets: [{ reps: "8", difficulty: "7", skipped: false, videoFileId: null }],
    ...over,
  };
}

it("przywraca szkic z LICZBĄ SERII inną niż plan", () => {
  // Sedno v4: dokładnie ten przypadek v3 odrzucało, i to bez komunikatu.
  const raw = serializeDraft(PLAN, [wpis({ sets: [seria(), seria(), seria()] }), wpis({ exerciseId: "b" })]);
  expect(parseDraft(raw, { planExerciseIds: PLAN })?.[0].sets).toHaveLength(3);
});

it("przywraca zamiennik razem z tym, co zastąpił", () => {
  const raw = serializeDraft(PLAN, [
    wpis({ exerciseId: "z", exerciseName: "Wiosło", origin: "substitute", substitutedExerciseId: "a" }),
    wpis({ exerciseId: "b" }),
  ]);
  expect(parseDraft(raw, { planExerciseIds: PLAN })?.[0]).toMatchObject({
    origin: "substitute",
    substitutedExerciseId: "a",
  });
});

it("przywraca dodatek spoza planu wraz z jego nazwą i flagą oceny", () => {
  // Nazwa i `tracksRpe` jadą W SZKICU, nie są dociągane: przywrócenie dzieje się
  // przy montowaniu komponentu, a biblioteka schodzi dopiero przy otwarciu
  // wybieraka. Cena: po zmianie nazwy przez trenera szkic pokaże starą — przez
  // jedną sesję przeglądarki i wyłącznie w etykiecie, bo do backendu jedzie
  // identyfikator.
  const raw = serializeDraft(PLAN, [wpis(), wpis({ exerciseId: "b" }), wpis({
    exerciseId: "c", exerciseName: "Rower", tracksRpe: false, origin: "extra",
  })]);
  const wynik = parseDraft(raw, { planExerciseIds: PLAN });
  expect(wynik?.[2]).toMatchObject({ origin: "extra", exerciseName: "Rower", tracksRpe: false });
});

it("odrzuca szkic, gdy trener zmienił ćwiczenia planu", () => {
  const raw = serializeDraft(["a", "b"], [wpis(), wpis({ exerciseId: "b" })]);
  expect(parseDraft(raw, { planExerciseIds: ["a", "x"] })).toBeNull();
});

it("odrzuca szkice v3 — migracja nie jest warta kodu", () => {
  // Szkice żyją przez sesję przeglądarki. Wstawienie danych o niepełnym
  // kształcie byłoby gorsze niż start od zera; ta sama decyzja co przy v2.
  expect(parseDraft(JSON.stringify({ v: 3, exerciseIds: PLAN, sets: [[]] }), { planExerciseIds: PLAN })).toBeNull();
});

it("szkic z samym dodatkiem MA treść", () => {
  // Dodatek spoza planu jest treścią sam w sobie, nawet z pustymi seriami:
  // podopieczny podjął decyzję, której nie chcemy mu kazać podejmować drugi raz.
  expect(draftHasContent([wpis({ origin: "extra", sets: [seria({ reps: "" })] })])).toBe(true);
});
```

- [ ] **Krok 2: Uruchom — mają paść**

Run: `npx vitest run app/lib/log-draft.test.ts`
Expected: FAIL — sygnatury `serializeDraft`/`parseDraft` się nie zgadzają.

- [ ] **Krok 3: Przepisz moduł**

```ts
export type DraftEntry = {
  exerciseId: string;
  /** Etykieta, nie klucz — do backendu jedzie wyłącznie `exerciseId`. */
  exerciseName: string;
  unit: "REPS" | "SEC";
  tracksRpe: boolean;
  origin: "planned" | "substitute" | "extra";
  substitutedExerciseId: string | null;
  sets: SetDraft[];
};

/**
 * Wersja 4: wpisy zamiast macierzy serii. Szkice v3 są ODRZUCANE — żyją tylko
 * przez sesję przeglądarki, więc migracja nie jest warta kodu (ta sama decyzja,
 * co przy odrzuceniu v2).
 *
 * `planExerciseIds` (od v2, wtedy `exerciseIds`) zostaje kryterium zgodności,
 * ale znaczy teraz **ćwiczenia PLANU**, nie ćwiczenia szkicu: te drugie mogą się
 * od planu różnić i o to w tej zmianie chodzi. Liczba serii przestaje być
 * kryterium — była nim dopóty, dopóki pochodziła z planu.
 */
type DraftShape = { v: 4; planExerciseIds: string[]; entries: DraftEntry[] };
```

`parseDraft` waliduje: `v === 4`, zgodność `planExerciseIds` co do długości i kolejności, oraz
typ każdego pola każdego wpisu i każdej serii. **Waliduj pole po polu, jak dziś** — `sessionStorage`
jest danymi niezaufanymi tak samo jak ciało żądania.

`draftHasContent(entries)` zwraca `true`, gdy którykolwiek wpis ma `origin !== "planned"` albo
którakolwiek seria ma treść (dotychczasowy warunek).

- [ ] **Krok 4: Uruchom — mają przejść**

Run: `npx vitest run app/lib/log-draft.test.ts`
Expected: PASS.

- [ ] **Krok 5: Sprawdź i commituj**

```bash
npx tsc --noEmit
npx biome check app/lib/log-draft.ts app/lib/log-draft.test.ts
git add app/lib/log-draft.ts app/lib/log-draft.test.ts
git commit -m "feat(lib): szkic logu v4 — pochodzenie wpisu i zmienna liczba serii"
```

Uwaga: `loguj.$sessionId.tsx` przestanie się teraz kompilować. To jest w porządku — naprawia
to Zadanie 8. **Nie łataj trasy tutaj**, bo wtedy Zadanie 8 zaczyna się od kodu, którego nikt
nie zaprojektował.

---

### Task 5: Wpisy logowania i budowanie ładunku

**Skill:** `calisthenos-fe:lib-module` — test-first, i **to on rozstrzyga, gdzie ma stać budowanie ładunku**: `app/lib` jest jedyną warstwą rozmawiającą z kontraktem, więc sześćdziesiąt linii składania ciała żądania nie należy do akcji trasy. Przenosiny są przy tym refaktorem istniejącego zachowania — `toLoggingEntries` ma dziś swoje testy i mają być **zielone przed dotknięciem pliku**.

**Files:**

- Modify: `app/lib/workouts.ts`
- Test: `app/lib/workouts.test.ts`

**Interfaces:**

- Consumes: `SessionDetailView` z kontraktu, `DraftEntry` (Zadanie 4).
- Produces: `toLogEntries(session): LogEntry[]` (następca `toLoggingEntries`),
  `buildLogPayload(entries): { exerciseId; origin; substitutedExerciseId; sets }[]`.

Dziś `toLoggingEntries` (`app/lib/workouts.ts:108`) oddaje wpisy **odbijające plan**, a akcja
trasy buduje ładunek w swoim ciele, 60 linii wewnątrz `try`. Budowanie ładunku przenosi się
tutaj i dostaje własne testy, bo od tej zmiany ma trzy przypadki brzegowe zamiast zera.

- [ ] **Krok 1: Napisz testy**

```ts
it("wpis planowany niesie origin planned i pusty wskaźnik", () => {
  expect(buildLogPayload([wpis()])[0]).toMatchObject({
    origin: "planned",
    substitutedExerciseId: null,
  });
});

it("zamiennik niesie wskaźnik na zastąpione ćwiczenie", () => {
  const payload = buildLogPayload([
    wpis({ exerciseId: "z", origin: "substitute", substitutedExerciseId: "a" }),
  ]);
  expect(payload[0]).toMatchObject({ exerciseId: "z", substitutedExerciseId: "a" });
});

it("ćwiczenie zastąpione NIE trafia do ładunku", () => {
  // N14 po stronie backendu: „zamiast" i „oraz" wykluczają się. Wymiana
  // zastępuje wpis w miejscu, więc to wychodzi samo — ten test pilnuje, żeby
  // wyszło samo także po przyszłej zmianie kształtu stanu.
  const payload = buildLogPayload([
    wpis({ exerciseId: "z", origin: "substitute", substitutedExerciseId: "a" }),
    wpis({ exerciseId: "b" }),
  ]);
  expect(payload.map((e) => e.exerciseId)).toEqual(["z", "b"]);
});

it("serie pominięte zostawiają DZIURĘ w ordinalach", () => {
  // Dziura znaczy serię pominiętą i ma przeżyć zapis — `ordinal` jest pozycją
  // PLANOWANĄ, nie indeksem w tablicy.
  const payload = buildLogPayload([
    wpis({ sets: [seria({ reps: "8" }), seria({ reps: "" }), seria({ reps: "6" })] }),
  ]);
  expect(payload[0].sets.map((s) => s.ordinal)).toEqual([0, 2]);
});

it("serie dołożone ponad plan dostają kolejne ordinale", () => {
  const payload = buildLogPayload([
    wpis({ plannedSets: 2, sets: [seria(), seria(), seria()] }),
  ]);
  expect(payload[0].sets.map((s) => s.ordinal)).toEqual([0, 1, 2]);
});

it("wpis bez ani jednej wypełnionej serii wypada z ładunku", () => {
  // Inaczej backend odmówiłby całemu logowi (`EMPTY_WORKOUT_LOG` dotyczy
  // całości, ale ćwiczenie bez serii jest dla agregatu wyrażalne i bezużyteczne).
  expect(buildLogPayload([wpis({ sets: [seria({ reps: "" })] })])).toEqual([]);
});
```

- [ ] **Krok 2: Uruchom — mają paść**

Run: `npx vitest run app/lib/workouts.test.ts`
Expected: FAIL — `buildLogPayload` nie istnieje.

- [ ] **Krok 3: Napisz `LogEntry` i dwie funkcje**

```ts
export interface LogEntry {
  /** Stabilny klucz Reacta — NIE indeks: wpisy dochodzą i są wymieniane. */
  key: string;
  exerciseId: string;
  exerciseName: string;
  unit: "REPS" | "SEC";
  tracksRpe: boolean;
  origin: "planned" | "substitute" | "extra";
  substitutedExerciseId: string | null;
  /** Nazwa zastąpionego — do etykiety „zamiast: …". `null` poza zamianą. */
  substitutedExerciseName: string | null;
  /** Cel z planu — podpowiedź, nie ograniczenie. `null` dla `extra`. */
  plannedSets: number | null;
  expectedReps: number | null;
  note: string | null;
  isDropsetItem: boolean;
  sets: SetDraft[];
}
```

`toLogEntries(session)` robi to, co `toLoggingEntries`, plus: `origin: "planned"`,
`substitutedExerciseId: null`, `plannedSets` z dotychczasowego `expectedSets`, `key` z
`planItemId`, i `sets` wypełnione pustymi wierszami w liczbie `plannedSets`.

`buildLogPayload(entries)` odpowiada za: pominięcie wpisów bez wypełnionych serii, zachowanie
dziury w `ordinal`, przełożenie `origin` i wskaźnika. **Walidację komunikatów zostaw w akcji** —
tam są nazwy ćwiczeń i numery serii potrzebne do zdania po polsku.

Zostaw `toLoggingEntries` jako alias przez jeden commit? **Nie.** W tym drzewie nie ma zewnętrznych
konsumentów tej funkcji — jedynym jest trasa logowania, którą i tak przepisujesz w Zadaniu 8.

- [ ] **Krok 4: Uruchom — mają przejść**

Run: `npx vitest run app/lib/workouts.test.ts`
Expected: PASS.

- [ ] **Krok 5: Sprawdź i commituj**

```bash
npx tsc --noEmit
npx biome check app/lib/workouts.ts app/lib/workouts.test.ts
git add app/lib/workouts.ts app/lib/workouts.test.ts
git commit -m "feat(lib): wpisy logowania z pochodzeniem i budowanie ładunku poza trasą"
```

---

# Blok B — komponenty

### Task 6: Wybierak ćwiczeń

**Skill:** `calisthenos-fe:component` — zgodność z design-systemem i **zakaz własnych wywołań backendu** w komponencie. Dlatego lista wchodzi propsem albo `useFetcher`-em z trasy, nigdy importem klienta.

**`frontend-design:frontend-design` świadomie NIE jest wołany**, choć procedura komponentu
odsyła do niego „gdy zmiana dotyka wyglądu". To zadanie **składa** wybierak z rzeczy, które
drzewo już ma — `Modal` z `app/components/modal.tsx` i układ listy wzorem `OnboardingPicker` —
a nie projektuje nowego widoku. Nie wprowadzasz przy tym **żadnej** wartości koloru, odstępu ani
kroju wprost; wszystko idzie tokenami z `app/styles/`. Gdyby wybierak miał dostać własny język
wizualny, to jest osobne zadanie i wtedy tamta procedura wchodzi.

**Files:**

- Create: `app/components/exercise-picker.tsx`
- Test: `app/components/exercise-picker.test.ts`

**Interfaces:**

- Consumes: `PickableExercise` (Zadanie 2), trasa `/biblioteka-cwiczen` (Zadanie 3).
- Produces: `<ExercisePicker open onClose onPick title excludeIds />` — modal jednokrotnego wyboru.

Wzorem `OnboardingPicker` (`app/components/onboarding-picker.tsx`): szukajka po stronie klienta
nad wczytaną listą. Różnice: wybór **jednokrotny**, modal (nie sekcja formularza), lista schodzi
przez `useFetcher` przy pierwszym otwarciu.

- [ ] **Krok 1: Napisz testy — bez renderowania**

**Rozstrzygnięte tutaj, sprawdzone w drzewie 2026-09-08: `@testing-library/react` NIE jest
zainstalowane.** Jest `happy-dom` i vitest ma na nim `environment`, a `app/**/*.test.tsx` stoi
w `include` — ale **w `app/components/` nie ma dziś ani jednego testu**. Dołożenie
testing-library znaczyłoby `npm install` (Właściciel) **i** założenie pierwszej konwencji testów
komponentów w tym drzewie — obie rzeczy są decyzją Właściciela, nie skutkiem ubocznym zadania
o wybieraku. **Nie dokładaj zależności.**

Testujesz więc **czystą funkcję filtrującą**, wydzieloną z komponentu — a nie komponent:

```ts
// app/components/exercise-picker.test.ts — .ts, nie .tsx: nic tu nie renderuje
import { filterExercises } from "./exercise-picker";

const ex = (id: string, name: string) => ({ id, name, unit: "REPS" as const, tracksRpe: true });

it("filtruje po nazwie, bez względu na wielkość liter", () => {
  const lista = [ex("a", "Podciąganie"), ex("b", "Deska")];
  expect(filterExercises(lista, "desk").map((e) => e.name)).toEqual(["Deska"]);
});

it("odsiewa ćwiczenie, które właśnie zastępujemy", () => {
  const lista = [ex("a", "Podciąganie"), ex("b", "Deska")];
  expect(filterExercises(lista, "", ["b"]).map((e) => e.name)).toEqual(["Podciąganie"]);
});

it("pusta szukajka oddaje całość, nie pustkę", () => {
  const lista = [ex("a", "Podciąganie"), ex("b", "Deska")];
  expect(filterExercises(lista, "  ")).toHaveLength(2);
});
```

Zachowanie samego modala — otwarcie, wybór, Esc, komunikat pustej biblioteki — schodzi pod
scenariusz Playwrighta z Zadania 10. **Zapisz tę granicę w docblocku komponentu**, żeby następny
czytelnik nie wziął braku testu renderującego za przeoczenie.

- [ ] **Krok 2: Uruchom — ma paść**

Run: `npx vitest run app/components/exercise-picker.test.ts`
Expected: FAIL — plik nie istnieje.

- [ ] **Krok 3: Napisz komponent**

Kluczowe własności, każda z powodem:

- **`excludeIds`** — ćwiczenie, które właśnie zastępujesz, nie może być swoim zamiennikiem
  (backend odmówiłby `SUBSTITUTION_MISPLACED`). Odsiewamy je w wybieraku, żeby użytkownik nie
  dowiadywał się tego z błędu po zapisie.
- **Etykieta jednostki przy nazwie** (`powt.` / `sek.`) — podopieczny wybiera ćwiczenie, które
  zaraz będzie liczył; bez tego nie wie, czy wpisze powtórzenia, czy sekundy.
- **Ładowanie leniwe** — `useFetcher` do `/biblioteka-cwiczen` przy pierwszym `open`, z widocznym
  stanem ładowania. Drugie otwarcie nie pyta ponownie.
- **Modal bierzesz z `app/components/modal.tsx`** — ten komponent **istnieje** (sprawdzone
  2026-09-08) i eksportuje `Modal({ open, onClose, title, wide, children })`, czyli dokładnie
  powierzchnię, której to zadanie potrzebuje. Zamknięcie Esc i kliknięciem tła jest jego
  własnością, nie Twoją. **Nie pisz drugiego modala** — drzewo ma już `modal.tsx`,
  `video-modal.tsx`, `photo-lightbox.tsx` i `confirm-provider.tsx`; piąty sposób zamykania
  okienka to piąte miejsce do poprawienia.

- [ ] **Krok 4: Uruchom, sprawdź, commituj**

```bash
npx vitest run app/components/exercise-picker.test.ts
npx tsc --noEmit
npx biome check app/components/exercise-picker.tsx app/components/exercise-picker.test.ts
git add app/components/exercise-picker.tsx app/components/exercise-picker.test.ts
git commit -m "feat(komponenty): wybierak ćwiczeń z biblioteki trenera"
```

---

### Task 7: Karta ćwiczenia wyjęta z trasy

**Skill:** `calisthenos-fe:component` — ta sama reguła. Komponent po przeniesieniu ma być zgodny z design-systemem; jeśli przenoszony kod nie jest, **to jest osobne zadanie**, nie poprawka przy okazji.

**Files:**

- Create: `app/components/log-exercise-card.tsx`
- Modify: `app/routes/podopieczny/loguj.$sessionId.tsx` (usunięcie przeniesionego kodu)

**Interfaces:**

- Consumes: `LogEntry`, `SetDraft`, `VideoUploadField`.
- Produces: `<LogExerciseCard entry index onUpdateSet onSkipSet onAddSet onRemoveSet onSwap onRemoveEntry />`.

**To jest przeniesienie, nie przepisanie.** `EntryCard` (linia ~693), `SetRow` (~815),
`SkippedSetRow` (~953) i `tierFor` (~809) wyprowadzają się z trasy do własnego pliku
**bez zmiany zachowania**. Trasa ma dziś **1001 linii**; bez tego kroku Zadanie 8 dołożyłoby do
niej kilkaset kolejnych i plik przestałby być edytowalny.

Nowe przyciski dokłada dopiero Zadanie 8 — tutaj wyłącznie zmiana miejsca zamieszkania.

- [ ] **Krok 1: Przenieś cztery jednostki bez zmiany ciała**

Wytnij `EntryCard`, `SetRow`, `SkippedSetRow` i `tierFor` do `app/components/log-exercise-card.tsx`.
Wyeksportuj `LogExerciseCard` (dawne `EntryCard`); trzy pozostałe zostają prywatne w module.
Przenieś razem z nimi importy, których używają (`VideoUploadField`, `Icons`, `pluralizePl`).

- [ ] **Krok 2: Podstaw import w trasie**

```tsx
import { LogExerciseCard } from "~/components/log-exercise-card";
```

- [ ] **Krok 3: Sprawdź, że zachowanie się nie zmieniło**

```bash
npx tsc --noEmit
npx vitest run app/lib
```

Nie ma tu testu jednostkowego do napisania i **to jest świadome**: refaktor bez zmiany
zachowania dowodzi się tym, że istniejące testy i typy przechodzą bez zmiany. Jeśli musiałeś
cokolwiek w ciele poprawić, żeby się skompilowało — **to nie było przeniesienie** i wraca do
Kroku 1.

- [ ] **Krok 4: Commit**

```bash
npx biome check app/components/log-exercise-card.tsx "app/routes/podopieczny/loguj.\$sessionId.tsx"
git add app/components/log-exercise-card.tsx "app/routes/podopieczny/loguj.\$sessionId.tsx"
git commit -m "refactor(loguj): karta ćwiczenia wyprowadza się z trasy do komponentu"
```

---

# Blok C — ekran logowania

### Task 8: Dynamiczne wiersze, wymiana i dodatek

**Skill:** `calisthenos-fe:route` — zmieniona trasa, loader i akcja.

**Files:**

- Modify: `app/routes/podopieczny/loguj.$sessionId.tsx`
- Modify: `app/components/log-exercise-card.tsx` (trzy nowe przyciski)

**Interfaces:**

- Consumes: wszystko z Zadań 2–7.
- Produces: ekran logowania, który przyjmuje trzy sytuacje ze specu §1.

Najgrubszy kawałek planu. Rozłożony na cztery kroki, każdy z osobnym sprawdzeniem, **żeby nie
powstał jeden commit, którego nikt nie przejrzy**.

- [ ] **Krok 1: Stan przechodzi z macierzy na listę wpisów**

`useState<SetState[][]>` (linia ~214) zastępuje `useState<LogEntry[]>` zasilany
`toLogEntries(session)`. `updateSet`, `skipSet` i `handleVideoState` adresują wpis przez
**indeks w liście**, tak jak dziś — zmienia się to, że lista może rosnąć i że jej element może
zostać podmieniony.

Pola formularza zostają przy nazwach `e_${i}_s_${j}_*`. **Dochodzi jedno ukryte pole**:

```tsx
<input type="hidden" name="entries" value={JSON.stringify(entries.map(descriptorOf))} />
```

gdzie `descriptorOf` oddaje `{ exerciseId, exerciseName, tracksRpe, origin, substitutedExerciseId, setCount }`.

**Dlaczego ukryte pole, a nie ponowne wyprowadzenie kształtu z planu w akcji:** akcja nie ma jak
znać wpisów spoza planu — z definicji nie ma ich w sesji. Deskryptory są danymi od klienta
i akcja traktuje je **wyłącznie jako kształt do przeczytania pól i do ułożenia komunikatu**.
Autorytetem dla `origin`, przynależności i flagi oceny pozostaje backend (N5′, N2, N13, N14).
Najgorszy skutek podrobionego deskryptora to komunikat mniej trafny niż `409` z backendu.

- [ ] **Krok 2: Trzy operacje na liście**

```tsx
// „+ dodaj serię" — kolejny wiersz ponad plan. Sufit 50 z N15 pilnuje backend,
// ale przycisk gaśnie wcześniej: odmowa po wypełnieniu 51 wierszy byłaby
// karą za pracę, którą podopieczny już wykonał.
const addSet = (eIdx: number) => { /* … */ };

// „–" przy wierszu — zdejmuje WYŁĄCZNIE wiersze ponad plan (`sIdx >= plannedSets`).
// Wiersz planowany zostaje pusty, bo dziura w `ordinal` jest informacją
// („seria pominięta"), a nie brakiem danych.
const removeSet = (eIdx: number, sIdx: number) => { /* … */ };

// „Wymień ćwiczenie" — zastępuje wpis W MIEJSCU (patrz „Decyzja" na górze planu).
// Serie CZYŚCIMY: zamiennik może mieć inną flagę oceny trudności, więc wiersze
// wypełnione pod stare ćwiczenie byłyby niepoprawne. Liczba wierszy zostaje.
const swapEntry = (eIdx: number, picked: PickableExercise) => { /* … */ };

// „Cofnij wymianę" — przywraca wpis z `toLogEntries(session)` po tym samym kluczu.
const undoSwap = (eIdx: number) => { /* … */ };

// „Dodaj ćwiczenie spoza planu" — dokłada wpis na KOŃCU listy, `plannedSets: null`,
// jeden pusty wiersz serii na start.
const addExtraEntry = (picked: PickableExercise) => { /* … */ };
```

Wpis `extra` dostaje też „usuń" — inaczej pomyłka w wybieraku jest nie do cofnięcia bez
przeładowania strony i utraty całego formularza. Wpisu `planned` usunąć **nie wolno**: pominięcie
ćwiczenia wyraża się pustymi seriami, a nie zniknięciem, i tak czyta to delta plan↔wykonanie.

- [ ] **Krok 3: `allDone` i pasek postępu**

```tsx
// Wpis zamieniony JEST wpisem, więc liczy się normalnie — to jest cała nagroda
// za wymianę w miejscu. Wpisy `extra` nie wchodzą do mianownika: dorzucone
// ćwiczenie nie może sprawić, że plan wygląda na niewykonany.
const doPoliczenia = entries.filter((e) => e.origin !== "extra");
```

`allDone` to „każdy wpis z `doPoliczenia` ma wypełnione **wszystkie planowane** wiersze".
Wiersze ponad plan nie mogą go zepsuć — mogą wyłącznie dołożyć.

- [ ] **Krok 4: Akcja czyta deskryptory zamiast planu**

Pętla `for (const [eIdx, entry] of entries.entries())` (linia ~91) iteruje po **deskryptorach
z formularza**, a wewnętrzna `for (let sIdx = 0; sIdx < entry.expectedSets; sIdx++)`
(linia ~102) — po `descriptor.setCount`. Ładunek składa `buildLogPayload` z Zadania 5;
w akcji zostaje wyłącznie walidacja dająca zdanie po polsku.

Deskryptory parsuj **Zodem**, nie `JSON.parse` wprost: to dane niezaufane, a `sessionStorage`
i ukryte pole są tym samym rodzajem wejścia co ciało żądania.

- [ ] **Krok 5: Sprawdź całość i commituj**

```bash
npx tsc --noEmit
npx vitest run app/lib app/routes
npx biome check "app/routes/podopieczny/loguj.\$sessionId.tsx" app/components/log-exercise-card.tsx
git add "app/routes/podopieczny/loguj.\$sessionId.tsx" app/components/log-exercise-card.tsx
git commit -m "feat(loguj): dodatkowe serie, wymiana ćwiczenia i wpisy spoza planu"
```

- [ ] **Krok 6: Poproś właściciela o obejrzenie ekranu**

> Ekran logowania gotowy. Stacku nie uruchamiam — zerknij proszę na `/podopieczny/loguj/:id`:
> czy „+ dodaj serię", „wymień ćwiczenie" i „dodaj ćwiczenie spoza planu" robią to, czego
> oczekujesz, i czy pasek postępu nie kłamie po wymianie.

---

# Blok D — szczegóły i domknięcie

### Task 9: Pochodzenie w dwóch szczegółach logu

**Skill:** `calisthenos-fe:route` — dwie zmienione trasy.

**Files:**

- Modify: `app/routes/podopieczny/historia.$logId.tsx`
- Modify: `app/routes/trener/podopieczni.$traineeId.log.$logId.tsx`

**Interfaces:**

- Consumes: `WorkoutLogExerciseView.origin`, `.substitutedExerciseName` z kontraktu.
- Produces: nic dla kodu.

**Oba ekrany, nie jeden.** Trener i podopieczny oglądają ten sam log dwoma trasami i rozjazd
między nimi jest w tym kontekście udokumentowaną pułapką (podpisy nagrań). Etykieta pochodzenia
ma brzmieć **tak samo** po obu stronach.

- [ ] **Krok 1: Dodaj etykietę przy nazwie ćwiczenia**

| `origin` | Etykieta |
| --- | --- |
| `planned` | brak — to przypadek domyślny i nie zasługuje na szum |
| `substitute` | `zamiast: {substitutedExerciseName}` |
| `extra` | `poza planem` |

- [ ] **Krok 2: Sprawdź i commituj**

```bash
npx tsc --noEmit
npx biome check "app/routes/podopieczny/historia.\$logId.tsx" "app/routes/trener/podopieczni.\$traineeId.log.\$logId.tsx"
git add app/routes/podopieczny app/routes/trener
git commit -m "feat(historia): pochodzenie wpisu w szczególe logu po obu stronach"
```

---

### Task 10: Playwright — pisany, nieuruchamiany

**Skill:** `calisthenos-fe:e2e-test` — **przeczytaj go, zanim zdecydujesz o kształcie scenariusza**. Mówi wprost: używać oszczędnie i świadomie, dla przepływów, których nie da się dowieść przy podstawionym kliencie, i nazywa dwa sposoby, na jakie taki test przechodzi z niewłaściwego powodu.

**Files:**

- Create: `tests/e2e/sesja-poza-planem.spec.ts`

**Interfaces:**

- Consumes: cały ekran po Zadaniu 8.
- Produces: scenariusz do uruchomienia przez właściciela.

**Piszesz, nie uruchamiasz.** Docker i stack prowadzi Właściciel — to granica tego drzewa,
a skill mówi, dlaczego nie jest to wygoda: bez działającego backendu Playwright **nie padnie na
asercji, tylko nie wystartuje**, a to w logu wygląda inaczej niż czerwień i bywa przeoczone.

**Katalog jest przygotowany, ale PUSTY — i to jest stan sprawdzony, nie domysł.** `tests/`
zawiera dziś wyłącznie `README.md`; `playwright.config.ts` ma już `testDir: "./tests/e2e"`,
a `package.json` — skrypt `e2e`. Konfiguracji więc **nie zakładasz**. Zakładasz za to **plik
pierwszy w tym katalogu**, więc:

> **Nie ma się na czym wzorować w `tests/`.** Cokolwiek ustalisz — nazwy selektorów, sposób
> logowania, przygotowanie danych — **zostanie skopiowane** do każdego następnego scenariusza.
> Wybieraj świadomie i zapisz wybór w `tests/README.md` (Zadanie 11), nie tylko w kodzie.

- [ ] **Krok 1: Napisz jeden scenariusz**

Ścieżka: wejście na sesję → dołożenie szóstej serii → wymiana drugiego ćwiczenia → dodanie
ćwiczenia spoza planu → zapis → szczegół logu pokazuje `zamiast: …` i `poza planem`.

Trzy asercje, każda na **treści**, nie na obecności elementu — skill nazywa „asercję na tym, że
coś się wyrenderowało" jednym z dwóch sposobów przejścia z niewłaściwego powodu:

1. wpis zamieniony niesie **nazwę ćwiczenia zastąpionego**, nie samą etykietę „zamiast";
2. wpis spoza planu jest oznaczony **i stoi po wpisach planowanych**;
3. szósta seria zapisała się z **wpisaną wartością**, nie jako pusty wiersz.

- [ ] **Krok 2: Poproś Właściciela o uruchomienie**

Komenda tego drzewa to `npm run e2e` (`package.json`), a `testDir` niesie już konfiguracja:

> Scenariusz gotowy, nie uruchamiam go. Gdy będziesz miał stack, uruchom proszę
> `npm run e2e` — to pierwszy plik w `tests/e2e/`, więc jest to zarazem pierwszy przebieg
> Playwrighta w tym drzewie i może wymagać `npx playwright install`.

- [ ] **Krok 3: Commit**

```bash
npx biome check tests/e2e/sesja-poza-planem.spec.ts
git add tests/e2e/sesja-poza-planem.spec.ts
git commit -m "test(e2e): ścieżka wymiany i ćwiczenia spoza planu"
```

---

### Task 11: README i domknięcie

**Skill:** brak — aktualizacja map katalogów nie jest osobnym konstruktem, tylko krokiem 2 procedury `/finish`, który tu dostaje własne zadanie wyłącznie dlatego, że dotyka czterech dokumentów naraz. Samo domknięcie idzie `/finish` z korzenia.

**Files:**

- Modify: `app/lib/README.md`, `app/components/README.md`, `app/routes/README.md`, `tests/README.md`

**Interfaces:**

- Consumes: całość.
- Produces: dokumenty mówiące to samo, co kod.

- [ ] **Krok 1: Zaktualizuj trzy README**

`app/lib/README.md`: `log-draft` w wersji **4** i dlaczego v3 odpadło; `workouts` niesie teraz
budowanie ładunku; `exercises` ma dwa warianty listy o różnych rolach.

`app/components/README.md`: dwa nowe komponenty, w tym uwaga, że `log-exercise-card` jest
**przeniesieniem** z trasy, więc jego historia zmian zaczyna się wcześniej niż jego plik.

`app/routes/README.md`: trasa zasobowa `biblioteka-cwiczen` i **dlaczego stoi poza blokiem
`podopieczny`** (nie należy do layoutu, wzorem `upload/wideo`).

`tests/README.md`: **twierdzenie ujemne przestało być prawdziwe.** Dokument mówi dziś, że
`tests/e2e/` „jest na te testy przygotowany, ale **jeszcze pusty** — powstają po cutoverze".
Zadanie 10 czyni go niepustym, więc to zdanie trzeba zastąpić — a przy okazji zapisać konwencję,
którą tamten scenariusz ustanowił (selektory, logowanie, przygotowanie danych), bo będzie
kopiowana. Wymaga tego sekcja „Domknięcie" procedury `calisthenos-fe:e2e-test`.

**Twierdzenie ujemne jest jedynym rodzajem zdania, którego zwietrzenie nie ujawnia się przy
czytaniu** (`/finish`, krok 2): „nie ma tu jeszcze X" czyta się gładko długo po tym, jak X
powstało, i zaprasza następnego do napisania drugiej ścieżki. Dlatego ten wiersz nie jest
sprzątaniem po zadaniu, tylko jego częścią.

- [ ] **Krok 2: Commit**

```bash
npx biome check app/lib/README.md app/components/README.md app/routes/README.md tests/README.md
git add app/lib/README.md app/components/README.md app/routes/README.md tests/README.md
git commit -m "docs: szkic v4, wybierak i pierwszy scenariusz e2e w mapach katalogów"
```

- [ ] **Krok 3: `/finish`**

Domknięcie idzie skillem `/finish` z korzenia — bramki zależne od tego, co zmiana dotknęła,
sprawdzenie prawdziwości README, przegląd i commit polityką tego drzewa.

---

## Definicja ukończenia

- [ ] `npx tsc --noEmit` czysto
- [ ] **`npm run build` przechodzi** — jedyna bramka łapiąca osierocony import po Zadaniu 7
- [ ] `npx vitest run app/lib app/routes app/components` zielone
- [ ] `npx biome check` na **zmienionych plikach** czysto
- [ ] Szkic z dodatkową serią **przywraca się** (dziś każdy taki jest odrzucany)
- [ ] Wymiana czyści serie i nie pozwala wybrać ćwiczenia, które zastępuje
- [ ] Pasek postępu i `allDone` nie kłamią po wymianie
- [ ] Trasa `biblioteka-cwiczen` ma wpis w `app/routes.ts`
- [ ] Scenariusz Playwrighta **napisany**; uruchomienie należy do Właściciela
- [ ] Cztery README mówią to samo, co kod — w tym `tests/README.md`, w którym twierdzenie
      „katalog jeszcze pusty" przestało być prawdziwe
- [ ] `grep -rn "git prowadzi Właściciel" calisthenos-fe/.claude/skills/` — **brak trafień**
      (Zadanie 0)
- [ ] **`contract-change` rozstrzygnięty w `/finish`**: `przyjęty`, jeśli kroki 5–6 poszły tak,
      jak je opisuje, albo poprawiony o to, co wyszło. Procedura, która została `proponowana`
      po zamknięciu swojego planu, jest czerwoną lampką — nie stanem spoczynkowym

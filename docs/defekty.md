# Otwarte defekty i dług — `calisthenos-fe`

**Rejestr, nie migawka.** Pozycja naprawiona zostaje **na miejscu**, oznaczona ✅ i opisem tego,
co ją zamknęło. Skreślenie bez śladu odbiera odpowiedź na pytanie „czy to już było i wróciło".

Wszystko poniżej zostało **potwierdzone w kodzie albo w przebiegu**, nie jest podejrzeniem.
Rzeczy do zrobienia, których nikt nie zaczął, tu nie należą — to jest lista tego, co **jest
zepsute i zostaje zepsute**.

Zakładając pozycję, podaj: objaw, przyczynę, **czy da się dziś osiągnąć**, i drogi naprawy wraz
z ich ceną. Bez ostatniego pozycja jest narzekaniem.

---

## D-FE-1 · Cała bramka formatowania jest czerwona na Windows, przez same zakończenia linii

**Kontekst:** środowisko + `verify-project` · **Status:** otwarty · **Zgłoszony:** 2026-09-07,
przy znoszeniu reguły „git w FE prowadzi właściciel"

**Objaw.** `npx biome check .` w tym drzewie zwraca **260 błędów**. Ani jeden nie dotyczy kodu —
wszystkie mówią o formatowaniu całych plików. Hook `verify-project` z korzenia, który po każdej
edycji pliku FE uruchamia `biome check` na tym pliku, **odmawia więc na KAŻDYM pliku tego
drzewa**. Selftest korzenia zna to jako jedną stałą porażkę: `FE: zdrowy TypeScript` oczekuje
`exit=0` na nietkniętym `app/root.tsx`, a dostaje `exit=2`.

**Przyczyna.** `git config core.autocrlf` w tym repozytorium stoi na `true`, więc wypakowanie na
Windows daje pliki z CRLF. `biome.json` nie ustawia `formatter.lineEnding`, a domyślną wartością
Biome jest `lf`. Repozytorium jest przy tym **zdrowe** — indeks trzyma LF, bo `autocrlf`
normalizuje przy zapisie, więc `git diff` o zakończeniach linii milczy. Rozjazd żyje wyłącznie
w katalogu roboczym, między tym, co widzi git, a tym, co widzi Biome.

**Dowód kontrastem:** `app/root.tsx` (nietknięty, 110 × CRLF) → `biome check` czerwony;
`app/lib/logger.ts` (edytowany 2026-09-07, 0 × CRLF) → zielony. Ten sam linter, ta sama
konfiguracja, różnica wyłącznie w bajtach końca linii.

**Dlaczego to boli bardziej od 07.09.2026.** Do tego dnia gita w tym drzewie prowadził
właściciel i bramką przy commicie był człowiek oglądający diff. Dziś commituje agent, a to
drzewo **nie ma ani jednego hooka gita** — ani lefthooka, ani commitlinta. `verify-project` był
jedynym automatem po stronie FE i jest ślepy w drugą stronę: nie przepuszcza niczego, więc nikt
go nie używa. Bramka, która odmawia zawsze, uczy obchodzenia siebie dokładnie tak samo jak ta,
która przepuszcza zawsze.

**Drugi objaw, ten sam korzeń: zaległość `organizeImports`.** `biome check` uruchamia też
sortowanie importów, którego `biome lint` nie rusza. Ponieważ `check` nigdy w tym drzewie nie
biegł jako bramka, zaległość jest rozsiana po plikach — sprawdzone kontrastem na wersjach
z `HEAD`: `app/lib/api/middleware.test.ts` i `app/routes/podopieczny/_layout.tsx` zapalają
`organizeImports` **w postaci zacommitowanej**, bez czyjejkolwiek edycji.

Skutek dla pracy: `biome check` na zmienionych plikach potrafi wskazać coś, czego nie wniosłeś.
**Rozstrzyga diff, nie liczba błędów** — znalezisko na linii, której nie dotykałeś, jest tą
zaległością, a nie Twoim. Przeformatowanie cudzych plików przy okazji własnego zadania miesza
zmianę mechaniczną z semantyczną w jednym commicie i utrudnia przegląd; ta pozycja jest po to,
żeby nie trzeba było tego robić „bo bramka świeci".

**Obejście, które działa dziś i jest zapisane w `CLAUDE.md` oraz w `/finish`:** `biome check`
**na zmienionych plikach**, nie na `.`. Pliki dotknięte narzędziem edycji wychodzą z LF i
przechodzą formatowanie; zostaje ewentualne `organizeImports` opisane wyżej.

**Drogi naprawy i ich cena:**

| Droga | Cena |
| --- | --- |
| `.gitattributes` z `* text=auto eol=lf` + `git add --renormalize .` | **Właściwa i trwała** — repozytorium samo deklaruje politykę, niezależnie od maszyny. Indeks już trzyma LF, więc renormalizacja jest bezzmianowa w treści; zmienia się wyłącznie katalog roboczy przy ponownym wypakowaniu. Koszt: dotyka mtime wszystkich plików i wymaga świadomego przewypakowania drzewa. |
| `git config core.autocrlf input` w tym repozytorium | Najtańsza, jedna komenda, **ale lokalna dla maszyny** — nie chroni żadnego innego klonu i nie zostawia śladu w repozytorium. Wraca przy następnym świeżym klonie. |
| `formatter.lineEnding: "crlf"` w `biome.json` | Odrzucona: zamienia problem na jego lustrzane odbicie. Drzewo przestaje się formatować poprawnie wszędzie poza Windows, a indeks i tak trzyma LF. |
| Zostawić i sprawdzać po plikach | To stan dzisiejszy. Działa, dopóki nikt nie zaufa `check .` ani `verify-project` w tym drzewie — czyli dopóki ktoś pamięta o tej pozycji. |

**Decyzja należy do Właściciela** — pierwsza droga zmienia zawartość katalogu roboczego całego
drzewa i nie jest czymś, co agent robi przy okazji innego zadania.

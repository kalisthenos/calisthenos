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

**Kontekst:** środowisko + `verify-project` · **Status:** ✅ **naprawiony** 2026-09-21 ·
**Zgłoszony:** 2026-09-07, przy znoszeniu reguły „git w FE prowadzi właściciel"

**Co go zamknęło.** Pierwsza z czterech dróg wycenionych niżej — `.gitattributes` z
`* text=auto eol=lf` plus `git add --renormalize .`. Renormalizacja dała **zero** zmian treści,
dokładnie jak przewidywał ten wpis: indeks trzymał LF, rozjazd żył wyłącznie w katalogu roboczym.
Drugi objaw (zaległość `organizeImports` i cztery naprawdę niesformatowane pliki) spłacony osobnym,
czysto mechanicznym commitem: 96 plików, wyłącznie przestawienie importów i zawijanie linii.

**Pomiar:** `npx biome check .` szedł z **267 błędów → 104 → 0**. Selftest korzenia, który miał
z tego powodu jeden przypadek czerwony **na stałe** (`FE: zdrowy TypeScript`), pokazuje teraz
**74 zdanych, 0 niezdanych** — więc każda porażka tego przebiegu jest odtąd regresją, bez wyjątku.

**Co to zmienia w pracy:** `npx biome check .` w tym drzewie znów jest bramką, a nie ćwiczeniem
z ignorowania. Sprawdzanie „po zmienionych plikach" przestało być obejściem i zostaje zwykłą
oszczędnością czasu.

**Zapłacony rachunek, dla porządku:** do tej poprawki hook `verify-project` odmawiał **każdej**
edycji w tym drzewie. Przy Fali 1 kosztowało to ręczną konwersję dziesięciu plików, zanim dało się
w nich cokolwiek zmienić — i to był powód, dla którego ta pozycja weszła na warsztat przed resztą.

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

---

## D-FE-2 · Trzeci stan połączenia z kalendarzem nie dociera do ekranu integracji

**Kontekst:** konsultacje / kalendarz zewnętrzny · **Status:** ✅ **naprawiony** 2026-09-21 ·
**Zgłoszony:** 2026-09-21, rozpoznaniem modułu konsultacji

**Co go zamknęło.** `calendarConnectionCopy` w `app/lib/calendar.ts` — trzy stany kontraktu
dają trzy różne ekrany, a `broken` niesie ostrzeżenie i **obie** drogi wyjścia naraz (ponowna
zgoda i rozłączenie), bo kontrakt nie rozróżnia `auth-permanent` od `gone`. Reguła wyprowadzona
do modułu, nie zostawiona w trasie, bo testy tej trasy sprawdzają loader i akcję, nie widok —
cztery przypadki w `app/lib/calendar.test.ts`, w tym regresja wprost na dawną regułę
`status !== "disconnected"`.

**Objaw.** Trener z połączeniem ostemplowanym jako **zepsute** widzi na ekranie integracji
„Połączone konto: jan@…" i przycisk „Rozłącz". Nic się nie synchronizuje, a ekran mówi
„połączone". Dowie się dopiero wtedy, gdy sam kliknie „Synchronizuj z Google" przy którymś
podopiecznym i dostanie komunikat o nieudanym połączeniu — czyli **przypadkiem**, nie z ekranu,
który o stanie integracji ma mówić.

**Przyczyna.** `app/routes/trener/integracje.google.tsx:72` spłaszcza trzy stany kontraktu
(`connected` · `broken` · `disconnected`) do dwóch: `connection.status !== "disconnected"`.

**Czego ta pozycja NIE obejmuje — sprostowane przy zakładaniu.** Pierwsza wersja tego wpisu
twierdziła, że nie ma w aplikacji żadnego sposobu uruchomienia uzupełnienia zaległości.
**Nieprawda.** `runConsultationSync` (`app/lib/consultations.ts:519`) jest wołane z akcji
`sync-google` trasy `app/routes/trener/podopieczni.$traineeId.konsultacje._index.tsx:89`, a chip
„Synchronizuj z Google" stoi w tej samej trasie (`:208-222`) i jest widoczny **także przy
`broken`** — komentarz przy `:58` mówi, że to decyzja, nie przeoczenie: chip zostaje, a o tym, czy
synchronizacja przejdzie, rozstrzyga odpowiedź `connected: false`. Droga wyjścia więc **istnieje**;
brakuje wyłącznie tego, żeby ekran integracji nazwał stan po imieniu, zamiast czekać, aż trener
trafi na niego przy podopiecznym.

**Dlaczego to boli bardziej, niż wygląda.** BE zbudował ten stan celowo i nazywa go po imieniu:
docblock `connectionIsDead` (`calisthenos-be`, `calendar/calendar-sync.service.ts:651`) ostrzega,
że połknięcie błędu „dałoby połączenie, które wiecznie nic nie synchronizuje, podczas gdy
interfejs mówi »połączone« — czyli wadę 3 legacy słowo w słowo". To samo raz jeszcze, innymi
słowami, przy `isPermanentForbiddenReason` (`calendar-errors.ts:62`): „`markBroken` nigdy,
a `GET /v1/calendar/connection` w kółko »połączone«". Cały aparat `markBroken` wraz z dwukrotnie
przeargumentowaną zapadką (`calisthenos-be/docs/defekty.md`, D-11) i gałąź
`insufficientPermissions` dołożona właśnie po to, żeby tej wady nie powtórzyć — kończą się na
polu, którego ten ekran nie czyta.

**Czy da się dziś osiągnąć:** tak. Wystarczy cofnąć aplikacji dostęp do kalendarza w ustawieniach
konta Google — zgoda jest granularna, więc refresh token działa dalej i `invalid_grant` nie padnie
nigdy; połączenie ląduje w `broken` przy pierwszym wypchnięciu.

**Drogi naprawy i ich cena:**

| Droga | Cena |
| --- | --- |
| Trzeci wariant na ekranie: „Połączenie wymaga odnowienia" + „Połącz ponownie" | **Właściwa.** Kontrakt już to niesie, więc koszt to jedna gałąź w komponencie i jedno zdanie po polsku. **Uwaga na to, co zaproponować jako wyjście:** `save()` zeruje `broken_at` (`calendar-connections.service.ts`), więc dla klasy `auth-permanent` — a to jest jedyny scenariusz, który ta pozycja uznaje za osiągalny — **wystarcza ponowna zgoda**. Przez rozłączenie trzeba iść wyłącznie po błędzie `gone`, bo wtedy w wierszu zostaje `calendar_id` wskazujący nieistniejący kalendarz (docblock `disconnect`, `calendar.controller.ts:335`). Wariant „zawsze rozłącz" byłby więc radą błędną dla przypadku częstszego. |
| Chip „Synchronizuj z Google" także na ekranie integracji | Dziś stoi wyłącznie na liście konsultacji pary, więc trener szukający stanu integracji go nie widzi. Tanie, ale rozstrzyga o tym rozmieszczenie, nie brak funkcji — patrz sprostowanie wyżej. |
| Zostawić | Trener dowiaduje się o zepsutej integracji wyłącznie przypadkiem, z komunikatu przy innej czynności. |

---

## D-FE-3 · Granica „minione / nadchodzące" jest przesunięta o offset strefy

**Kontekst:** konsultacje · **Status:** ✅ **naprawiony** 2026-09-21 · **Zgłoszony:** 2026-09-21,
rozpoznaniem modułu konsultacji

**Co go zamknęło.** `appWallClockNow()` w `app/lib/consultations.ts` — module, który tę konwencję
ustanawia — i pięć miejsc wywołania przestawionych na nią. `consultationPresentation` została bez
zmian: nigdy nie była zepsuta, myliły się jej wołające. Bramki na tę klasę **nie było**; dołożona
jako `app/routes/no-raw-now.test.ts` wzorem `no-direct-api.test.ts` i sprawdzona na prawdziwym
kodzie z `HEAD` — wszystkie pięć tras przed poprawką ją zapala. Zakres ślepoty (`new
Date().getTime()`, pomyłka odwrotna, komponenty spoza `app/routes/`) zapisany w jej docblocku.

**Objaw.** Spotkanie, które zaczęło się półtorej godziny temu, siedzi latem w sekcji
**„Nadchodzące"** u podopiecznego. U trenera etykieta „do udokumentowania" zapala się z tym samym
opóźnieniem. W tej samej trasie przypięty „najbliższy termin" liczy się **inaczej** niż lista pod
nim, więc oba potrafią powiedzieć co innego o tym samym terminie.

**Przyczyna.** FE trzyma `scheduledAt` jako **czas ścienny zapisany w komponentach UTC** — konwencja
opisana w docblocku `app/lib/consultations.ts` („Czas: moment BE ↔ czas ścienny FE"), realizowana
przez `withAppWallClock`. Porównuje go natomiast z `Date.now()`, czyli z **prawdziwym momentem**.
Okno błędu równa się offsetowi `Europe/Warsaw`: **2 h latem, 1 h zimą**. `next` pochodzi z zapytania
BE (`from: nowISO`, prawdziwy moment) i jako jedyny liczy poprawnie — stąd rozjazd między nim
a listą.

**Dowód pomiarem** (`Europe/Warsaw`, CEST = UTC+2):

| | |
| --- | --- |
| prawdziwy moment startu (90 min temu) | `2026-09-21T10:30:00.000Z` |
| `scheduledAt` po konwersji FE | `2026-09-21T12:30:00.000Z` |
| `Date.now()` | `2026-09-21T12:00:00.000Z` |
| „czy przeszły?" | **`false`** — o 30 minut za mało |

Miejsca: `app/lib/consultation-status.ts:90` (etykieta trenera; u podopiecznego ta gałąź nie jest
osiągana, bo `planned` daje mu „do potwierdzenia" niezależnie od czasu) oraz
`app/routes/podopieczny/konsultacje._index.tsx:98` i `:101` (podział agendy).

**Czy da się dziś osiągnąć:** przy każdym spotkaniu, codziennie.

**Drogi naprawy i ich cena:**

| Droga | Cena |
| --- | --- |
| Jeden pomocnik „teraz w konwencji FE" (`toAppWallClock(new Date().toISOString())`) użyty w obu porównaniach | Najtańsza i zgodna z istniejącą konwencją — przeliczenie zostaje na brzegu modułu, tak jak dziś. |
| Porzucić konwencję czasu ściennego i liczyć wszystko na momentach | **Właściwe docelowo**, ale to przebudowa całego modułu czasu w tym drzewie (`fmtDateTime`, `monthRangeUTC`, grupowanie po `getUTCDate`, `<input type="datetime-local">`). Osobne zadanie, nie poprawka. |
| Zostawić | Podopieczny widzi spotkanie sprzed dwóch godzin jako nadchodzące i czeka na nie. |

**Uwaga do kolejności.** Ta pozycja bije w dwa miejsca, ale tylko jedno z nich przeżyje przejście
na `presentation` z kontraktu (D-FE-4): `consultation-status.ts:90` zniknie razem z całą funkcją,
podział agendy zostaje. Naprawiać należy **porównanie**, nie etykiety — inaczej ta sama praca
zostanie wykonana dwa razy i drugi raz wyrzucona.

---

## D-FE-4 · Reguły kontraktu policzone drugi raz po tej stronie i już rozjechane

**Kontekst:** konsultacje · **Status:** ✅ **naprawiony** 2026-09-21 · **Zgłoszony:** 2026-09-21,
rozpoznaniem modułu konsultacji

**Co go zamknęło.** `presentationFor(termin.presentation)` w miejsce
`consultationPresentation` — dziesięć wywołań w pięciu plikach. Etykieta przestała zależeć od
ROLI, bo funkcja nie ma już takiego parametru: złamanie niezmiennika z `docs/02` §5 jest dziś
**niewyrażalne**, a to mocniejsza obrona niż asercja. Przyciski trenera liczą się
z `allowedActions`, przekładanie i odwołanie bramkowane osobno. Cztery martwe gwardie usunięte,
a w ich miejscu stoi zdanie, gdzie tabela przejść naprawdę mieszka.

Klucz nieznany ma gałąź zapasową — to zobowiązanie z **ADR-0042** (`presentation.key` jest
`x-extensible-enum`), nie ostrożność.

**Objaw.** Przycisk „Udokumentuj" pokazuje się przy terminie z prośbą o zmianę; kliknięcie kończy
się `409` i komunikatem zamiast działaniem. Etykiety statusu liczy FE sam, mimo że kontrakt niesie
je gotowe.

**Przyczyna.** BE wystawia `presentation` i `allowedActions` **właśnie po to**, żeby klient nie
trzymał drugiej kopii tabeli przejść — docblock `CONSULTATION_ACTION`
(`calisthenos-be`, `dto/consultation.dto.ts:49`) mówi to wprost: „reguła policzona w dwóch
aplikacjach klienckich to dwie reguły, które kiedyś powiedzą co innego". FE zrobił to w połowie:

- `allowedActions` czyta **wyłącznie** ścieżka podopiecznego (`canTraineeRespond`);
- `presentation` **nie jest czytane nigdzie** (zero trafień na `.presentation` w `app/`) —
  zamiast tego **dziesięć wywołań w pięciu plikach** woła lokalne `consultationPresentation`
  (`app/lib/consultation-status.ts:76`): `podopieczny/konsultacje.$konsultacjaId.tsx:59`,
  `podopieczny/konsultacje._index.tsx:82,106,222,248,277`, `trener/konsultacje.tsx:39,85`,
  `trener/podopieczni.$traineeId.konsultacje.$konsultacjaId.tsx:201` oraz
  `trener/podopieczni.$traineeId.konsultacje._index.tsx:140`;
- przyciski trenera liczą się ze statusu, nie z listy akcji
  (`app/routes/trener/podopieczni.$traineeId.konsultacje.$konsultacjaId.tsx:247` i `:303`);
- w `app/lib/consultation-types.ts:84-92` zostały **cztery** martwe gwardie: `canTraineeAct`
  (dopuszcza `confirmed`, BE nie), `canDocument` (dopuszcza `change_requested`, BE nie),
  `canTrainerReschedule` oraz `canTrainerCancel` (alias tej poprzedniej). Trzy z nich mają własne
  testy (`consultation-types.test.ts:86-101`; `canTrainerCancel` pokrywa pośrednio test funkcji,
  którą aliasuje), więc **wyglądają na żywe** i zapraszają do użycia — mimo że nie woła ich nic.

**Czy da się dziś osiągnąć:** `409` — tak, jednym kliknięciem przy terminie, dla którego podopieczny
poprosił o zmianę. Rozjazd etykiet — stale, przy każdym renderze.

**Drogi naprawy i ich cena:**

| Droga | Cena |
| --- | --- |
| Dziesięć wywołań przechodzi na `presentation`, przyciski na `allowedActions`, `consultationPresentation` i cztery martwe gwardie znikają | **Właściwa.** `/refactor` — zachowanie ma zostać to samo, więc testy przed i po muszą być zielone i niezmienione. Koszt: etykiety po polsku muszą powstać z `presentation.key`, bo kontrakt niesie klucz i ton, nie tekst. |
| Zrównać lokalne reguły z BE, zostawiając dwie kopie | Odrzucona: to jest dokładnie ta droga, która doprowadziła do dzisiejszego stanu. |
| Zostawić | Rozjazd rośnie z każdą zmianą tabeli przejść po stronie BE — i jest cichy aż do kliknięcia. |

**Kolejność.** Naprawa ma sens **po** rozstrzygnięciu D-19 z rejestru BE (faza terminu w
`presentation`/`allowedActions`) — wcześniej znaczy napisanie tej samej reguły dwa razy.

---

## D-FE-5 · Formularz terminu pokazuje pola, które niczego nie zmieniają

**Kontekst:** konsultacje · **Status:** ✅ **naprawiony** 2026-09-21 · **Zgłoszony:** 2026-09-21,
rozpoznaniem modułu konsultacji

**Co go zamknęło.** Jeden schemat na dwie operacje rozdzielony na dwa: `ConsultationDocFormSchema`
niesie dokładnie to, co przyjmuje `POST …/document`, a `AdhocConsultationFormSchema` rozszerza go
o pola, które przyjmuje `POST /v1/consultations`. Który zestaw renderować, mówi prop `tryb`.
`title` i `periodFrom`/`periodTo` odpadły z OBU ścieżek — kontrakt ich nie zna, a tytuł był przy
tym polem **wymaganym**, blokującym zapis i niewysyłanym nigdzie. Limit `durationMin` zrównany
z DTO (5–480) w schemacie, w polu i w formularzu przełożenia.

**Objaw.** Trener w trybie „Udokumentuj" poprawia link do spotkania, godzinę albo czas trwania,
zapisuje — i **nic się nie zmienia**. Bez ostrzeżenia i bez komunikatu. Osobno: czas trwania spoza
zakresu 5–480 minut przechodzi walidację po tej stronie i wraca jako `400` z serwera.

**Przyczyna.** `ConsultationForm` (`app/components/consultation-form.tsx`) renderuje `scheduledAt`,
`durationMin`, `meetingUrl`, `periodFrom`/`periodTo` i `title`, a `documentConsultation`
(`app/lib/consultations.ts:365`) wysyła **wyłącznie** `summary` i treści punktów — bo
`DocumentConsultationDto` innych pól nie ma. `title` oraz `periodFrom`/`periodTo` nie istnieją
w `/v1` w ogóle (kolumny są spadkiem po aplikacji fullstackowej, `docs/04` o nich milczy). Limit
czasu trwania: `consultation-form.tsx:79-80` daje `min={1} max={600}`, schematy Zoda `max(600)`
(`consultation-types.ts:44,59`), a DTO po stronie BE `@Min(5) @Max(480)`.

Statusy punktów akcji też przepadają po drodze — przyczyna i cena po stronie kontraktu stoją
w `calisthenos-be/docs/defekty.md`, **D-20**.

**Czy da się dziś osiągnąć:** tak, za każdym razem.

**Drogi naprawy i ich cena:**

| Droga | Cena |
| --- | --- |
| Ukryć w trybie dokumentacji pola, których ten formularz nie wysyła | Najtańsza i uczciwa: ekran przestaje obiecywać coś, czego nie zrobi. Nie daje trenerowi możliwości poprawienia linku przy okazji. |
| Wysłać je drugim wywołaniem (`reschedule` + `document`) | Daje pełną edycję. Cena: dwie operacje domenowe z jednego przycisku, dwa zdarzenia w outboxie i **mail z kalendarza o przeniesieniu** przy każdej poprawce dokumentacji. |
| Rozszerzyć `DocumentConsultationDto` | Pełne i drogie: przejazd `contract-change`. Sensowne wyłącznie razem z D-20, w jednym przejeździe. |
| Limit `durationMin` zrównać z DTO (5–480) w schemacie Zoda i w atrybutach pola | Osobna, trywialna, niezależna od powyższych. |

---

## D-FE-6 · Podopieczny nie może odhaczyć punktu „do poprawy", choć kontrakt mu na to pozwala

**Kontekst:** konsultacje · **Status:** ✅ **naprawiony** 2026-09-21 · **Zgłoszony:** 2026-09-21,
rozpoznaniem modułu konsultacji

**Co go zamknęło.** Akcja `toggle-item` na trasie podopiecznego i przycisk przy każdym punkcie —
wzorem ekranu trenera. **Zero zmian w kontrakcie**: wszystko, czego ten ekran potrzebował, było
w nim od początku, tylko nie miało konsumenta.

**Objaw.** Punkty „do poprawy" są u podopiecznego wyłącznie do odczytu — z etykietą „otwarte" albo
„poprawione" i bez żadnej akcji. U trenera ta sama lista ma przycisk „Oznacz jako poprawione".

**Przyczyna.** Deklaracja istnieje po obu stronach i jest zrealizowana wszędzie poza tym ekranem:
`docs/01` §I (`calisthenos-be/docs/01-zakres-funkcjonalny.md:301`) mówi „Status punktu może
zmieniać zarówno trener, jak i podopieczny", trasa `PATCH /v1/consultations/{id}/action-items/{itemId}`
jest `@Roles('trainer','trainee')`, a `ConsultationsService.setActionItemStatus` obsługuje obie
perspektywy wraz z zakresem najemcy. Trasa
`app/routes/podopieczny/konsultacje.$konsultacjaId.tsx` renderuje samą listę.

**Czy da się dziś osiągnąć:** to jest stan stały, nie zdarzenie — funkcja po prostu nie istnieje
w interfejsie podopiecznego.

**Drogi naprawy i ich cena:**

| Droga | Cena |
| --- | --- |
| Dołożyć akcję na ekranie podopiecznego, wzorem ekranu trenera | Niska: `setActionItemStatus` w module jest gotowe, trasa BE też. Koszt: akcja trasy i przycisk w liście. |
| Zmienić `docs/01` i kontrakt tak, żeby to była funkcja wyłącznie trenera | Uczciwa alternatywa, jeśli taka jest intencja — ale wtedy trasa BE traci rolę `trainee`, a to jest zmiana kontraktu, nie uproszczenie ekranu. |
| Zostawić | Trasa BE ma dziś rolę, której nikt nie używa — czyli powierzchnię bez konsumenta. |

---

## D-FE-7 · Martwa sesja na trasie publicznej odsyła na `/login` — link z maila ląduje na logowaniu

**Kontekst:** sesja · middleware · **Status:** **otwarty** · **istnieje PRZED gałęzią
`feat/rejestracja-trenera`** · **Zgłoszony:** 2026-10-03, przy trasach rejestracji

**Objaw.** Osoba, która ma w przeglądarce ciastko `__Host-kth_api` z sesją martwą (wygasłą albo
odwołaną po stronie BE), klika link z maila — `/rejestracja/:token` albo `/zaproszenie/:token` — i
widzi ekran logowania zamiast strony z linku. Link nie jest przy tym zużyty (przekierowanie zapada,
zanim ruszy loader), a **drugie kliknięcie działa**: pierwsze odpowiedziało czyszczeniem ciastka,
więc drugie przychodzi już anonimowo. Kto nie wie, że ma kliknąć jeszcze raz, uzna link za zepsuty.

**Przyczyna.** `app/lib/api/middleware.ts:188–201`. Gdy odświeżenie albo `GET /v1/me` kończy się
`401`, middleware wpuszcza żądanie anonimowo (i czyści ciastko w drodze powrotnej) **wyłącznie na
`/login`** — tam trasa musi się wyrenderować, inaczej wyszłaby pętla przekierowań. Każda inna
ścieżka, także publiczna, dostaje `redirect("/login")` z `Set-Cookie` czyszczącym. Dla tras
chronionych to zachowanie zamierzone i przypięte testem (`middleware.test.ts`, „martwy token
odświeżający czyści ciastko i odsyła na logowanie”); wyjątek jest jeden i wpisany z nazwy, więc
trasy publiczne z tokenem w adresie go nie mają.

**Czy da się dziś osiągnąć:** tak — wystarczy martwe ciastko w przeglądarce, z której otwiera się
link. `/zaproszenie/:token` dotyczy to już dziś, `/rejestracja/:token` — od otwarcia rejestracji
(`REGISTRATION_OPEN=true` w serwisie API). Potwierdzone czytaniem kodu i testu, nie odtworzone
w przeglądarce.

**Propozycja naprawy i jej cena.**

| Droga | Cena |
| --- | --- |
| Lista tras publicznych traktowanych jak `/login`: martwa sesja → ciastko czyszczone, żądanie wpuszczone anonimowo | **Proponowana.** Mała zmiana w jednym miejscu, ale lista żyje poza tabelą tras (`app/routes.ts`): pominięcie nowej trasy publicznej nie objawia się niczym, dopóki nie trafi na nią ktoś z martwym ciastkiem. Wymaga przypadku na każdą pozycję (jak dziś na `/login`) i takiego, który porównuje listę z trasami publicznymi w `routes.ts` — inaczej pominięcie nie umie się zapalić |
| Zostawić | Link z maila działa dopiero za drugim kliknięciem; pierwsze kończy się ekranem logowania |

**Czego dotyka.** Uwierzytelnianie i sesja — powierzchnia ryzyka. `app/lib/api/middleware.ts` (gałąź
`401` w `apiMiddleware`) i `middleware.test.ts`; trasy publiczne `/rejestracja`, `/rejestracja/:token`,
`/dokumenty/:klucz/:wersja` i `/zaproszenie/:token`. **Nie naprawiaj tego przy okazji innego
zadania** — osobny `/fix` z pytaniem o bramkę; decyzja Właściciela.

---

## D-FE-8 · Token z adresu strony ląduje w logach serwera FE

**Kontekst:** logi · serwer produkcyjny · **Status:** **otwarty** · **istnieje PRZED gałęzią
`feat/rejestracja-trenera`** (ta dołożyła drugi adres z tokenem, `/rejestracja/:token`) ·
**Zgłoszony:** 2026-10-03, przy trasach rejestracji

**Objaw.** Każde żądanie pod adres z tokenem — `GET /rejestracja/<token>`, `GET /zaproszenie/<token>`,
także `POST` tego samego adresu — zostaje w logach serwisu FE na Railway z **pełnym tokenem**. Token
jest jednorazowy i krótkożyjący (link rejestracji działa 24 godziny — tak mówi ekran „Link jest
nieważny albo wygasł” — a zaproszenie do swojego `expiresAt`), ale do chwili użycia albo wygaśnięcia
każdy z dostępem do tych logów może zrobić z nim to, co adresat linku: dokończyć rejestrację
(`POST /v1/registrations/{token}/complete`) albo przyjąć zaproszenie (`POST /v1/invites/{token}/accept`)
z własnym hasłem.

**Przyczyna.** `npm start` to `react-router-serve ./build/server/index.js` (`package.json`;
`startCommand` w `railway.toml` woła `npm run start`), a `react-router-serve` 7.15.1 ma na sztywno
`app.use(morgan("tiny"))` (`node_modules/@react-router/serve/dist/cli.js:130`). Format `tiny` to
`:method :url :status :res[content-length] - :response-time ms`, a `:url` jest adresem żądania ze
ścieżką — więc z tokenem. Serwer nie ma żadnej opcji logu: `cli.js` czyta wyłącznie `PORT`, `HOST`
i `NODE_ENV`. Drugie miejsce leży już po naszej stronie: `logUnhandled` (`app/lib/logger.ts:68-77`,
wołane z `handleError` w `app/entry.server.tsx`) zapisuje `path` żądania przy każdym nieobsłużonym
błędzie (`500`) — też z segmentem tokenu.

**Czy da się dziś osiągnąć:** tak, przy każdym otwarciu takiego linku. `/zaproszenie/<token>` — już
dziś; `/rejestracja/<token>` — od chwili, gdy BE zacznie wysyłać linki (`REGISTRATION_OPEN=true`
w serwisie API; przy `false` trzy trasy rejestracji odpowiadają `409 REGISTRATION_CLOSED`, więc
BE nie wysyła nowych linków). **Zalecenie: rozstrzygnąć przed otwarciem rejestracji.**

**Propozycja naprawy i jej cena.**

| Droga | Cena |
| --- | --- |
| Własny serwer startowy: `express` + `createRequestHandler` z `@react-router/express` i logger dostępowy maskujący segment tokenu (`/rejestracja/*`, `/zaproszenie/*`); skrypt `start` w `package.json` wskazuje na ten serwer | **Właściwa dla logu dostępowego.** Decyzja infrastrukturalna Właściciela. Skrypt `start` zmienia się w jednym miejscu: `startCommand` w `railway.toml:18` i `CMD` w `Dockerfile:58` oba wołają `npm run start`. Ale obraz uruchomieniowy poza manifestem zależności kopiuje wyłącznie `build/` i `public/` z etapu budowania (`Dockerfile:46-47`), a Railway buduje z Dockerfile (`railway.toml:14`) — plik serwera leżący poza `build/` wymaga więc dodatkowego `COPY`, czyli zmiany `Dockerfile` i przebudowy obrazu. Do tego dwie zależności bezpośrednie (`express`, `@react-router/express` — dziś tylko tranzytywne, przez `@react-router/serve`; `npm install` prowadzi Właściciel). Serwer trzeba odtworzyć w całości — kompresja, statyki z nagłówkami cache, nasłuch na `PORT`, zamykanie po `SIGTERM` — bo `react-router-serve` robi dokładnie to |
| Maskowanie segmentu tokenu w `logUnhandled` | Tania i po naszej stronie: kilka linii i przypadek w `logger.test.ts`. **Zamyka tylko jedno z dwóch miejsc** — log dostępowy `morgan` zostaje |
| Zostawić | Token w logach platformy do czasu użycia albo wygaśnięcia; kto je czyta, może go wykorzystać |

**Czego dotyka.** Infrastruktura i obserwowalność: skrypt `start` w `package.json` (`startCommand`
w `railway.toml` i `CMD` w `Dockerfile` wołają `npm run start`), `Dockerfile` (plik serwera poza
`build/` wymaga `COPY`) oraz `app/lib/logger.ts` (`logUnhandled`); pośrednio uwierzytelnianie —
chodzi o tokeny jednorazowych linków z maili. Zmiana startu i obrazu to decyzja Właściciela.

---

## D-FE-9 · Nagłówki strony z tokenem nie obejmują jej strony błędu

**Kontekst:** nagłówki · strona z tokenem · **Status:** **otwarty** · **wprowadzony przez gałąź
`feat/rejestracja-trenera`** (ona dodała `headers()` na tej stronie) · **Zgłoszony:** 2026-10-03,
przy trasach rejestracji

**Objaw.** `headers()` w `app/routes/rejestracja.$token.tsx` ustawia `Referrer-Policy: strict-origin`
i `Cache-Control: no-store`, ale **nie jest stosowane, gdy loader kończy się błędem** (np. awaria BE →
`500`) i rysuje się granica błędu. Strona pod adresem z tokenem nie ma wtedy ani `no-store`, ani
`strict-origin` — zostaje `strict-origin-when-cross-origin` z `root.tsx`.

**Przyczyna.** React Router składa nagłówki dokumentu z tras od korzenia do **granicy błędu
włącznie** (`getDocumentHeadersImpl` w `node_modules/react-router/dist/development/index.js:807`:
`matches` ucięte do `boundaryIdx + 1`), więc funkcja `headers` trasy leżącej niżej niż granica nie
jest wołana. Trasa z tokenem nie ma własnego `ErrorBoundary`, a root jest granicą zawsze
(`hasErrorBoundary: route.id === "root" || …`, `index.js:721`; `app/root.tsx` własnego nie eksportuje,
więc rysuje domyślną) — granicą jest więc root i obowiązują wyłącznie jego nagłówki.

**Czy da się dziś osiągnąć:** tak — przy każdej awarii BE w czasie podglądu linku (`previewRegistration`
rzuca `ApiError` inny niż odmowa rejestracji, a loader puszcza go dalej). Potwierdzone czytaniem
`getDocumentHeadersImpl`, nie odtworzone żądaniem. **Ryzyko niskie:** strona błędu nie niesie danych,
a przy polityce `strict-origin-when-cross-origin` obca domena dostaje w `Referer` samo origin, bez
ścieżki — token nie wycieka; pełny adres idzie wyłącznie do własnego origin.

**Propozycja naprawy i jej cena.**

| Droga | Cena |
| --- | --- |
| Nagłówki ustawiane w middleware dla ścieżek z tokenem (`/rejestracja/:token`, `/zaproszenie/:token`), w drodze powrotnej — niezależnie od tego, która granica rysuje stronę | **Proponowana.** Dotyka `apiMiddleware`, czyli powierzchni uwierzytelniania, a lista ścieżek z tokenem żyje poza tabelą tras: pominięcie nowej nie objawia się niczym |
| Własny `ErrorBoundary` na trasie z tokenem — granicą staje się wtedy sama trasa, więc jej `headers()` wchodzi do składania nagłówków | Wyprowadzone z lektury `getDocumentHeadersImpl`, **niemierzone** — do potwierdzenia testem przy naprawie. Daje przy okazji polski ekran błędu zamiast domyślnego angielskiego, ale to nowy ekran do zaprojektowania: `root.tsx` go nie ma (`docs/audyt.md`, znalezisko 5) |
| Zostawić | Strona błędu pod adresem z tokenem bez `no-store` i `strict-origin`; przy ryzyku niskim to uczciwa opcja |

**Czego dotyka.** `app/routes/rejestracja.$token.tsx` (`headers`), `app/root.tsx` (brak własnej
granicy błędu), przy pierwszej drodze także `apiMiddleware` — uwierzytelnianie jest powierzchnią
ryzyka, więc to ruch na `/fix` albo `/change` z decyzją Właściciela.

---

## D-FE-10 · `/zaproszenie/:token` bez nagłówków strony z tokenem w adresie

**Kontekst:** nagłówki · strona zaproszenia · **Status:** **otwarty** · **istnieje PRZED gałęzią
`feat/rejestracja-trenera`** · **Zgłoszony:** 2026-10-03, przy trasach rejestracji · **Lustro:**
`D-34` w `calisthenos-be/docs/defekty.md` (zgłoszone tam przez plan BE; naprawa należy do tego drzewa)

**Objaw.** Token zaproszenia stoi w ścieżce adresu, a strona `/zaproszenie/:token` — z adresem
e-mail zaproszonego na ekranie (pole tylko do odczytu) — nie ma własnych nagłówków ani `meta`: nie
niesie `Referrer-Policy: strict-origin`, `Cache-Control: no-store` ani
`<meta name="robots" content="noindex">`, które ma nowa strona `/rejestracja/:token`. Dziedziczy
globalne `Referrer-Policy: strict-origin-when-cross-origin` z `root.tsx`. Osobno: przycisk
„Załóż konto” nie jest blokowany na czas wysyłki (trasa nie czyta `useNavigation`, przycisk nie ma
`disabled`), więc podwójne kliknięcie wysyła akcję dwa razy — drugie żądanie trafia na zaproszenie
już zużyte, choć konto powstało przy pierwszym (ten sam przypadek opisuje komentarz przy `busy`
w `rejestracja.$token.tsx`).

**Przyczyna.** `app/routes/zaproszenie.$token.tsx` eksportuje wyłącznie `loader`, `action` i
komponent — ani `headers`, ani `meta`. Trasa bez `headers` dziedziczy nagłówki rodzica, czyli to,
co niesie `root.tsx`.

**Czy da się dziś osiągnąć — i jak daleko.** Zawsze: nagłówków nie ma w ogóle. Przy dzisiejszej
polityce cudzy origin dostaje w `Referer` sam origin FE, bez ścieżki, więc token nie opuszcza FE tą
drogą; pełny adres z tokenem idzie wyłącznie do własnego origin (zasoby strony, ich dzienniki) — to
obrona w głąb, nie otwarta dziura (analiza w BE, `D-34`). Bez `no-store` strona z adresem e-mail
zaproszonego może zostać w pamięci pośredników.

**Propozycja naprawy i jej cena.**

| Droga | Cena |
| --- | --- |
| Wzorem `rejestracja.$token.tsx`: `headers({ parentHeaders })` zaczynające od kopii `parentHeaders` (inaczej strona traci CSP, HSTS, `nosniff` i `Permissions-Policy` z `root.tsx`) i ustawiające `Referrer-Policy: strict-origin` oraz `Cache-Control: no-store`; `meta` z `robots: noindex`; blokada przycisku na czas nawigacji (`navigation.state !== "idle"`) | Mała zmiana w jednej trasie, bez kontraktu i bez zmiany logiki. Procedura `calisthenos-fe:route`; test — te same przypadki co w bloku „nagłówki i meta” z `rejestracja.token.test.ts`, w `zaproszenie.test.ts`. **`strict-origin`, NIE `no-referrer`:** natywny POST przyjęcia zaproszenia (bez JS albo przed hydratacją) dostałby `Origin: null`, a kontrola CSRF React Routera odrzuciłaby go odpowiedzią `400` |
| Zostawić | Obrona w głąb niewykorzystana; strona z adresem e-mail może zostać w pamięci pośredników |

**Czego dotyka.** `app/routes/zaproszenie.$token.tsx` i `zaproszenie.test.ts`; nie dotyka kontraktu.
Wpis lustrzany w BE — `D-34` w `calisthenos-be/docs/defekty.md`; jego „Poprawka zalecenia,
2026-10-03” opisuje, dlaczego pierwotne `no-referrer` było błędne.

---
name: lib-module
description: Moduł w app/lib — jedyne miejsce, które rozmawia z backendem; pisany test-first przeciw podstawionemu klientowi. Użyj, gdy trasa potrzebuje danych albo mutacji.
argument-hint: <nazwa-modułu>
---

Moduł: **$ARGUMENTS**

## Po co ta warstwa istnieje

`app/lib/*` jest **jedynym miejscem, które woła backend**. Trasy biorą dane stąd, a nie od
klienta — pilnuje tego `app/routes/no-direct-api.test.ts`. Dzięki temu logika daje się testować
bez sieci i bez przeglądarki.

## Test-first, przeciw PODSTAWIONEMU klientowi

**TDD jest normą w tym drzewie.** Moduł testujesz przez `createApiClient` z podstawionym
`fetch`, w pliku `<nazwa>.test.ts` obok modułu. Vitest: `npx vitest run <wzorzec>` —
**nie `npm test`**, bo to tryb obserwowania.

1. Napisz padający test.
2. Uruchom, zobacz czerwony.
3. Najprostsza implementacja do zielonego.
4. Refaktor.

Podstawiony `fetch` daje pełną kontrolę nad kształtem odpowiedzi backendu — w tym nad
odpowiedziami błędnymi, których nie da się wygodnie wywołać na żywym serwerze.

## Sygnatura: `api` wchodzi, najemca NIE

Moduł bierze `api: Api` i **nie ma** argumentu `trainerId`/`traineeId` jako filtra. Zakres
najemcy niesie token, egzekwuje go backend. `traineeId` zostaje wyłącznie tam, gdzie kontrakt
ma go w ścieżce (`/v1/trainees/{traineeId}/…`).

Brak autoryzacji daje **`404`**, nie `403` — obie strony trzymają tę samą zasadę, żeby nie
zdradzać istnienia zasobu.

## Typy re-eksportuj, nie przepisuj

Modelu danych nie ma po tej stronie. Typy DTO biorą się z `@kalisthenos/api-client`
i **re-eksportuje się je**, nigdy nie odtwarza ręcznie. Ręczna kopia rozjedzie się przy
pierwszej zmianie kontraktu i nie zgłosi tego nic.

Zmiana zaczyna się w `calisthenos-be`: encja → migracja → OpenAPI → nowa wersja pakietu.
Tutaj podnosi się wersję i dostosowuje moduły. Procedura przekrojowa: `contract-change`.

## Cztery pułapki

1. **Odnośnik do pliku przychodzi jako ŚCIEŻKA.** Origin dokłada `publicFileUrl`
   z `app/lib/api/client.ts` — **tutaj, w module**, nigdy w trasie ani w komponencie.
2. **Wysyłka plików jest DWUFAZOWA** dla wszystkich trzech rodzajów, przez
   `app/lib/file-uploads.ts`. Typ sprawdza backend po **zawartości**, nie ta strona po
   `file.type`. Plik, którego nic nie podpięło, zabiera zamiatacz po 24 h.
3. **Ta strona nie podpisuje, nie serwuje i nie zapisuje na dysk niczego.** Jeśli piszesz kod,
   który to robi, jesteś w złym drzewie.
4. **Osierocony import wciąga serwer do bundla przeglądarki** — `tsc` milczy, wywala się
   `npm run build`. Dotyczy też modułów `.server.ts` importowanych „na zapas".

## Domknięcie

`npx vitest run <wzorzec>`, `npm run typecheck`, `npm run lint`, `npm run build`.
Aktualizacja `app/lib/README.md`. Kończysz na `/finish`.

**Git prowadzi agent** — od 2026-09-07, tą samą konwencją co w BE. Ale to drzewo **nie ma ani
jednego hooka gita**, więc przed `git commit` uruchamiasz sam `npx tsc --noEmit` i `npx biome
check <zmienione pliki>` — **po plikach, nie po `.`**, bo `check .` topi diff w ~260 błędach
o zakończeniach linii (D-FE-1). **`npm install` i Docker nadal prowadzi Właściciel.**

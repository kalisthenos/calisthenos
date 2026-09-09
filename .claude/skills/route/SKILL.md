---
name: route
description: Nowa albo zmieniona trasa React Router v7 — plik, wpis w app/routes.ts, loader i akcja. Użyj przy każdej zmianie powierzchni nawigacyjnej aplikacji.
argument-hint: <ścieżka URL>
---

Trasa: **$ARGUMENTS**

## Trasa to DWA miejsca, nie jedno

Plik w `app/routes/` **oraz** wpis w `app/routes.ts`. Sam plik nie tworzy trasy — powstaje
martwy komponent, którego nic nie renderuje, i nic tego nie zgłasza.

Nazewnictwo plików: `segment.$param.tsx`, `_index.tsx`, `_layout.tsx`.
Mapa URL → plik: `app/routes/README.md`.

| Obszar | Katalog |
| --- | --- |
| widoki trenera (`/trener/*`) | `app/routes/trener/` |
| widoki podopiecznego (`/podopieczny/*`) | `app/routes/podopieczny/` |

## Trasa ZASOBOWA — sam loader, bez komponentu

Trasa istnieje też po to, żeby karmić `useFetcher` danymi, których nie warto ładować przy
każdym wejściu na ekran. Wtedy plik ma **wyłącznie `loader`**, bez domyślnego eksportu:
`upload.wideo.tsx`, `biblioteka-cwiczen.tsx`.

**Nadal są to DWA miejsca** — bez wpisu w `app/routes.ts` `useFetcher` dostaje `404` dopiero
w przeglądarce. Nadal obowiązuje zakaz wołania klienta. Zmieniają się dwie rzeczy:

**Stoi POZA blokiem `prefix(...)`**, jeśli nie należy do layoutu — tak jak `upload/wideo`
i `biblioteka-cwiczen`. Wciągnięcie jej pod `prefix("podopieczny")` dołożyłoby jej layout,
którego nikt nie renderuje.

**NIE RZUCA — oddaje błąd danymi.** To jest reguła kupiona przeglądem gałęzi
`feat/sesja-poza-planem` (2026-09-08) i najważniejsze zdanie tej sekcji. `useFetcher` rejestruje
się pod trasą, która go **renderuje**, nie pod tą, którą woła — więc wyjątek z trasy zasobowej
ląduje w `ErrorBoundary` **ekranu wołającego** i zmiata go w całości. Zmierzony objaw:
`biblioteka-cwiczen.tsx` rzucała przy zerwanej sieci, a podopieczny z wypełnionym formularzem
treningu klikał „Wymień" i dostawał ekran **„Nie udało się zapisać treningu"** — komunikat
o zapisie, którego nie było, zamiast formularza, nad którym pracował.

Oddawaj więc kształt z miejscem na błąd (`{ dane, error }`), przepuszczając dalej **wyłącznie
`Response`** — bo przekierowanie po martwej sesji ma nadal działać:

```ts
try {
  return { exercises: await listActiveExercisesForTrainee(api), error: null };
} catch (err) {
  if (err instanceof Response) throw err;
  logger.error("…", errorMeta(err));
  return { exercises: [], error: "Nie udało się wczytać biblioteki ćwiczeń." };
}
```

Konsument musi mieć wtedy stan błędu. Uwaga na pułapkę: `loading` liczone jako
`fetcher.data === undefined` czyni awarię **nieodróżnialną od wczytywania** — dołóż znacznik
„już prosiłem".

**Test tej trasy asercjuje, że błąd wraca DANYMI, nie wyjątkiem.** `rejects.toThrow()` jest tu
zieloną bramką pod utratą treningu.

## Loader czyta, akcja mutuje

Nie ma osobnego API po tej stronie — dane lecą loaderami i akcjami. Mutacje plikowe to
`multipart/form-data`.

## Trasa NIE woła klienta backendu

To jest twarda reguła i ma bramkę: `app/routes/no-direct-api.test.ts`.

- **Zabroniony** import **wartości** z `~/lib/api/client` i z `@kalisthenos/api-client`.
- **Dozwolony** `import type` — typ DTO znika przy kompilacji i niczego nie woła.
- **Dozwolona** reszta `~/lib/api/*`: `requireUser`, `ApiError`, `toRouteResponse`, ciastko
  sesji. To infrastruktura żądania, nie klient.

Dane bierzesz z modułu `app/lib/*`, a moduł rozmawia z backendem. Nowy moduł:
`calisthenos-fe:lib-module`.

Ta bramka jest **następcą `no-direct-db.test.ts`** — ten sam szew, zmieniła się druga strona.
Warto o tym wiedzieć, zanim ktoś uzna ją za nową i przypadkową.

## Cztery rzeczy, które łatwo pominąć

1. **Zakres najemcy niesie token, egzekwuje backend.** Moduły `app/lib/*` biorą `api: Api`
   i **nie mają** argumentu `trainerId`/`traineeId` jako filtra. Zostaje on wyłącznie tam, gdzie
   kontrakt ma go w ścieżce. Brak autoryzacji → **`404`**, nie `403`.
2. **Odnośnik do pliku przychodzi jako ŚCIEŻKA, nie jako adres.** Origin dokłada
   `publicFileUrl` z `app/lib/api/client.ts` — **w module**, nigdy w trasie ani w komponencie.
3. **Sortowanie i filtrowanie list idzie przez URL params**, po stronie serwera. Używaj
   `app/lib/list-params.ts` i `<ListControls>` — nie twórz własnego mechanizmu.
   Procedura: `calisthenos-fe:list`.
4. **Osierocony import wciąga serwer do bundla przeglądarki.** Nieużywany import modułu
   serwerowego w pliku trasy przechodzi `tsc` **bez słowa** i wywala się dopiero na
   `npm run build`. Usuwaj importy, których nie używasz — także te, które „zaraz się przydadzą".

## UI

Cała warstwa produktu jest **polskojęzyczna**; angielskie zostają tylko nazwy ćwiczeń. Brand
`kalisthenos` zawsze małą literą. Gdy zmiana dotyka warstwy wizualnej, prowadzi ją skill
`frontend-design:frontend-design` zgodnie z `design-system/README.md`.

## Domknięcie

Wpis w `app/routes.ts`, aktualizacja mapy w `app/routes/README.md`, `npm run typecheck`,
`npm run lint`, **`npm run build`**. Kończysz na `/finish`.

**Git prowadzi agent** — od 2026-09-07, tą samą konwencją co w BE, więc zamknięcie kończy się
commitem. Ale to drzewo **nie ma ani jednego hooka gita**, więc przed `git commit` uruchamiasz
sam `npx tsc --noEmit` i `npx biome check <zmienione pliki>` — **po plikach, nie po `.`**, bo
`check .` topi diff w ~260 błędach o zakończeniach linii (D-FE-1). **`npm install` i Docker nadal
prowadzi Właściciel.**

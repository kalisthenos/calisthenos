# app/routes/ — trasy RR7

Trasy aplikacji w konwencji file-based React Router v7. Mapowanie URL→plik
definiuje [`../routes.ts`](../routes.ts) — **dodając/zmieniając trasę edytuj
oba**: plik trasy i `routes.ts`. Większość plików eksportuje część z:
`loader` (odczyt danych SSR), `action` (mutacje), `default` (komponent),
`ErrorBoundary`, `meta`.

## Driver

- **Kształt:** loadery czytają, akcje mutują. Nie ma osobnego API po tej stronie
- **Reguła nadrzędna:** **trasa to plik PLUS wpis w `app/routes.ts`** — sam plik daje martwy
  komponent i nic tego nie zgłasza
- **Czego trasa nie robi:** nie woła klienta backendu, nie dokłada origin do odnośników
  plikowych, nie buduje własnego mechanizmu sortowania list
- **Procedura:** `calisthenos-fe:route`
- **Ostatnia rewizja:** 2026-09-06

## Trasy top-level (w tym katalogu)

| Plik | URL | Eksporty | Rola | Co robi |
|---|---|---|---|---|
| `_index.tsx` | `/` | loader | public | Przekierowanie: trener→`/trener`, podopieczny→`/podopieczny`, gość→`/login`. |
| `login.tsx` | `/login` | loader, action, default | public | Logowanie email+hasło przez `POST /v1/auth/login` (`startSession`). Hasło weryfikuje BE — u siebie liczy pełny hasz także dla nieistniejącego konta i tam też stoi limit prób, kluczowany **adresem e-mail**, nie IP. Loader jest synchroniczny: zalogowanego rozpoznaje po `context` z middleware'u, bez zapytania. |
| `wyloguj.tsx` | `/wyloguj` | loader, action | auth | Gasi sesję w BE (`POST /v1/auth/logout`) i czyści ciastko. Czyszczenie jest **bezwarunkowe**, gaszenie best-effort — odwrotna zależność zostawiałaby użytkownika zalogowanego w przeglądarce, gdy backend akurat nie odpowiada. |
| `zaproszenie.$token.tsx` | `/zaproszenie/:token` | loader, action, default | public | Podgląd (`GET /v1/invites/{token}`) i przyjęcie (`POST /v1/invites/{token}/accept`). BE zakłada albo odnawia konto, stempluje formularz startowy i zużywa zaproszenie **w jednej transakcji**. Nieistniejące, zużyte i wygasłe zaproszenie dają jeden `404` — osobne kody byłyby wyrocznią. Redirect idzie na `/`, nie do sekcji: odpowiedź przyjęcia typuje role szerzej niż `MeDto`, więc sekcję rozstrzyga `_index.tsx` na wąskim `/v1/me`. Kwotę miesięczną z zaproszenia zapisuje BE zdarzeniem `TraineeJoined` — FE już tego nie robi. |
| `upload.wideo.tsx` | `/upload/wideo` | action | auth (podopieczny) | **Trasa zasobowa** (bez komponentu): JEDNO nagranie serii → `{ fileId, bytes }` przez kontrakt (`uploadSetVideo`, dwie fazy). Trasa zostaje po stronie FE, bo XHR z paskiem postępu woła własny origin. Bramka płatności zniknęła stąd w S6 razem ze Stripe'em; bramka formularza startowego i limit wysyłek przeszły do BE — ich odmowy wracają jako JSON z komunikatem BE i tym samym statusem (`403`, `429` + `Retry-After`). `kind` wynika z operacji kontraktu. Zwrócony `fileId` sam w sobie NIC nie uprawnia — własność weryfikuje BE przy zapisie treningu. |
| `healthz.tsx` | `/healthz` | loader | public | **Trasa zasobowa** (bez komponentu): sonda żywotności pod `healthcheckPath` z `railway.toml`. Zwraca `200 "ok"`, nie dotykając bazy ani sesji. Railway uznaje deploy za zdrowy WYŁĄCZNIE po 200, więc `/` się nie nadaje — `_index.tsx` przekierowuje zawsze, a 302 platforma raportuje jako „failed with service unavailable". Świadomie płytka: odpytywanie Postgresa kładłoby kontener przy każdym mrugnięciu bazy (`restartPolicyType = "ON_FAILURE"`). Brak eksportu `default` → RR7 nie odpala loadera `root.tsx` — co po przejściu plików na kontrakt nie ma już znaczenia praktycznego, bo tamten loader nie budzi żadnej sprzątaczki (obie przeszły na drugą stronę). |

## Strażnik szwu app/lib

Trasa bierze dane z modułu `app/lib/*`, moduł rozmawia z BE. Pilnuje tego
`no-direct-api.test.ts`: **trasa nie woła klienta wprost** — zakaz importu
wartości z `~/lib/api/client` i z `@kalisthenos/api-client`. `import type`
wolno, bo typ DTO w propsach niczego nie woła. Reguła sprawdzana także na
atrapach: bramka bez winowajcy w drzewie jest inaczej nie do odróżnienia od
bramki zepsutej. Reszta `~/lib/api/*` (`requireUser`, `ApiError`,
`toRouteResponse`, ciastko sesji) jest dozwolona — to infrastruktura żądania.

Poprzedniczką była `no-direct-db.test.ts` (zakaz zapytań i transakcji w trasie).
Zniknęła w S6 razem z bazą: to ten sam szew, zmieniła się tylko jego druga
strona — zamiast Drizzle stoi tam dziś kontrakt BE.

## Podkatalogi

| Katalog | Prefiks | Zawartość |
|---|---|---|
| [`trener/`](trener/README.md) | `/trener/*` | Pulpit, podopieczni, biblioteka ćwiczeń, edytor planów. Desktop-first. |
| [`podopieczny/`](podopieczny/README.md) | `/podopieczny/*` | Plan, sesje, logowanie treningu, historia, statystyki, sylwetka, Wrapped. Mobile-first/PWA. |

---
Konwencja i zasady aktualizacji dokumentacji: [`../../CLAUDE.md`](../../CLAUDE.md).

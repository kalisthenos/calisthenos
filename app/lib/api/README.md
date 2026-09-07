# app/lib/api/ — klient backendu i sesja na tokenach

Warstwa, przez którą aplikacja rozmawia z **osobnym backendem** (`calisthenos-be`)
zamiast z własną bazą. Docelowo moduły w `app/lib/*.ts` biorą pierwszym
parametrem `api: Api` dokładnie tam, gdzie dziś biorą `db: Db` — ta sama
konwencja wstrzykiwania, inny typ po drugiej stronie.

**Sesji dotyka wyłącznie `middleware.ts`.** Loadery i akcje nie czytają ciastka,
nie odświeżają tokenu i nie dopisują `Set-Cookie` — dostają gotowe `{ api, user }`
z `context` przez `requireUser`. Powód jest twardszy niż wygoda: `SessionService.rotate`
w BE przy ponownym użyciu tokenu odświeżającego kasuje **cały łańcuch sesji**, więc
dwie równoległe rotacje tym samym tokenem to wylogowanie ze wszystkich urządzeń.
React Router uruchamia loadery jednej nawigacji równolegle z założenia — jedność
rotacji jest tu warunkiem poprawności, nie optymalizacją.

| Plik | Rola / kluczowe eksporty |
|---|---|
| `client.ts` | Typ `Api` (skonfigurowany klient hey-api) + `createApiClient({ baseUrl, getToken, fetch })`. `throwOnError: true` — moduły domenowe nie rozbierają `{ data, error }`, błąd leci wyjątkiem. `getToken` jest **funkcją**, nie wartością: token zmienia się w trakcie życia klienta przy rotacji. Interceptor błędu mapuje odpowiedź na `ApiError`, przepuszczając nietknięte dwie rzeczy — gotowy już `ApiError` (ścieżka ponowienia przechodzi tędy drugi raz) oraz rzucony `Response`, który jest sygnałem sterowania (przekierowanie sesji), a nie błędem danych. `orNull<T>` — narzędzie reguły D3: funkcja deklarująca `Promise<… \| null>` mapuje `404` na `null`, każda inna pozwala mu lecieć. `publicFileUrl(path)` — **podpisany odnośnik do pliku przychodzi z BE jako ŚCIEŻKA** (`/v1/files/…`), a trafia do `src` w `<video>`/`<img>`; bez origin rozwiązałby się względem FE, gdzie takiej trasy nie ma, i to bez żadnego błędu (puste `<video>` wygląda jak brak nagrania). Origin bierze z `API_PUBLIC_URL`, bo `API_URL` bywa siecią prywatną; wejście bezwzględne zwraca nietknięte. |
| `errors.ts` | `ApiError` (status + `code` + `details`), `parseApiError` (koperta błędu z BE → `ApiError`; **status zachowany**, brak koperty → `UNKNOWN` na tym samym statusie — `502` bierze się osobno z `client.ts`, gdy `fetch` w ogóle nie doszedł do skutku), `toRouteResponse` (`ApiError` → `Response` dla trasy). |
| `session.ts` | Ciastko `__Host-kth_api`: `ApiSession`/`ApiTokens`, `sessionFromTokens` (BE oddaje DŁUGOŚĆ życia, sesja musi znać MOMENT), `buildSessionCookie`, `clearSessionCookie`, `readSessionCookie` (nigdy nie rzuca — treść ciastka pochodzi z przeglądarki), `needsRefresh` (margines 30 s przed faktycznym wygaśnięciem). Bez podpisu i to jest świadome: zawartością są tokeny na okaziciela, które i tak weryfikuje BE. |
| `refresh.ts` | `refreshOnce(refreshToken, { exchange, now })` — **jedyna** droga do rotacji. Trzy warstwy sprawdzane po kolei: okno łaski (`Map<hash, wpis>`, 60 s — dla żądań, które wyszły ze starym ciastkiem, a dotarły po zakończeniu rotacji), mapa w locie (`Map<hash, Promise>` — dla równoległych), dopiero potem `POST /v1/auth/refresh`. Klucz haszowany (sha256), wygasanie leniwe przy odczycie, twardy limit wpisów — żadnych timerów. `resetRefreshState` (testy), `graceWindowSize`. **`exchange` musi się rozstrzygnąć i nieść własny `AbortSignal.timeout`** — wiszące wywołanie przypina wpis w mapie na stałe i zamienia awarię jednego żądania w niedostępność całego konta. |
| `context.ts` | `apiContext` — jedyny klucz `createContext` tej warstwy; typy `ApiBundle`, `AuthUser`, `Role`. `AuthUser.roles` jest **listą** (ADR-0013 dopuścił `trainer` i `trainee` naraz), więc kontrola roli jest sprawdzeniem przynależności, nie równością. |
| `middleware.ts` | `apiMiddleware` — cykl życia sesji w jednym żądaniu, podpięty w `app/root.tsx`, wymaga flagi `future.v8_middleware`. Kolejno: brak ciastka → klient anonimowy; `needsRefresh` → rotacja **przed** loaderami (to zabija wachlarz — loadery zastają token świeży); budowa klienta z interceptorem `401` (siatka na token, który umarł w locie: odświeża raz przez `refreshOnce` i ponawia żądanie **z klonu**, bo oryginał ma już zużyte ciało); `GET /v1/me` raz na żądanie; `context.set`; `await next()`; w drodze powrotnej `Set-Cookie`, jeśli sesja się zmieniła. Martwa sesja (`401`) → wyczyszczone ciastko i `redirect("/login")`, bez pętli gdy celem już jest `/login`. Awaria BE (`502`/`500`) **nie** jest wylogowaniem. |
| `auth-session.ts` | Strona **zapisująca**: `startSession` (`POST /v1/auth/login` — jedno wywołanie, bo kontrakt oddaje profil razem z tokenami), `acceptInvite` (`POST /v1/invites/{token}/accept` — oddaje **samą** sesję, bo odpowiedź przyjęcia typuje role szerzej niż `MeDto`), `endSession` (`POST /v1/auth/logout`, best-effort: wywołujący czyści ciastko niezależnie od wyniku). `AuthError` niesie `userMessage` dla trasy — mapowane wąsko (`401`, `404`, `409`, `429`), każdy inny status leci `ApiError`-em do granicy błędu. |
| `auth.ts` | `requireUser(context, { role? })` → `{ api, user }` — **synchroniczne, bez sieci**; użytkownika załadował middleware raz na żądanie. `optionalUser` (trasy publiczne), `hasRole` (przynależność do listy). Brak sesji → `redirect("/login")`; brak wymaganej roli → przekierowanie do sekcji, którą użytkownik ma. |
| `client.test.ts`, `errors.test.ts`, `session.test.ts`, `refresh.test.ts`, `middleware.test.ts`, `auth.test.ts` | Testy jednostkowe wobec podstawionego transportu — bez sieci i bez bazy. |
| `rownolegle-loadery.test.ts` | Osobna bramka na najwyżej wycenione ryzyko: pięć loaderów jednej nawigacji trafia na wygasły token → **jedna** rotacja i **jedno** `Set-Cookie`. Nie do odtworzenia przy pojedynczym żądaniu, więc stoi w osobnym pliku. |

**Dwa adresy w konfiguracji** (`app/lib/env.ts`): `API_URL` — z serwera FE do BE
(na Railway może być siecią prywatną); `API_PUBLIC_URL` — trafia do HTML-a
(`src` obrazków i wideo spod podpisanego `GET /v1/files/{id}`). Puste
`API_PUBLIC_URL` znaczy „taki sam jak `API_URL`".

**Warunek wdrożeniowy:** okno łaski i mapa w locie z `refresh.ts` stoją w pamięci
procesu. Zwielokrotnienie replik FE unieważnia obie warstwy — wtedy albo sesje
przyklejone do instancji, albo okno łaski musi przenieść się do BE.

Projekt tej warstwy:
[`docs/superpowers/specs/2026-08-31-warstwa-klienta-api-fe-design.md`](../../../docs/superpowers/specs/2026-08-31-warstwa-klienta-api-fe-design.md).

---
Konwencja i zasady aktualizacji dokumentacji: [`../../../CLAUDE.md`](../../../CLAUDE.md).

## Driver

- **Kształt:** infrastruktura żądania — klient, sesja na tokenach, rotacja w middlewarze.
  Nie ma tu logiki produktowej i nie powinno jej być
- **Reguła nadrzędna:** **origin dokłada `publicFileUrl` TUTAJ**, w warstwie modułów, nigdy
  w trasie ani w komponencie. Odnośnik do pliku przychodzi jako ścieżka, bo podpisuje go backend
- **Co wolno importować z trasy:** `requireUser`, `ApiError`, `toRouteResponse`, ciastko sesji.
  **Nie wolno**: wartości z `client.ts`
- **Ostatnia rewizja:** 2026-09-06


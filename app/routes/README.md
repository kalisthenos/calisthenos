# app/routes/ — trasy RR7

Trasy aplikacji w konwencji file-based React Router v7. Mapowanie URL→plik
definiuje [`../routes.ts`](../routes.ts) — **dodając/zmieniając trasę edytuj
oba**: plik trasy i `routes.ts`. Większość plików eksportuje część z:
`loader` (odczyt danych SSR), `action` (mutacje), `default` (komponent),
`ErrorBoundary`, `meta`, `headers`.

## Driver

- **Kształt:** loadery czytają, akcje mutują. Nie ma osobnego API po tej stronie
- **Reguła nadrzędna:** **trasa to plik PLUS wpis w `app/routes.ts`** — sam plik daje martwy
  komponent i nic tego nie zgłasza
- **Czego trasa nie robi:** nie woła klienta backendu, nie dokłada origin do odnośników
  plikowych, nie buduje własnego mechanizmu sortowania list
- **Procedura:** `calisthenos-fe:route`
- **Ostatnia rewizja:** 2026-10-03

## Trasy top-level (w tym katalogu)

| Plik | URL | Eksporty | Rola | Co robi |
|---|---|---|---|---|
| `_index.tsx` | `/` | loader | public | Przekierowanie: trener→`/trener`, podopieczny→`/podopieczny`, gość→`/login`. |
| `login.tsx` | `/login` | loader, action, default | public | Logowanie email+hasło przez `POST /v1/auth/login` (`startSession`). Hasło weryfikuje BE — u siebie liczy pełny hasz także dla nieistniejącego konta i tam też stoi limit prób, kluczowany **adresem e-mail**, nie IP. Loader jest synchroniczny: zalogowanego rozpoznaje po `context` z middleware'u, bez zapytania. Pod formularzem odnośnik „Nie masz konta? Załóż konto trenera” prowadzi na `/rejestracja`. |
| `rejestracja.tsx` | `/rejestracja` | loader, action, default | public | **Rejestracja trenera, krok 1**: adres, na który BE wyśle link (`requestRegistration`, `POST /v1/registrations`). Konta po tym kroku jeszcze nie ma — zakłada je dopiero krok 2. Zalogowany jest odsyłany do swojej sekcji (`sectionFor`; loader synchroniczny, jak w `login.tsx`). Zły kształt adresu odbija Zod PRZED modułem, więc nie kosztuje wywołania BE. Wynik akcji wraca danymi: `{ wyslano }` → widok „Sprawdź skrzynkę” z „Wyślij ponownie” (ukryte pole `email`, ta sama akcja — te same limity i odmowy), a `RegistrationError` → `{ blad, odmowa, email }` w formularzu — adres wraca do pola (`defaultValue`), bo odmowa przy „Wyślij ponownie” zastępuje widok „Sprawdź skrzynkę” formularzem i bez adresu stałby on pusty pod komunikatem o „tym adresie” (zły kształt adresu odbity przez Zod adresu nie oddaje); wszystko inne (awaria BE) leci do granicy błędu. Oba przyciski wysyłki są zablokowane na czas nawigacji (`navigation.state !== "idle"`): podwójne kliknięcie zjadałoby limit linków na adres. Przy odmowie `email-taken` pod komunikatem stoi odnośnik do logowania. |
| `rejestracja.$token.tsx` | `/rejestracja/:token` | headers, meta, loader, action, default | public | **Rejestracja trenera, krok 2**: link z maila. Podgląd (`previewRegistration`, `GET /v1/registrations/{token}`) pokazuje adres z linku (tylko do odczytu — akcja go nie czyta, BE bierze go z tokenu) i zgody do zaakceptowania; wysłanie (`completeRegistration`, `POST /v1/registrations/{token}/complete`) zakłada konto, zapisuje zgody z numerami wersji, które człowiek właśnie zobaczył (wartość pola `zgoda` to `klucz:numerWersji`), wystawia sesję i odsyła na `/` — sekcję rozstrzyga `/v1/me` z następnego żądania, jak przy zaproszeniu. **Stan ekranu wraca danymi, nie wyjątkiem**: loader oddaje `stan` — `formularz`, `link-niewazny` (jeden `404` na link nieistniejący, zużyty i wygasły), `adres-zajety`, `rejestracja-zamknieta` (komunikat i odnośnik do `/login` — nowy link nie pomoże, dopóki rejestracja jest zamknięta, ale karta nie jest ślepym zaułkiem) albo `limit` (`429` z minutami); awaria BE leci do granicy błędu, a zalogowany jest odsyłany do sekcji bez wołania BE. Klucz pola zgody niesie numer wersji, więc po odmowie `consents-changed` nowa wersja montuje pole od nowa — odznaczone. „Załóż konto” jest zablokowane na czas nawigacji: drugie kliknięcie trafiłoby na token już zużyty, a człowiek ma wtedy konto i widziałby „Link jest nieważny albo wygasł”. Odnośniki „przeczytaj” otwierają `/dokumenty/:klucz/:wersja` w nowej karcie, z `noreferrer` — adres tej strony niesie token. Nagłówki i `meta` — konwencje niżej. |
| `dokumenty.$klucz.$wersja.tsx` | `/dokumenty/:klucz/:wersja` | loader, meta, default | public | **Treść dokumentu zgody w wersji** (`consentDocument` z `lib/consent-documents.ts`, `GET /v1/consents/{key}/versions/{versionNumber}`) — do przeczytania przed akceptacją, zapisania i wydruku. Markdown renderuje `react-markdown` (elementy Reacta, surowego HTML nie przepuszcza), a klasa `dokument-tresc` z `styles/tokens.css` daje mu minimalną typografię — katalog zgód dostarcza sam Markdown, bez własnych styli. Strona jest dla każdego i **nie odsyła zalogowanego do jego sekcji**, inaczej niż trasy rejestracji: regulamin ma być do przeczytania także przez kogoś, kto już ma konto. Wszystko, co nie jest dokumentem, kończy się `404`: numer wersji niebędący dodatnią liczbą całkowitą nie kosztuje wywołania BE, a nieznany klucz i nieznany numer są nieodróżnialne. Awaria BE — także `429` z limitu ogólnego — leci do granicy błędu. Data „obowiązuje od” jest formatowana w `APP_TIME_ZONE`, żeby serwer i przeglądarka pokazały ten sam dzień. |
| `wyloguj.tsx` | `/wyloguj` | loader, action | auth | Gasi sesję w BE (`POST /v1/auth/logout`) i czyści ciastko. Czyszczenie jest **bezwarunkowe**, gaszenie best-effort — odwrotna zależność zostawiałaby użytkownika zalogowanego w przeglądarce, gdy backend akurat nie odpowiada. |
| `zaproszenie.$token.tsx` | `/zaproszenie/:token` | loader, action, default | public | Podgląd (`GET /v1/invites/{token}`) i przyjęcie (`POST /v1/invites/{token}/accept`). BE zakłada albo odnawia konto, stempluje formularz startowy i zużywa zaproszenie **w jednej transakcji**. Nieistniejące, zużyte i wygasłe zaproszenie dają jeden `404` — osobne kody byłyby wyrocznią. Redirect idzie na `/`, nie do sekcji: odpowiedź przyjęcia typuje role szerzej niż `MeDto`, więc sekcję rozstrzyga `_index.tsx` na wąskim `/v1/me`. |
| `upload.wideo.tsx` | `/upload/wideo` | action | auth (podopieczny) | **Trasa zasobowa** (bez komponentu): JEDNO nagranie serii → `{ fileId, bytes }` przez kontrakt (`uploadSetVideo`, dwie fazy). Trasa zostaje po stronie FE, bo XHR z paskiem postępu woła własny origin. Bramka formularza startowego i limit wysyłek przeszły do BE — ich odmowy wracają jako JSON z komunikatem BE i tym samym statusem (`403`, `429` + `Retry-After`). `kind` wynika z operacji kontraktu. Zwrócony `fileId` sam w sobie NIC nie uprawnia — własność weryfikuje BE przy zapisie treningu. |
| `biblioteka-cwiczen.tsx` | `/biblioteka-cwiczen` | loader | auth (podopieczny) | **Trasa zasobowa** (bez komponentu, wzorem `upload/wideo`): karmi `ExercisePicker` (`components/exercise-picker`) na ekranie logowania treningu — `listActiveExercisesForTrainee(api)` przez `useFetcher`, leniwie, dopiero przy pierwszym otwarciu modala wymiany/dodatku, nie przy każdym wejściu na trening. **Stoi POZA blokiem `prefix("podopieczny")`** z tego samego powodu co `upload/wideo`: nie należy do layoutu z sidenavem, bo woła ją fetcher modala, nie nawigacja — dołożenie jej do `children` dałoby jej sidenav, którego nigdy nie renderuje. **Nie rzuca na awarii biblioteki** — oddaje `{ exercises: [], error }`, a wybierak pokazuje komunikat u siebie: `useFetcher` rejestruje się pod trasą, która go RENDERUJE, więc rzucenie stąd trafiłoby w `ErrorBoundary` trasy logowania i zmiotło wypełniony formularz zdaniem o zapisie, którego nie było. Przechodzi dalej wyłącznie `Response` (przekierowanie po martwej sesji — sygnał sterowania, nie awaria danych), tak samo jak w `upload/wideo`. Zakres najemcy niesie token; trasa nie zna i nie może znać identyfikatora trenera. |
| `healthz.tsx` | `/healthz` | loader | public | **Trasa zasobowa** (bez komponentu): sonda żywotności pod `healthcheckPath` z `railway.toml`. Zwraca `200 "ok"`, nie dotykając bazy ani sesji. Railway uznaje deploy za zdrowy WYŁĄCZNIE po 200, więc `/` się nie nadaje — `_index.tsx` przekierowuje zawsze, a 302 platforma raportuje jako „failed with service unavailable". Świadomie płytka: odpytywanie Postgresa kładłoby kontener przy każdym mrugnięciu bazy (`restartPolicyType = "ON_FAILURE"`). Brak eksportu `default` → RR7 nie odpala loadera `root.tsx` — co po przejściu plików na kontrakt nie ma już znaczenia praktycznego, bo tamten loader nie budzi żadnej sprzątaczki (obie przeszły na drugą stronę). |

Wpisy tych trzech tras (rejestracji i dokumentu zgody) w `app/routes.ts` pilnuje
`rejestracja.wpisy.test.ts` — na WYLICZONEJ konfiguracji i na jej szczycie, poza layoutami,
nie na jej tekście.

## Konwencje, które weszły z trasami rejestracji (2026-10-03)

- **Widok trasy w teście: statyczny router danych.** Bez `@testing-library/react` kształt
  widoku sprawdza się serwerowo — `createStaticHandler` z trasą (`Component`, `loader`,
  `action`) plus `StaticRouterProvider` w `renderToStaticMarkup`; pomocnik `wyrenderuj`
  w `rejestracja.token.test.ts` (kopie w `rejestracja.test.ts` i `dokumenty.test.ts`). Działają
  te same hooki co w przeglądarce (`useLoaderData`, `useActionData`, `Form`), a przy żądaniu
  `POST` router woła akcję, potem loader. Pierwszy raz dla trasy z danymi — same komponenty
  sprawdzano dotąd bez routera danych: samym `renderToStaticMarkup`
  (`app/components/ai-notes-panel.test.tsx`) albo, gdy niosą `<Link>`, w `StaticRouter`
  (`app/components/trainee-health.test.tsx`). **Czego to nie dowodzi:** statyczny router stoi
  zawsze w stanie `idle`, więc blokady przycisku na czas wysyłki (`busy`) test nie zobaczy,
  a `required` i `minLength` blokują wysyłkę dopiero w przeglądarce.
- **`headers()` trasy łączy `parentHeaders`.** React Router 7.15.1 nie dziedziczy nagłówków
  rodzica: składa je od nowa z tego, co zwróci `headers()` trasy, a z rodzica przenosi tylko
  `Set-Cookie`. Goły obiekt zdejmuje więc ze strony CSP, HSTS, `nosniff` i `Permissions-Policy`
  z `root.tsx` — bez żadnego objawu. Trasa BEZ `headers` dziedziczy nagłówki rodzica w całości,
  więc pułapka zaczyna się dopiero od pierwszego własnego `headers()`. Wzór:
  `rejestracja.$token.tsx` (`new Headers(parentHeaders)`, dopiero potem `set`); pilnuje go
  przypadek „zachowuje pozostałe nagłówki bezpieczeństwa rodzica” w `rejestracja.token.test.ts`.
- **`Referrer-Policy: strict-origin`, nie `no-referrer`, na stronie z tokenem w adresie**
  (plus `Cache-Control: no-store`). Przy `no-referrer` przeglądarka wysyła na natywnym POST
  formularza (bez JS albo przed hydratacją) `Origin: null`, a kontrola CSRF React Routera
  (`throwIfPotentialCSRFAttack`) traktuje je jak obcy origin i odrzuca akcję odpowiedzią `400`;
  wysyłka z JS przechodzi w obu przypadkach, więc błąd nie ujawnia się w zwykłym użyciu.
  `strict-origin` wysyła w `Referer` samo origin — token zostaje na stronie — i zostawia
  prawdziwy `Origin`. Uzasadnienie: docblock `headers` w `rejestracja.$token.tsx`. Nagłówki
  te nie obejmują strony błędu pod tym samym adresem: gdy loader rzuca, `headers()` trasy nie
  jest wołane i obowiązują nagłówki roota (D-FE-9 w `docs/defekty.md`). **Wyjątek, o którym
  wiadomo:** `zaproszenie.$token.tsx` też ma token w adresie, a tych nagłówków nie ma
  (D-FE-10 w `docs/defekty.md`).
- **Eksport `meta` — pierwszy w trasach.** `rejestracja.$token.tsx` zakazuje indeksowania
  (`robots: noindex` — token w adresie i adres e-mail na stronie) i ustawia tytuł karty;
  `dokumenty.$klucz.$wersja.tsx` podpisuje kartę tytułem dokumentu (`MetaFunction<typeof loader>`;
  gdy loader rzucił `404`, nie dokłada nic). Tytuły kończą się „— kalisthenos”.

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

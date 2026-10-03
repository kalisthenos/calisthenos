# app/ — źródło aplikacji React Router v7

Korzeń kodu aplikacji (framework mode RR7, SSR). To katalog-indeks; szczegóły są
w `README.md` podkatalogów.

## Pliki w tym katalogu

| Plik | Rola |
|---|---|
| `root.tsx` | Powłoka dokumentu HTML (locale `pl`, motyw z cookie), globalne providery `ToastProvider` + `ConfirmProvider`, nagłówki bezpieczeństwa (CSP, HSTS, X-Content-Type-Options, Referrer-Policy, Permissions-Policy — trasa z własnym `headers()` ich NIE dziedziczy, patrz [`routes/README.md`](routes/README.md)), middleware sesji (`apiMiddleware`). Root loader jest pusty — obie leniwe sprzątaczki (sesje, nagrania-sieroty) przeszły na drugą stronę kontraktu. |
| `routes.ts` | Drzewo tras RR7: top-level (`/`, `login`, `rejestracja`, `rejestracja/:token`, `dokumenty/:klucz/:wersja`, `wyloguj`, `zaproszenie/:token`, `upload/wideo`, `biblioteka-cwiczen`, `healthz`) + prefiksy `trener/*` i `podopieczny/*` z layoutami. Każda nowa trasa musi tu trafić. |

## Podkatalogi

| Katalog | Zawartość |
|---|---|
| [`routes/`](routes/README.md) | Trasy (loadery, akcje, komponenty). Podział na [`trener/`](routes/trener/README.md) i [`podopieczny/`](routes/podopieczny/README.md). |
| [`components/`](components/README.md) | Współdzielone komponenty UI (modale, to'sty, dropzone, ikony, widżety statystyk…). |
| [`lib/`](lib/README.md) | Logika domenowa + infrastruktura: [`api/`](lib/api/README.md), [`auth/`](lib/auth/README.md) oraz moduły domenowe (plany, treningi, statystyki…). Katalog `storage/` zniknął razem z ostatnim zapisem na wolumen FE, a `db/` — razem z całą bazą w segmencie S6. |
| [`styles/`](styles/README.md) | Globalne tokeny CSS (`tokens.css`). |

---
Konwencja i zasady aktualizacji dokumentacji: [`../CLAUDE.md`](../CLAUDE.md).

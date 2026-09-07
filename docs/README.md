# docs/ — dokumentacja, plany i logi

Materiały projektowe: specyfikacja, plany implementacji, notatki o zmianach oraz
surowe logi z buildów/deployów (do diagnostyki).

## Pliki w tym katalogu

| Plik | Rola |
|---|---|
| `defekty.md` | **Rejestr otwartych defektów i długu tego drzewa** — pozycja naprawiona zostaje na miejscu z ✅, nie znika. Założony 2026-09-07 wraz z pierwszą pozycją (D-FE-1: całe drzewo czerwone w `biome check` przez CRLF na Windows). Odpowiednik `calisthenos-be/docs/defekty.md`, zapowiadany przez `CLAUDE.md` korzenia. |
| `innovate.md` | Backlog kierunków rozwoju z sesji innowacyjnej (A–E): wyróżnik produktowy, statusy, na czym bazują, sugerowana kolejność. Lista do wyboru pod kolejne `/feature`. |
| `statistics-plan.md` | Pełny katalog propozycji statystyk (trener o podopiecznym i podopieczny o sobie) z oceną wartości. Bazuje na obecnym schemacie. |
| `mvp-statistics.md` | Zawężenie powyższego do MVP — proste agregacje SQL bez nowych tabel i wykresów. |
| `error.md` | Zrzut logu błędu runtime (m.in. `EACCES mkdir '/data/body'` — uprawnienia wolumenu). Kontekst diagnostyczny. |
| `audyt.md` | Audyt wydajności, niezawodności i obserwowalności (2026-07-22, 7 użytkowników prod). Stan logowania i plan jego naprawy, znaleziska niezawodnościowe (migracje na Railway, timeouty, graceful shutdown), proponowana kolejność wdrożenia + załącznik ze 108 potwierdzonymi znaleziskami. |
| `ddd.md` | Metodyka analizy DDD istniejącego systemu pod rozbicie FE/BE: ustalenie drivera, inwentaryzacja, event storming, klasyfikacja subdomen, heurystyka wyboru stylu per moduł, konteksty i context map, kontrakty API, strangler fig, decyzje przekrojowe. Punkt wyjścia analizy z 2026-07-28. |
| `skill-tree.png` | Zrzut drzewa umiejętności z produkcji (widok podopiecznego) — punkt wyjścia do redesignu. |
| `skill-tree-options.html` | Makieta czterech kierunków redesignu drzewa umiejętności (Monument · Mapa linii · Gałąź · Trasa) na danych z produkcji. Samodzielny plik — otwiera się w przeglądarce, fonty i tokeny bierze z repo. Do wyboru jednego kierunku przed `/feature`. |

## Podkatalogi

| Katalog | Zawartość |
|---|---|
| [`superpowers/`](superpowers/README.md) | Spec produktu, plany faz, notatki zmian, logi build/deploy z Railway. |
| [`backend/`](backend/README.md) | **Materiały do budowy backendu jako osobnej usługi** — warstwa produktowo-domenowa, świadomie bez decyzji technologicznych: zakres funkcjonalny, subdomeny i mapa kontekstów, zasoby domenowe z niezmiennikami, modele odczytu per ekran, kontrakt API. |

---
Konwencja i zasady aktualizacji dokumentacji: [`../CLAUDE.md`](../CLAUDE.md).

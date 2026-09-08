---
name: e2e-test
description: Test Playwright w tests/e2e przeciw prawdziwemu backendowi — dla przepływów, których nie da się dowieść przy podstawionym kliencie. Użyj oszczędnie i świadomie.
argument-hint: <przepływ>
---

Przepływ: **$ARGUMENTS**

## Stan, który trzeba znać od pierwszej minuty

**`tests/e2e` jest dziś PUSTY.** Testy integracyjne na kontenerach zniknęły razem z bazą
w segmencie S6 integracji; ich rolę ma przejąć Playwright przeciw prawdziwemu backendowi.
Piszesz więc nie „kolejny test", tylko **pierwszy albo jeden z pierwszych** — i to, co ustalisz
teraz, będzie kopiowane.

## Czego NIE dowodzić tutaj

Test e2e kosztuje przeglądarkę, działający backend i czas. Jeśli własność da się pokazać przy
**podstawionym kliencie** (`calisthenos-fe:lib-module`), to jest jej miejsce — tam biegnie
w milisekundach i nie wymaga niczego poza Node'em.

Tutaj zostaje wyłącznie to, czego tamta droga nie widzi:

- **prawdziwa sesja** — logowanie, rotacja tokenu, wygaśnięcie, wylogowanie;
- **przejścia między trasami** wraz z loaderami i akcjami po drodze;
- **wysyłka pliku od wyboru do wyświetlenia** — dwufazowa, więc przy podstawionym kliencie
  dowodzi się tylko połowa;
- **zachowanie przy odmowie backendu** — `404` na cudzy zasób, bramka formularza startowego.

## Dwie rzeczy, które sprawiają, że test przechodzi z niewłaściwego powodu

1. **Dane, w których obie strony są tożsame.** Jeśli reguła mówi „widok trenera różni się od
   widoku podopiecznego", a test loguje tylko podopiecznego, przejdzie niezależnie od
   implementacji. Ta sama pułapka co po stronie backendu przy podpisie nagrania.
2. **Asercja na tym, że coś się wyrenderowało.** Obecność elementu nie dowodzi, że niesie
   właściwą treść — a to zwykle o treść chodzi.

## Granica, której nie przekraczasz

**Docker i uruchamianie stacku prowadzi Właściciel.** Piszesz test i **nie uruchamiasz go**;
w relacji podajesz komendę i to, czego test dowodzi. To nie jest wygoda — bez działającego
backendu Playwright nie padnie na asercji, tylko **nie wystartuje**, a to wygląda w logu inaczej
niż czerwień i bywa przeoczone.

## Domknięcie

`npm run typecheck`, `npm run lint`. Aktualizacja `tests/README.md`, gdy zmienia się to, co
w ogóle w tym katalogu stoi.

Kończysz **relacją**: co napisane, jaką komendą uruchomić, czego dowodzi i czego nie — a potem
commitem, bo **git prowadzi agent** od 2026-09-07, tą samą konwencją co w BE. Relacja zastępuje
tu wynik testu, nie commit: scenariusza nie uruchamiasz, więc nie masz zieleni do pokazania.

To drzewo **nie ma ani jednego hooka gita**, więc przed `git commit` uruchamiasz sam
`npx biome check <zmienione pliki>` — **po plikach, nie po `.`**, bo `check .` topi diff w ~260
błędach o zakończeniach linii (D-FE-1). **Docker, stack i `npm install` nadal prowadzi
Właściciel** — to jest granica, która NIE padła.

---
name: component
description: Komponent współdzielony w app/components — zgodny z design-systemem, bez własnych wywołań backendu. Użyj, gdy kawałek widoku ma być użyty w więcej niż jednym miejscu.
argument-hint: <nazwa-komponentu>
---

Komponent: **$ARGUMENTS**

## Najpierw: czy to na pewno komponent współdzielony

`app/components/` jest dla rzeczy używanych w **więcej niż jednym miejscu**. Kawałek widoku
z jednym użytkownikiem zostaje przy trasie — przeniesienie go tutaj kosztuje bez zysku,
a katalog współdzielony puchnie o rzeczy, których nikt nie współdzieli.

## Komponent nie woła backendu

Dane wchodzą **właściwościami**, z loadera trasy. Komponent, który sam sięga po dane, przestaje
być testowalny w oderwaniu i wiąże widok z siecią.

Ta sama reguła co przy trasach: **odnośnik do pliku dokłada origin w module `app/lib`**, nie
tutaj. Komponent dostaje gotowy adres.

## Warstwę wizualną prowadzi design-system

Gdy zmiana dotyka wyglądu — nowy widok, layout, stylowanie — implementację prowadzi skill
`frontend-design:frontend-design`, zgodnie z `design-system/README.md` i tokenami
w `app/styles/`.

**Nie wprowadzaj wartości kolorów, odstępów ani krojów wprost.** Tokeny istnieją po to, żeby
zmiana marki była jedną zmianą, a nie dwustoma.

## UI po polsku

Cała warstwa produktu jest polskojęzyczna. Angielskie zostają wyłącznie nazwy ćwiczeń
(Pull-up, Front Lever…). Brand `kalisthenos` **zawsze małą literą** — także na początku zdania.

## Listy mają gotowy mechanizm

Sortowanie, filtrowanie i szukajka idą przez URL params i przez `<ListControls>`. Nie buduj
drugiego mechanizmu — procedura: `calisthenos-fe:list`.

## Pułapka, która nie objawia się w typach

**Klucz `key` złożony z indeksu tablicy** psuje zachowanie listy przy zmianie kolejności,
a `tsc` tego nie zobaczy. Biome łapie wyłącznie postać `key={i}` — klucz sklejony
(`${id}-${idx}`) przechodzi. Jeśli musisz go użyć, wiedz, że **`biome-ignore` nad takim kluczem
sam daje ostrzeżenie** o nieużytej supresji.

## Domknięcie

`npm run typecheck`, `npm run lint`, `npm run build`. Aktualizacja
`app/components/README.md`. Do iteracji nad wyglądem jest pętla zrzutów ekranu
(`npm run shots`) — **wymaga działającego backendu i uruchamia ją Właściciel**.

Kończysz na `/finish` — **git i Docker prowadzi Właściciel**.

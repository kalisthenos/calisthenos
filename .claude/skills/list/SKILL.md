---
name: list
description: Lista z sortowaniem, filtrowaniem i szukajką — przez URL params i dwa istniejące moduły, nigdy przez własny mechanizm. Użyj, gdy widok pokazuje zbiór, który da się porządkować albo zawężać.
argument-hint: <co listujemy>
---

Lista: **$ARGUMENTS**

## Reguła nadrzędna: dwa moduły, nie trzeci

Sortowanie, filtrowanie i szukajka są **po stronie serwera, sterowane przez URL params**.
Masz na to dwa gotowe kawałki i **reużywasz ich**:

| Co | Gdzie |
| --- | --- |
| odczyt i budowanie parametrów | `app/lib/list-params.ts` — `parseListControls`, `buildControlHref` |
| komponent sterujący | `app/components/list-controls.tsx` — `<ListControls>` |

Trzeci mechanizm oznacza dwa zachowania pod jedną nazwą: dwa sposoby kodowania stanu w adresie,
dwa sposoby obsługi pustego wyniku, dwa miejsca do poprawienia przy zmianie.

## Dlaczego przez URL, a nie przez stan komponentu

Stan w adresie przeżywa odświeżenie, daje się wysłać komuś odnośnikiem i wraca przy cofnięciu
w przeglądarce. Stan w komponencie nie robi żadnej z tych trzech rzeczy — a użytkownik zakłada,
że robi.

## Cztery rzeczy do sprawdzenia po stronie kontraktu

1. **Czy backend czyta ten parametr.** Parametr zadeklarowany w DTO, a nieczytany, **nie objawia
   się niczym**: serwer odpowiada `200` w kształcie, o który klient prosił, i lista wygląda
   dobrze, tylko nie jest posortowana. Po tamtej stronie pilnuje tego bramka, ale **tylko dla
   pól klasy `*Query`** — sprawdź, czy twój parametr nią jest.
2. **Czy `sort` niesie zbiór wartości.** Klient ma dostać unię typów, nie goły napis. Jeśli
   dostaje napis, brakuje deklaracji po stronie backendu.
3. **Czy porządek ma klucz rozstrzygający.** Bez niego wiersze o równej wartości wypadają na
   dwóch stronach naraz albo na żadnej. Objaw czeka na rozmiar — na małych danych bywa niewidoczny.
4. **Nieznana wartość filtra ma być IGNOROWANA**, nie zawężać wyniku do pustego. To reguła
   kontraktu, nie uprzejmość.

Punkty 1–3 są własnością backendu. Jeśli któregoś brakuje, zmiana zaczyna się **tam**, nie tutaj
— patrz procedura `contract-change`.

## Paginacja

Bierze się z kontraktu, nie liczy po tej stronie. Lista pobierająca „wszystko i tnąca w locie"
działa do pierwszego trenera z setką podopiecznych.

## Domknięcie

Test modułu `app/lib` przeciw podstawionemu klientowi (`calisthenos-fe:lib-module`),
`npm run typecheck`, `npm run lint`, `npm run build`. Kończysz na `/finish`.

**Git prowadzi agent** — od 2026-09-07, tą samą konwencją co w BE. Ale to drzewo **nie ma ani
jednego hooka gita**, więc przed `git commit` uruchamiasz sam `npx tsc --noEmit` i `npx biome
check <zmienione pliki>` — **po plikach, nie po `.`**, bo `check .` topi diff w ~260 błędach
o zakończeniach linii (D-FE-1). **`npm install` i Docker nadal prowadzi Właściciel.**

export const NAGLOWEK_ADRESU = "x-kth-client-ip";
export const NAGLOWEK_PRZEGLADARKI = "x-kth-client-ua";
export const NAGLOWEK_SEKRETU = "x-kth-forwarding-secret";

/**
 * Nagłówki, którymi serwer FE mówi BE, kto naprawdę stoi po drugiej stronie (ADR-0048 w BE).
 * FE woła BE ze swojego serwera, więc bez nich BE widzi adres serwera FE — limit po łączu
 * liczyłby wszystkich razem, a dowód zgody zapisałby przeglądarkę „node”.
 *
 * Adres to PIERWSZY wpis `X-Forwarded-For` żądania, które przyszło do FE — przy założeniu, że brzeg
 * Railway nadpisuje nagłówek nadesłany przez klienta. Wypowiedzi Railway na forum są w tej sprawie
 * sprzeczne, więc założenie sprawdza próba z podrobionym nagłówkiem po każdym wdrożeniu FE i zmianie
 * brzegu (ADR-0048 w BE, „Próba z podrobionym nagłówkiem”); czerwona próba = zmiana wyboru wpisu tutaj. Wartości liczymy sami; nagłówków `x-kth-*` od przeglądarki nie
 * przepuszczamy nigdy. Bez sekretu nie dokładamy niczego — BE i tak by nie uwierzył.
 */
export function naglowkiPrzekazania(
  request: Request,
  sekret: string | undefined,
): Record<string, string> {
  if (!sekret) return {};
  const naglowki: Record<string, string> = { [NAGLOWEK_SEKRETU]: sekret };
  const pierwszy = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (pierwszy) naglowki[NAGLOWEK_ADRESU] = pierwszy;
  const przegladarka = request.headers.get("user-agent");
  if (przegladarka) naglowki[NAGLOWEK_PRZEGLADARKI] = przegladarka;
  return naglowki;
}

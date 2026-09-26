import { type ActionFunctionArgs, type LoaderFunctionArgs, redirect } from "react-router";
import { optionalUser } from "~/lib/api/auth";
import { endSession } from "~/lib/api/auth-session";
import { clearSessionCookie, readSessionCookie } from "~/lib/api/session";

async function performLogout(args: LoaderFunctionArgs | ActionFunctionArgs) {
  const { api } = optionalUser(args.context);
  const session = readSessionCookie(args.request.headers.get("cookie"));

  // Kolejność i zależność są tu istotne: gaszenie po stronie BE jest
  // best-effort i nie rzuca (`endSession` połyka błąd), a czyszczenie ciastka
  // dzieje się BEZWARUNKOWO. Odwrotna zależność znaczyłaby, że chwilowa awaria
  // backendu zostawia użytkownika zalogowanego w przeglądarce mimo kliknięcia
  // „wyloguj" — a sesję osieroconą po tamtej stronie zamknie wygaśnięcie.
  if (session) await endSession(api, session);

  return redirect("/login", { headers: { "Set-Cookie": clearSessionCookie() } });
}

export const loader = performLogout;
export const action = performLogout;

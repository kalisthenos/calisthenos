import { type LoaderFunctionArgs, redirect } from "react-router";
import { optionalUser, sectionFor } from "~/lib/api/auth";

/**
 * Root index — always redirects.
 * - Powrót z callbacku kalendarza → /trener/integracje/google
 * - Logged in as trainer → /trener
 * - Logged in as trainee → /podopieczny
 * - Anonymous → /login
 */
export function loader({ request, context }: LoaderFunctionArgs) {
  // BE odsyła przeglądarkę po zgodzie na `WEB_APP_URL`, czyli tutaj: nie zna
  // polskich nazw tras powłoki i znać ich nie ma. Przekierowanie na ekran,
  // który te parametry umie odczytać, jest więc pracą FE.
  //
  // PRZED sprawdzeniem tożsamości i to jest świadome: ekran docelowy i tak
  // wymaga trenera, więc anonim (brak ciastka w ogóle) kończy na `/login`
  // tak samo, jak skończyłby bez tej gałęzi. Prawdziwie wygasłe ciastko tu
  // NIE dociera — przechwytuje je `apiMiddleware`, który przy odmowie
  // odświeżenia przekierowuje na `/login`, zanim router wywoła loadery tras.
  // Dublowanie tu kontroli dawałoby drugie miejsce, w którym ta sama reguła
  // może się rozjechać.
  const { searchParams } = new URL(request.url);
  if (searchParams.has("calendar")) {
    throw redirect(`/trener/integracje/google?${searchParams}`);
  }

  const { user } = optionalUser(context);
  if (!user) throw redirect("/login");
  // Regułę „rola → sekcja" zna wyłącznie `sectionFor` — rola jest LISTĄ
  // (ADR-0013), więc to przynależność, nie równość, a trener wygrywa przy obu.
  throw redirect(sectionFor(user));
}

export default function Index() {
  // Loader always throws a redirect; this component never renders.
  return null;
}

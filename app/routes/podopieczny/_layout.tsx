import { NavLink, Outlet, redirect, useLoaderData, type LoaderFunctionArgs } from "react-router";
import { Icons } from "~/components/icons";
import { UserMenu } from "~/components/user-menu";
import { requireUser } from "~/lib/api/auth";
import { ApiError, toRouteResponse } from "~/lib/api/errors";
import { hasPendingOnboarding } from "~/lib/onboarding-forms";
import { loadTraineeNavigation } from "~/lib/views";

export async function loader(args: LoaderFunctionArgs) {
  const { api, user } = requireUser(args.context, { role: "trainee" });

  // Bramka idzie PRZED licznikami — podopieczny, którego i tak odsyłamy, nie ma
  // po co kosztować dodatkowego wywołania. Formularz startowy jest jedynymi
  // drzwiami do aplikacji i jedyną bramką tej powłoki (ADR-0037: płatności,
  // które stały tu przed nim, wyszły z produktu i nie wracają).
  //
  // Jawnie, przez kontrakt (jedno `GET /v1/me/onboarding-form`, na białej liście
  // bramki BE) — ZANIM policzymy cokolwiek, tak jak do integracji.
  if (await hasPendingOnboarding(api)) throw redirect("/podopieczny/formularz");

  // Jedno wywołanie na ekran — od tego segmentu KAŻDY licznik nawigacji
  // podopiecznego pochodzi stąd. `null` (brak planu) i `0` (plan bez sesji)
  // powłoka pokazuje tak samo — jak do integracji.
  // Siatka na bramkę globalną BE: `/v1/me/nav` odpowiada `403 ONBOARDING_FORM_PENDING`
  // podopiecznemu z oczekującym formularzem. Jawna bramka wyżej odsyła go
  // wcześniej, ale gdyby biała lista po tamtej stronie kiedyś się zmieniła,
  // `toRouteResponse` zamienia to na to samo przekierowanie, nie na ekran błędu.
  let nav: Awaited<ReturnType<typeof loadTraineeNavigation>>;
  try {
    nav = await loadTraineeNavigation(api);
  } catch (e) {
    if (e instanceof ApiError) throw toRouteResponse(e);
    throw e;
  }
  const sessionsCount = nav.activePlanSessions ?? 0;

  return {
    user,
    tails: {
      sessions: sessionsCount,
      history: nav.workoutLogs,
      // Z tego samego `nav` (`TraineeNavView.bodyPhotos`) — obszar sylwetki
      // przeszedł na kontrakt, więc jego licznik wyszedł z bazy razem z nim.
      photos: nav.bodyPhotos,
      // Z tego samego `nav` (`TraineeNavView.pendingConsultations`) — obszar
      // konsultacji przeszedł na kontrakt. Ten licznik liczy `planned` TAKŻE
      // przeszłe, jak liczył dawny `countPendingForTrainee`; nadchodzące
      // wybiera osobno `loadUpcomingConsultations` i to są różne pytania.
      consultations: nav.pendingConsultations,
      // Z tego samego `nav` (`TraineeNavView.featureRequests`) — obszar zgłoszeń
      // przeszedł na kontrakt, więc jego licznik wyszedł z bazy razem z nim.
      ideas: nav.featureRequests,
    },
  };
}

const NAV_ITEMS = [
  { to: "/podopieczny", label: "Mój plan", end: true, icon: "Dashboard" as const, tailKey: null },
  {
    to: "/podopieczny/sesje",
    label: "Sesje",
    end: false,
    icon: "Plans" as const,
    tailKey: "sessions" as const,
  },
  {
    to: "/podopieczny/historia",
    label: "Historia",
    end: false,
    icon: "History" as const,
    tailKey: "history" as const,
  },
  {
    to: "/podopieczny/rozwoj",
    label: "Rozwój",
    end: false,
    icon: "Trend" as const,
    tailKey: null,
  },
  {
    to: "/podopieczny/sylwetka",
    label: "Sylwetka",
    end: false,
    icon: "Camera" as const,
    tailKey: "photos" as const,
  },
  {
    to: "/podopieczny/konsultacje",
    label: "Konsultacje",
    end: false,
    icon: "Consult" as const,
    tailKey: "consultations" as const,
  },
  {
    to: "/podopieczny/pomysly",
    label: "Pomysły",
    end: false,
    icon: "Sparkle" as const,
    tailKey: "ideas" as const,
  },
];

export default function PodopiecznyLayout() {
  const { user, tails } = useLoaderData<typeof loader>();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span>calisthenos</span>
          <span className="brand-dot" />
        </div>
        <span className="topbar-eyebrow">PODOPIECZNY</span>
        <div className="topbar-spacer" />
        <UserMenu displayName={user.displayName} />
      </header>
      <div className="layout">
        <nav className="sidenav nav-tabs-bottom">
          <div className="sidenav-section">Podopieczny</div>
          {NAV_ITEMS.map((item) => {
            const Icon = Icons[item.icon];
            const tail = item.tailKey ? tails[item.tailKey] : null;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `nav-item${isActive ? " active" : ""}`}
              >
                <Icon />
                <span>{item.label}</span>
                {tail != null && <span className="nav-tail">{tail}</span>}
              </NavLink>
            );
          })}
        </nav>
        <main className="main view-fade">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

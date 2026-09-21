import { type LoaderFunctionArgs, NavLink, Outlet, useLoaderData } from "react-router";
import { Icons } from "~/components/icons";
import { UserMenu } from "~/components/user-menu";
import { requireUser } from "~/lib/api/auth";
import { loadTrainerNavigation } from "~/lib/views";

export async function loader(args: LoaderFunctionArgs) {
  const { api, user } = requireUser(args.context, { role: "trainer" });

  // Jedno wywołanie na CAŁĄ powłokę — `countTraineesOfTrainer` zniknęło razem
  // z resztą obszaru podopiecznych.
  const nav = await loadTrainerNavigation(api);

  return {
    user,
    tails: {
      // Podopieczni z AKTYWNĄ relacją prowadzenia. Do integracji licznik celowo
      // liczył także zarchiwizowanych; decyzja D3 specu odwróciła tę regułę —
      // w nawigacji trener chce wiedzieć, ilu prowadzi TERAZ.
      trainees: nav.trainees,
      exercises: nav.activeExercises,
      // Bez zarchiwizowanych — tak liczy BE (`docs/03`: licznik powłoki liczy
      // jak zakładka „wszystkie" na liście). Do integracji liczył także archiwum.
      plans: nav.plans,
      // Wyłącznie zgłoszenia w stanie `new` — tak liczy BE
      // (`TrainerNavView.newFeatureRequests`): sygnał „przyszło coś nowego",
      // dlatego NIE liczy wszystkich.
      ideas: nav.newFeatureRequests,
    },
  };
}

const NAV_ITEMS = [
  { to: "/trener", label: "Pulpit", end: true, icon: "Dashboard" as const, tailKey: null },
  {
    to: "/trener/podopieczni",
    label: "Podopieczni",
    end: false,
    icon: "Users" as const,
    tailKey: "trainees" as const,
  },
  {
    to: "/trener/biblioteka",
    label: "Biblioteka ćwiczeń",
    end: false,
    icon: "Library" as const,
    tailKey: "exercises" as const,
  },
  {
    to: "/trener/plany",
    label: "Plany",
    end: false,
    icon: "Plans" as const,
    tailKey: "plans" as const,
  },
  {
    to: "/trener/umiejetnosci",
    label: "Umiejętności",
    end: false,
    icon: "Trend" as const,
    tailKey: null,
  },
  {
    to: "/trener/konsultacje",
    label: "Konsultacje",
    end: false,
    icon: "Consult" as const,
    tailKey: null,
  },
  {
    to: "/trener/pomysly",
    label: "Pomysły",
    end: false,
    icon: "Sparkle" as const,
    tailKey: "ideas" as const,
  },
  {
    to: "/trener/integracje/google",
    label: "Integracje",
    end: false,
    icon: "Link" as const,
    tailKey: null,
  },
  {
    // Druga pozycja, nie zakładka wewnątrz „Integracji": pasek podzakładek
    // byłby w tym drzewie NOWĄ konwencją (dziś `NavLink` żyje wyłącznie
    // w layoutach), a ekran bez wejścia z menu jest ekranem, którego nie ma.
    to: "/trener/integracje/notatki-ai",
    label: "Notatki AI",
    end: false,
    icon: "Note" as const,
    tailKey: null,
  },
];

export default function TrenerLayout() {
  const { user, tails } = useLoaderData<typeof loader>();

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          <span>calisthenos</span>
          <span className="brand-dot" />
        </div>
        <span className="topbar-eyebrow">TRENER</span>
        <div className="topbar-spacer" />
        <UserMenu displayName={user.displayName} />
      </header>
      <div className="layout">
        <nav className="sidenav">
          <div className="sidenav-section">Trener</div>
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

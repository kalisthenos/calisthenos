import { type RouteConfig, index, route, layout, prefix } from "@react-router/dev/routes";

export default [
  index("routes/_index.tsx"),
  route("login", "routes/login.tsx"),
  route("wyloguj", "routes/wyloguj.tsx"),
  route("zaproszenie/:token", "routes/zaproszenie.$token.tsx"),
  route("upload/wideo", "routes/upload.wideo.tsx"),
  route("biblioteka-cwiczen", "routes/biblioteka-cwiczen.tsx"),
  // Sonda dla healthchecka platformy — MUSI zwracać 200. NIE podmieniaj na "/":
  // trasa indeksowa zawsze przekierowuje, a Railway 3xx traktuje jako awarię.
  route("healthz", "routes/healthz.tsx"),
  ...prefix("trener", [
    layout("routes/trener/_layout.tsx", [
      index("routes/trener/_index.tsx"),
      route("biblioteka", "routes/trener/biblioteka._index.tsx"),
      route("biblioteka/nowe", "routes/trener/biblioteka.nowe.tsx"),
      route("biblioteka/:exerciseId", "routes/trener/biblioteka.$exerciseId.tsx"),
      route("plany", "routes/trener/plany._index.tsx"),
      route("plany/nowy", "routes/trener/plany.nowy.tsx"),
      route("plany/:planId", "routes/trener/plany.$planId.tsx"),
      route("umiejetnosci", "routes/trener/umiejetnosci._index.tsx"),
      route("umiejetnosci/nowa", "routes/trener/umiejetnosci.nowa.tsx"),
      route("umiejetnosci/:skillId", "routes/trener/umiejetnosci.$skillId.tsx"),
      route("konsultacje", "routes/trener/konsultacje.tsx"),
      route("pomysly", "routes/trener/pomysly._index.tsx"),
      route("pomysly/:requestId", "routes/trener/pomysly.$requestId.tsx"),
      route("integracje/google", "routes/trener/integracje.google.tsx"),
      route("podopieczni", "routes/trener/podopieczni._index.tsx"),
      route("podopieczni/:traineeId", "routes/trener/podopieczni.$traineeId.tsx"),
      route(
        "podopieczni/:traineeId/log/:logId",
        "routes/trener/podopieczni.$traineeId.log.$logId.tsx",
      ),
      route("podopieczni/:traineeId/sylwetka", "routes/trener/podopieczni.$traineeId.sylwetka.tsx"),
      route(
        "podopieczni/:traineeId/formularz",
        "routes/trener/podopieczni.$traineeId.formularz.tsx",
      ),
      route(
        "podopieczni/:traineeId/statystyki",
        "routes/trener/podopieczni.$traineeId.statystyki.tsx",
      ),
      route(
        "podopieczni/:traineeId/rozwoj",
        "routes/trener/podopieczni.$traineeId.rozwoj._index.tsx",
      ),
      route(
        "podopieczni/:traineeId/rozwoj/umiejetnosc/:skillId",
        "routes/trener/podopieczni.$traineeId.rozwoj.umiejetnosc.$skillId.tsx",
      ),
      route(
        "podopieczni/:traineeId/rozwoj/cwiczenie/:exerciseId",
        "routes/trener/podopieczni.$traineeId.rozwoj.cwiczenie.$exerciseId.tsx",
      ),
      route(
        "podopieczni/:traineeId/rozwoj/porownanie",
        "routes/trener/podopieczni.$traineeId.rozwoj.porownanie.tsx",
      ),
      route(
        "podopieczni/:traineeId/progresja",
        "routes/trener/podopieczni.$traineeId.progresja._index.tsx",
      ),
      route(
        "podopieczni/:traineeId/progresja/:exerciseId",
        "routes/trener/podopieczni.$traineeId.progresja.$exerciseId.tsx",
      ),
      route(
        "podopieczni/:traineeId/progresja/porownanie",
        "routes/trener/podopieczni.$traineeId.progresja.porownanie.tsx",
      ),
      route(
        "podopieczni/:traineeId/umiejetnosci",
        "routes/trener/podopieczni.$traineeId.umiejetnosci.tsx",
      ),
      route(
        "podopieczni/:traineeId/umiejetnosci/:skillId",
        "routes/trener/podopieczni.$traineeId.umiejetnosci.$skillId.tsx",
      ),
      route(
        "podopieczni/:traineeId/konsultacje",
        "routes/trener/podopieczni.$traineeId.konsultacje._index.tsx",
      ),
      route(
        "podopieczni/:traineeId/konsultacje/nowa",
        "routes/trener/podopieczni.$traineeId.konsultacje.nowa.tsx",
      ),
      route(
        "podopieczni/:traineeId/konsultacje/:konsultacjaId",
        "routes/trener/podopieczni.$traineeId.konsultacje.$konsultacjaId.tsx",
      ),
    ]),
  ]),
  ...prefix("podopieczny", [
    layout("routes/podopieczny/_layout.tsx", [
      index("routes/podopieczny/_index.tsx"),
      route("sesje", "routes/podopieczny/sesje._index.tsx"),
      route("sesje/:sessionId", "routes/podopieczny/sesje.$sessionId.tsx"),
      route("loguj/:sessionId", "routes/podopieczny/loguj.$sessionId.tsx"),
      route("historia", "routes/podopieczny/historia._index.tsx"),
      route("historia/:logId", "routes/podopieczny/historia.$logId.tsx"),
      route("statystyki", "routes/podopieczny/statystyki.tsx"),
      route("rozwoj", "routes/podopieczny/rozwoj._index.tsx"),
      route("rozwoj/umiejetnosc/:skillId", "routes/podopieczny/rozwoj.umiejetnosc.$skillId.tsx"),
      route("rozwoj/cwiczenie/:exerciseId", "routes/podopieczny/rozwoj.cwiczenie.$exerciseId.tsx"),
      route("rozwoj/porownanie", "routes/podopieczny/rozwoj.porownanie.tsx"),
      route("progresja", "routes/podopieczny/progresja._index.tsx"),
      route("progresja/:exerciseId", "routes/podopieczny/progresja.$exerciseId.tsx"),
      route("progresja/porownanie", "routes/podopieczny/progresja.porownanie.tsx"),
      route("sylwetka", "routes/podopieczny/sylwetka.tsx"),
      route("konsultacje", "routes/podopieczny/konsultacje._index.tsx"),
      route("konsultacje/:konsultacjaId", "routes/podopieczny/konsultacje.$konsultacjaId.tsx"),
      route("pomysly", "routes/podopieczny/pomysly.tsx"),
      route("umiejetnosci", "routes/podopieczny/umiejetnosci.tsx"),
      route("umiejetnosci/:skillId", "routes/podopieczny/umiejetnosci.$skillId.tsx"),
    ]),
    // Wrapped lives OUTSIDE the sidenav layout so it can render full-screen.
    route("wrapped/:ym", "routes/podopieczny/wrapped.$ym.tsx"),
    // Formularz startowy — OUTSIDE the layout, bo to dokąd bramka w _layout.tsx
    // odsyła podopiecznych z niewypełnionym formularzem (gdyby było w children
    // → pętla redirectów).
    route("formularz", "routes/podopieczny/formularz.tsx"),
  ]),
] satisfies RouteConfig;

import { useMemo, useState } from "react";
import { Link, type LoaderFunctionArgs, useLoaderData } from "react-router";
import { type ResolvedPair, SideBySideSection } from "~/components/body-photo-compare";
import { PhotoCard } from "~/components/photo-card";
import { type LightboxPhoto, PhotoLightbox } from "~/components/photo-lightbox";
import { requireUser } from "~/lib/api/auth";
import {
  type BodyPhotoView,
  getSideBySidePhotoPairs,
  listAllTraineeBodyPhotos,
} from "~/lib/body-photos";
import { findTraineeRef } from "~/lib/trainees";

export async function loader(args: LoaderFunctionArgs) {
  const { api } = requireUser(args.context, { role: "trainer" });
  const traineeId = args.params.traineeId ?? "";

  // Nagłówek potrzebuje nazwy podopiecznego, a widok galerii jej nie niesie —
  // kontrakt nie ma też trasy „jeden podopieczny", więc moduł składa ją ze
  // sklejonych stron listy (luka L S5-2). `null` to cudzy albo nieistniejący.
  const trainee = await findTraineeRef(api, traineeId);
  if (!trainee) throw new Response("not found", { status: 404 });

  // Jedna sklejona lista karmi i siatkę, i porównanie: ten ekran nigdy nie miał
  // stronicowania, a porównanie „przed / po" i tak potrzebuje kompletu zdjęć.
  // Pola `pairs` z odpowiedzi świadomie nie czytamy — patrz komentarz przy
  // `traineeBodyPhotoPage` w module.
  const photos = await listAllTraineeBodyPhotos(api, traineeId);

  // Adnotacja typem komponentu jest bramką: pilnuje, że kształt pary z modułu
  // nadal pasuje do `SideBySideSection`.
  const resolvedPairs: ResolvedPair[] = getSideBySidePhotoPairs(photos);

  return {
    trainee,
    // Adresy są już gotowe — origin dołożył moduł; trasa tylko przemianowuje pole.
    photos: photos.map((p) => ({
      id: p.id,
      view: p.view,
      takenOn: p.takenOn,
      note: p.note,
      url: p.photoUrl,
    })),
    resolvedPairs,
  };
}

type ViewFilter = "all" | BodyPhotoView;

export default function TrenerSylwetkaPodopiecznego() {
  const { trainee, photos, resolvedPairs } = useLoaderData<typeof loader>();
  const [filter, setFilter] = useState<ViewFilter>("all");
  const [lightboxId, setLightboxId] = useState<string | null>(null);

  const counts = useMemo(() => countByView(photos), [photos]);
  const filteredPhotos = useMemo(
    () => (filter === "all" ? photos : photos.filter((p) => p.view === filter)),
    [photos, filter],
  );

  // Lightbox nav scoped to the clicked photo's VIEW — clicking a "tył" photo
  // gives you only "tył" photos to swipe through, even with filter on
  // "Wszystkie". The filter only governs the grid.
  const activeLightboxPhotos: LightboxPhoto[] = useMemo(() => {
    if (lightboxId == null) return [];
    const opened = photos.find((p) => p.id === lightboxId);
    if (!opened) return [];
    return photos
      .filter((p) => p.view === opened.view)
      .map((p) => ({
        id: p.id,
        url: p.url,
        view: p.view,
        takenOn: p.takenOn,
        note: p.note,
        // Kontrakt nie niesie typu zawartości zdjęcia; lightbox używał go
        // wyłącznie do rozszerzenia w nazwie pobieranego pliku i bez wartości
        // schodzi do domyślnego `.jpg` — luka L S4-1.
        mimeType: "",
      }));
  }, [lightboxId, photos]);

  const groups = useMemo(() => groupByMonth(filteredPhotos), [filteredPhotos]);

  return (
    <div>
      <div className="crumbs">
        <Link to="/trener/podopieczni">Podopieczni</Link>
        <span className="sep">›</span>
        <Link to={`/trener/podopieczni/${trainee.id}`}>{trainee.displayName}</Link>
        <span className="sep">›</span>
        <span className="current">Sylwetka</span>
      </div>
      <div className="pagehead">
        <div>
          <div className="eyebrow" style={{ marginBottom: 6 }}>
            {trainee.displayName}
          </div>
          <h1>Sylwetka</h1>
          <div className="sub">
            {photos.length === 0
              ? "Brak zdjęć."
              : `${photos.length} ${photos.length === 1 ? "zdjęcie" : "zdjęć"} · najnowsze u góry`}
          </div>
        </div>
      </div>

      {photos.length === 0 ? (
        <div className="empty">
          <h3>Brak zdjęć</h3>
          <div>Podopieczny jeszcze nie wgrał żadnego zdjęcia.</div>
        </div>
      ) : (
        <>
          <SideBySideSection pairs={resolvedPairs} onOpenPhoto={setLightboxId} />

          <FilterTabs filter={filter} setFilter={setFilter} counts={counts} />

          {filteredPhotos.length === 0 ? (
            <div className="empty" style={{ marginTop: 12 }}>
              <h3>Brak zdjęć w tym ujęciu</h3>
              <div>Zmień filtr, by zobaczyć inne ujęcia.</div>
            </div>
          ) : (
            <PhotoGrid groups={groups} onOpenPhoto={setLightboxId} />
          )}
        </>
      )}

      {/* Trainer doesn't get the delete button — deleteAction omitted. */}
      <PhotoLightbox
        photos={activeLightboxPhotos}
        currentId={lightboxId}
        onClose={() => setLightboxId(null)}
        onNavigate={setLightboxId}
      />
    </div>
  );
}

// ============================================================
// Filter tabs (shared shape with trainee view).
// ============================================================

function FilterTabs({
  filter,
  setFilter,
  counts,
}: {
  filter: ViewFilter;
  setFilter: (f: ViewFilter) => void;
  counts: Record<ViewFilter, number>;
}) {
  const TABS: Array<{ key: ViewFilter; label: string }> = [
    { key: "all", label: "Wszystkie" },
    { key: "front", label: "Przód" },
    { key: "side", label: "Bok" },
    { key: "back", label: "Tył" },
  ];
  return (
    <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
      {TABS.map((tab) => {
        const isActive = filter === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => setFilter(tab.key)}
            className={isActive ? "btn btn-sm btn-dark" : "btn btn-sm"}
          >
            {tab.label}
            <span className="mono" style={{ marginLeft: 8, fontSize: 10, opacity: 0.7 }}>
              {counts[tab.key] ?? 0}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================
// Grouped grid
// ============================================================

interface PhotoGroup {
  label: string;
  photos: Array<{
    id: string;
    url: string;
    takenOn: string;
    view: BodyPhotoView;
    note: string | null;
  }>;
}

function PhotoGrid({
  groups,
  onOpenPhoto,
}: {
  groups: PhotoGroup[];
  onOpenPhoto: (id: string) => void;
}) {
  return (
    <div className="col" style={{ gap: 18 }}>
      {groups.map((g) => (
        <div key={g.label}>
          <div
            className="mono"
            style={{
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: ".1em",
              color: "var(--muted)",
              marginBottom: 8,
            }}
          >
            {g.label} · {g.photos.length}
          </div>
          <div
            className="grid"
            style={{
              gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
              gap: 12,
            }}
          >
            {g.photos.map((p) => (
              <PhotoCard
                key={p.id}
                id={p.id}
                url={p.url}
                takenOn={p.takenOn}
                view={p.view}
                note={p.note}
                onOpen={onOpenPhoto}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// Helpers (kept in sync with trainee route)
// ============================================================

function countByView(photos: Array<{ view: BodyPhotoView }>): Record<ViewFilter, number> {
  const out: Record<ViewFilter, number> = {
    all: photos.length,
    front: 0,
    side: 0,
    back: 0,
  };
  for (const p of photos) {
    out[p.view] += 1;
  }
  return out;
}

const MONTHS_PL = [
  "Styczeń",
  "Luty",
  "Marzec",
  "Kwiecień",
  "Maj",
  "Czerwiec",
  "Lipiec",
  "Sierpień",
  "Wrzesień",
  "Październik",
  "Listopad",
  "Grudzień",
];

function groupByMonth<
  T extends {
    id: string;
    url: string;
    takenOn: string;
    view: BodyPhotoView;
    note: string | null;
  },
>(photos: T[]): PhotoGroup[] {
  const groups = new Map<string, PhotoGroup>();
  const order: string[] = [];
  for (const p of photos) {
    const d = new Date(p.takenOn);
    const key = `${d.getUTCFullYear()}-${d.getUTCMonth()}`;
    const label = `${MONTHS_PL[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
    let g = groups.get(key);
    if (!g) {
      g = { label, photos: [] };
      groups.set(key, g);
      order.push(key);
    }
    g.photos.push({
      id: p.id,
      url: p.url,
      takenOn: p.takenOn,
      view: p.view,
      note: p.note,
    });
  }
  return order.map((k) => groups.get(k)!);
}

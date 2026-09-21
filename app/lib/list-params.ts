export interface SortOption {
  key: string;
  label: string;
}

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterGroup {
  /** Nazwa parametru URL, np. "status", "tag", "video". */
  param: string;
  /** Etykieta grupy (a11y / opis). */
  label: string;
  /** Dozwolone opcje — mogą być budowane dynamicznie z danych loadera. */
  options: FilterOption[];
  /** Wartość traktowana jako „brak filtra" (usuwana z URL), zwykle "all". */
  defaultValue: string;
}

export interface ListControlsSpec {
  sortOptions: SortOption[];
  defaultSort: string;
  filterGroups: FilterGroup[];
  searchable: boolean;
}

export interface ListControlsState {
  sort: string;
  /** param -> zwalidowana wartość (zawsze ustawiona, choćby domyślna). */
  filters: Record<string, string>;
  /** Przycięte zapytanie; "" gdy brak lub lista !searchable. */
  q: string;
}

/** Parsuje i waliduje stan kontrolek z URLSearchParams. Nie ufa wejściu. */
export function parseListControls(sp: URLSearchParams, spec: ListControlsSpec): ListControlsState {
  const rawSort = sp.get("sort");
  const sort =
    rawSort !== null && spec.sortOptions.some((o) => o.key === rawSort)
      ? rawSort
      : spec.defaultSort;

  const filters: Record<string, string> = {};
  for (const g of spec.filterGroups) {
    const raw = sp.get(g.param);
    filters[g.param] =
      raw !== null && g.options.some((o) => o.value === raw) ? raw : g.defaultValue;
  }

  const q = spec.searchable ? (sp.get("q") ?? "").trim() : "";

  return { sort, filters, q };
}

/**
 * Buduje querystring z `current`, nadpisując/usuwając podane parametry i ZAWSZE
 * resetując `page`. Pusty/`null` => parametr usunięty. Zwraca wartość gotową
 * dla <Link to>: "?a=b" albo "." gdy querystring pusty.
 */
export function buildControlHref(
  current: URLSearchParams,
  changes: Record<string, string | null>,
): string {
  const params = new URLSearchParams(current);
  for (const [k, v] of Object.entries(changes)) {
    if (v === null || v === "") params.delete(k);
    else params.set(k, v);
  }
  params.delete("page");
  const qs = params.toString();
  return qs.length > 0 ? `?${qs}` : ".";
}

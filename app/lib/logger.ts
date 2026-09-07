export type LogLevel = "info" | "warn" | "error";

/**
 * Bezpieczne metadane błędu do logów: TYLKO `name` + `code`/`status`. NIGDY `message`
 * ani całego obiektu — SDK (np. Google) potrafią umieścić w message fragmenty żądania
 * (Bearer/refresh token).
 */
export function errorMeta(err: unknown): { name?: string; code?: string | number } {
  if (!(err instanceof Error)) return {};
  const out: { name?: string; code?: string | number } = { name: err.name };
  const raw = (err as { code?: unknown }).code ?? (err as { status?: unknown }).status;
  if (typeof raw === "string" || typeof raw === "number") out.code = raw;
  return out;
}

/**
 * Zamienia wartości będące Error na errorMeta — sieć bezpieczeństwa przed wyciekiem message.
 * UWAGA: redakcja jest PŁYTKA — tylko wartości bezpośrednie w ctx. Zagnieżdżony Error
 * (np. `{ result: { cause: err } }`) NIE jest redagowany i jego `message` przeciekłby.
 * Przekazuj błędy jako `...errorMeta(err)`, nie surowe obiekty SDK.
 */
function redactCtx(ctx: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(ctx)) {
    out[k] = v instanceof Error ? errorMeta(v) : v;
  }
  return out;
}

/** Czysta funkcja: linia JSON `{ts, level, event, ...redactedCtx}`. */
export function formatLogLine(
  level: LogLevel,
  event: string,
  ctx: Record<string, unknown>,
  ts: string,
): string {
  return JSON.stringify({ ts, level, event, ...redactCtx(ctx) });
}

function emit(level: LogLevel, event: string, ctx?: Record<string, unknown>): void {
  try {
    const line = formatLogLine(level, event, ctx ?? {}, new Date().toISOString());
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.info(line);
  } catch {
    // Logger NIGDY nie rzuca — fallback bez formatowania.
    console.error("[logger] format failed", event);
  }
}

export const logger = {
  info(event: string, ctx?: Record<string, unknown>): void {
    emit("info", event, ctx);
  },
  warn(event: string, ctx?: Record<string, unknown>): void {
    emit("warn", event, ctx);
  },
  error(event: string, ctx?: Record<string, unknown>): void {
    emit("error", event, ctx);
  },
};

/**
 * Logika hooka `handleError` RR7 (wydzielona, by testy nie importowały entry.server).
 * Pomija żądania anulowane przez RR7. Loguje method+path+errorMeta jako `unhandled`.
 */
export function logUnhandled(error: unknown, request: Request): void {
  if (request.signal.aborted) return;
  let path: string;
  try {
    path = new URL(request.url).pathname;
  } catch {
    path = request.url;
  }
  logger.error("unhandled", { method: request.method, path, ...errorMeta(error) });
}

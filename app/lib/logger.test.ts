import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { errorMeta, formatLogLine, logUnhandled, logger } from "~/lib/logger";

/** Pierwszy argument pierwszego wywołania zmockowanego `console.*` jako string. */
function firstCallLine(fn: typeof console.error): string {
  const calls = (fn as unknown as { mock: { calls: unknown[][] } }).mock.calls;
  return String(calls[0]?.[0]);
}

describe("errorMeta", () => {
  it("z Error zwraca name", () => {
    expect(errorMeta(new Error("boom"))).toEqual({ name: "Error" });
  });
  it("dołącza code (string)", () => {
    const e = Object.assign(new Error("x"), { code: "resource_missing" });
    expect(errorMeta(e)).toEqual({ name: "Error", code: "resource_missing" });
  });
  it("dołącza status jako code gdy brak code (number)", () => {
    const e = Object.assign(new Error("x"), { status: 500 });
    expect(errorMeta(e)).toEqual({ name: "Error", code: 500 });
  });
  it("NIGDY nie zwraca message", () => {
    const meta = errorMeta(new Error("Bearer super-secret-token"));
    expect(JSON.stringify(meta)).not.toContain("Bearer");
    expect("message" in meta).toBe(false);
  });
  it("nie-Error → puste, bez rzucania", () => {
    expect(errorMeta(null)).toEqual({});
    expect(errorMeta("oops")).toEqual({});
    expect(errorMeta(undefined)).toEqual({});
  });
});

describe("formatLogLine", () => {
  it("zwraca poprawny JSON z ts/level/event", () => {
    const line = formatLogLine("error", "x.failed", {}, "2026-06-06T00:00:00.000Z");
    const obj = JSON.parse(line);
    expect(obj).toEqual({ ts: "2026-06-06T00:00:00.000Z", level: "error", event: "x.failed" });
  });
  it("scala ctx", () => {
    const obj = JSON.parse(formatLogLine("info", "e", { a: 1, b: "z" }, "T"));
    expect(obj).toMatchObject({ level: "info", event: "e", a: 1, b: "z" });
  });
  it("auto-redaguje wartości Error w ctx (bez message)", () => {
    const line = formatLogLine("error", "e", { err: new Error("Bearer leak") }, "T");
    expect(line).not.toContain("Bearer");
    const obj = JSON.parse(line);
    expect(obj.err).toEqual({ name: "Error" });
  });
});

describe("logger", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "info").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("logger.error pisze przez console.error jedną linią JSON", () => {
    logger.error("pay.failed", { op: "cancel" });
    expect(console.error).toHaveBeenCalledTimes(1);
    const line = firstCallLine(console.error);
    const obj = JSON.parse(line);
    expect(obj).toMatchObject({ level: "error", event: "pay.failed", op: "cancel" });
    expect(typeof obj.ts).toBe("string");
  });

  it("logger.warn/info trafiają na właściwe strumienie", () => {
    logger.warn("w.evt");
    logger.info("i.evt");
    expect(console.warn).toHaveBeenCalledTimes(1);
    expect(console.info).toHaveBeenCalledTimes(1);
  });

  it("nigdy nie rzuca przy niedeserializowalnym ctx (fallback)", () => {
    // BigInt nie ma reprezentacji w JSON → JSON.stringify rzuca → emit łapie i robi fallback.
    expect(() => logger.error("bad.ctx", { big: 1n })).not.toThrow();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(console.error).toHaveBeenCalledWith("[logger] format failed", "bad.ctx");
  });
});

describe("logUnhandled", () => {
  beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
  afterEach(() => vi.restoreAllMocks());

  function req(aborted: boolean): Request {
    const c = new AbortController();
    if (aborted) c.abort();
    return new Request("http://localhost/trener/podopieczni", {
      method: "POST",
      signal: c.signal,
    });
  }

  it("pomija żądania anulowane", () => {
    logUnhandled(new Error("x"), req(true));
    expect(console.error).not.toHaveBeenCalled();
  });

  it("loguje nieobsłużony błąd z method+path", () => {
    logUnhandled(new Error("x"), req(false));
    expect(console.error).toHaveBeenCalledTimes(1);
    const obj = JSON.parse(firstCallLine(console.error));
    expect(obj).toMatchObject({
      level: "error",
      event: "unhandled",
      method: "POST",
      path: "/trener/podopieczni",
      name: "Error",
    });
  });
});

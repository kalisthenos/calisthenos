import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { type Browser, chromium, devices } from "@playwright/test";
import { type Role, parseShotArgs, selectTargets, slugForPath } from "./shots-lib";
import { manifest } from "./shots.manifest";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:3000";
const OUT_DIR = "screenshots";
const AUTH_FILE = path.join(OUT_DIR, ".auth", "trainer.json");
const ROLE: Role = "trainer"; // MVP: logujemy tylko trenera.

const VIEWPORTS = [
  { name: "desktop", options: { viewport: { width: 1440, height: 900 } } },
  { name: "mobile", options: devices["Pixel 7"] },
] as const;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(
      `[shots] Brak zmiennej środowiskowej ${name}. Ustaw ją w .env (te same, co db:seed).`,
    );
    process.exit(1);
  }
  return value;
}

async function ensureServer(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/login`, { method: "HEAD" });
  } catch {
    console.error(
      `[shots] Dev server nie odpowiada na ${BASE_URL}.\n[shots] Uruchom 'npm run dev' i upewnij się, że Postgres działa.`,
    );
    process.exit(1);
  }
}

async function login(browser: Browser, email: string, password: string): Promise<void> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await Promise.all([
    page.waitForURL((url) => !url.pathname.endsWith("/login"), { timeout: 15_000 }),
    page.click('button[type="submit"]'),
  ]);
  await mkdir(path.dirname(AUTH_FILE), { recursive: true });
  await context.storageState({ path: AUTH_FILE });
  await context.close();
  console.log("[shots] Zalogowano i zapisano sesję.");
}

async function capture(browser: Browser, targetPath: string): Promise<string[]> {
  const written: string[] = [];
  for (const vp of VIEWPORTS) {
    const context = await browser.newContext({ ...vp.options, storageState: AUTH_FILE });
    const page = await context.newPage();
    const response = await page.goto(`${BASE_URL}${targetPath}`, { waitUntil: "networkidle" });

    if (new URL(page.url()).pathname.endsWith("/login")) {
      console.warn(
        `[shots] ${targetPath}: sesja wygasła — przeloguj (skasuj ${AUTH_FILE} i uruchom ponownie).`,
      );
      await context.close();
      continue;
    }
    const status = response?.status() ?? 0;
    if (status >= 400) {
      console.warn(
        `[shots] ${targetPath}: serwer zwrócił ${status} — zrzut może być stroną błędu.`,
      );
    }

    const file = path.join(OUT_DIR, `${slugForPath(targetPath)}__${vp.name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    written.push(file);
    await context.close();
  }
  return written;
}

async function main(): Promise<void> {
  await ensureServer();

  const paths = parseShotArgs(process.argv.slice(2));
  const { targets, skipped } = selectTargets({ manifest, paths, role: ROLE });

  if (targets.length === 0) {
    console.error("[shots] Brak tras do zrzutu dla roli 'trainer'. Sprawdź argumenty/manifest.");
    process.exit(1);
  }
  for (const s of skipped) {
    console.warn(`[shots] Pomijam ${s.path} (rola ${s.role} — wymaga zaproszonego podopiecznego).`);
  }

  // Jeśli trzeba się zalogować, sprawdź dane PRZED odpaleniem przeglądarki
  // (fail-fast, bez wycieku procesu chromium przy braku env).
  const needLogin = !existsSync(AUTH_FILE);
  const email = needLogin ? requireEnv("SEED_TRAINER_EMAIL") : "";
  const password = needLogin ? requireEnv("SEED_TRAINER_PASSWORD") : "";

  const browser = await chromium.launch();
  try {
    if (needLogin) {
      await login(browser, email, password);
    }
    const written: string[] = [];
    for (const t of targets) {
      written.push(...(await capture(browser, t.path)));
    }
    console.log(`\n[shots] Zapisano ${written.length} zrzutów:`);
    for (const f of written) console.log(`  ${f}`);
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("[shots] błąd:", err);
  process.exit(1);
});

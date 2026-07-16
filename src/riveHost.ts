// Headless Chromium 上で公式 Rive ランタイムをホストする。
// ブラウザ/ページはプロセス内で1度だけ起動しキャッシュする。
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright-core";

const ASSETS_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), "assets");
const ORIGIN = "http://rive-mcp.local";

export interface InspectResult {
  artboardCount: number;
  artboards: Array<{
    name: string;
    width: number;
    height: number;
    animations: Array<{
      name: string;
      durationFrames: number;
      durationSeconds: number | null;
      fps: number;
      speed: number;
      loop: string;
    }>;
    stateMachines: Array<{
      name: string;
      inputs: Array<{ name: string; type: string; value: boolean | number | null }>;
    }>;
  }>;
}

export interface RenderResult {
  width: number;
  height: number;
  frames: string[]; // base64 (png or rgba)
  states: Array<{ frame: number; states: string[] }>;
}

export interface PlayResult {
  width: number;
  height: number;
  report: Array<Record<string, unknown>>;
  frames: string[]; // base64 png
}

function findPlaywrightChromium(): string | null {
  const roots = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "ms-playwright"),
    process.env.HOME && join(process.env.HOME, ".cache", "ms-playwright"),
    process.env.HOME && join(process.env.HOME, "Library", "Caches", "ms-playwright"),
  ].filter(Boolean) as string[];

  for (const root of roots) {
    if (!existsSync(root)) continue;
    const revs = readdirSync(root)
      .filter((d) => /^chromium-\d+$/.test(d))
      .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
    for (const rev of revs) {
      for (const sub of ["chrome-win", "chrome-win64", "chrome-linux", "chrome-mac"]) {
        for (const exe of ["chrome.exe", "chrome", "Chromium.app/Contents/MacOS/Chromium"]) {
          const p = join(root, rev, sub, exe);
          if (existsSync(p)) return p;
        }
      }
    }
  }
  return null;
}

async function launchBrowser(): Promise<Browser> {
  const attempts: Array<() => Promise<Browser>> = [];
  if (process.env.RIVE_MCP_CHROME) {
    attempts.push(() =>
      chromium.launch({ headless: true, executablePath: process.env.RIVE_MCP_CHROME })
    );
  }
  const found = findPlaywrightChromium();
  if (found) {
    attempts.push(() => chromium.launch({ headless: true, executablePath: found }));
  }
  attempts.push(() => chromium.launch({ headless: true, channel: "chrome" }));
  attempts.push(() => chromium.launch({ headless: true, channel: "msedge" }));

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      return await attempt();
    } catch (e) {
      errors.push(String(e));
    }
  }
  throw new Error(
    "No Chromium-based browser found. Set RIVE_MCP_CHROME to a Chrome/Edge executable path.\n" +
      errors.join("\n")
  );
}

export class RiveHost {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private starting: Promise<Page> | null = null;
  private pageScript: string;

  constructor(pageScript: string) {
    this.pageScript = pageScript;
  }

  private async startPage(): Promise<Page> {
    const runtimeJs = readFileSync(join(ASSETS_DIR, "canvas_advanced.mjs"), "utf8");
    const wasm = readFileSync(join(ASSETS_DIR, "rive.wasm"));
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body><script type="module">${this.pageScript}</script></body></html>`;

    this.browser = await launchBrowser();
    const context = await this.browser.newContext();
    await context.route(`${ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url());
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return route.fulfill({ contentType: "text/html", body: html });
      }
      if (url.pathname === "/canvas_advanced.mjs") {
        return route.fulfill({ contentType: "text/javascript", body: runtimeJs });
      }
      if (url.pathname.endsWith(".wasm")) {
        return route.fulfill({ contentType: "application/wasm", body: wasm });
      }
      return route.fulfill({ status: 404, body: "not found" });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(60_000);
    page.on("pageerror", (err) => console.error("[rive-mcp page error]", err.message));
    await page.goto(`${ORIGIN}/`);
    await page.waitForFunction("window.__riveReady === true", null, { timeout: 30_000 });
    this.page = page;
    return page;
  }

  async getPage(): Promise<Page> {
    if (this.page && !this.page.isClosed()) return this.page;
    if (!this.starting) {
      this.starting = this.startPage().finally(() => {
        this.starting = null;
      });
    }
    return this.starting;
  }

  private async call<T>(method: string, b64: string, opts: unknown): Promise<T> {
    const page = await this.getPage();
    return page.evaluate(
      async ([m, data, o]) => {
        const api = (window as unknown as { riveApi: Record<string, Function> }).riveApi;
        return api[m as string](data, o);
      },
      [method, b64, opts] as const
    ) as Promise<T>;
  }

  inspect(rivBytes: Buffer): Promise<InspectResult> {
    return this.call<InspectResult>("inspect", rivBytes.toString("base64"), undefined);
  }

  renderFrames(rivBytes: Buffer, opts: Record<string, unknown>): Promise<RenderResult> {
    return this.call<RenderResult>("renderFrames", rivBytes.toString("base64"), opts);
  }

  playStateMachine(rivBytes: Buffer, opts: Record<string, unknown>): Promise<PlayResult> {
    return this.call<PlayResult>("playStateMachine", rivBytes.toString("base64"), opts);
  }

  sliceImage(
    pngBytes: Buffer,
    regions: Array<{ name: string; polygon: Array<[number, number]>; keepInBase?: boolean }>
  ): Promise<{
    width: number;
    height: number;
    parts: Array<{ name: string; x: number; y: number; width: number; height: number; png: string }>;
    base: string;
  }> {
    return this.call("sliceImage", pngBytes.toString("base64"), { regions });
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
    }
  }
}

// rive-mcp Studio: ローカルWebプレビュー/編集サーバー（公式Rive Editor風 3ペイン構成）
// - 左: 階層ツリー / 中央: ステージ+タイムライン / 右: インスペクタ
// - 公式高レベルランタイムでライブプレビュー（リスナー/ポインタ操作もそのまま動く）
// - .riv / シーンJSON のファイル監視 → SSE でホットリロード
// - シーンJSONモード: クリック選択・ドラッグ移動・インスペクタ編集 → 自動再ビルド
// - rivのみモード: /tree で構造展開、/edit（editRiv）で生プロパティ編集
// - 「AIへの指示」ボックス: UIから指示を積む → MCPツール riv_studio_notes で取得
import { createServer, type Server } from "node:http";
import { readFileSync, writeFileSync, existsSync, watch, type FSWatcher } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createRiv, pngSize, type SceneSpec } from "./rivWriter.js";
import { readRiv, propInfo } from "./rivBinary.js";
import { editRiv, type EditOp } from "./rivEdit.js";

const ASSETS_DIR = join(dirname(dirname(fileURLToPath(import.meta.url))), "assets");

export interface StudioOptions {
  rivPath: string;
  scenePath?: string; // シーンJSON（あれば編集→再ビルドUIが有効化）
  port?: number;
}

export interface StudioHandle {
  url: string;
  port: number;
  close: () => void;
}

export interface StudioNote {
  text: string;
  time: string; // ISO
}

// シーンJSON内の pngPath / fonts[].path を bytes に解決（シーンファイルの場所基準）
export function resolveSceneAssets(spec: SceneSpec, baseDir: string): void {
  const imageLists = [spec.images ?? [], ...(spec.artboards ?? []).map((a) => a.images ?? [])];
  for (const img of imageLists.flat()) {
    if (!img.bytes && img.pngPath) {
      const p = resolve(baseDir, img.pngPath);
      if (!existsSync(p)) throw new Error(`Image file not found: ${p}`);
      img.bytes = new Uint8Array(readFileSync(p));
    }
  }
  for (const font of spec.fonts ?? []) {
    if (!font.bytes) {
      const p = font.path ? resolve(baseDir, font.path) : join(ASSETS_DIR, "inter.ttf");
      if (!existsSync(p)) throw new Error(`Font file not found: ${p}`);
      font.bytes = new Uint8Array(readFileSync(p));
    }
  }
}

// /tree: .riv を構造ツリーに変換（rivのみモードの階層/インスペクタ用）
// アートボード内ローカルindex（parentId の参照先）はブロック内の全オブジェクトで数える
const TREE_SKIP =
  /^(Keyed|KeyFrame|Cubic|LinearAnimation|StateMachine|AnimationState|EntryState|AnyState|ExitState|StateTransition|Transition|Blend|Listener|Backboard|FileAsset|ImageAsset|FontAsset|FileAssetContents|MeshVertex|Weight|Tendon|CustomProperty)/;

function buildTreeJson(bytes: Uint8Array): unknown {
  const dump = readRiv(bytes, { tolerant: true });
  const artboards: Array<Record<string, unknown>> = [];
  let ab: Record<string, unknown> | null = null;
  let localIndex = 0;
  for (const o of dump.objects) {
    if (o.typeName === "Artboard") {
      ab = {
        name: o.properties.name ?? `Artboard ${artboards.length}`,
        width: o.properties.width ?? 500,
        height: o.properties.height ?? 500,
        index: o.index,
        nodes: [] as unknown[],
      };
      artboards.push(ab);
      localIndex = 0;
      continue;
    }
    if (!ab) continue;
    localIndex++;
    if (TREE_SKIP.test(o.typeName)) continue;
    // raw プロパティから編集可能な値と型を抽出
    const props: Array<{ name: string; value: unknown; kind: string }> = [];
    for (const rp of o.raw) {
      const info = propInfo(rp.key);
      if (!info) continue;
      let kind = "number";
      let value = rp.value;
      const dt = info.type.toLowerCase();
      if (dt === "color") {
        kind = "color";
        const v = Number(rp.value) >>> 0;
        value = "#" + [(v >> 16) & 255, (v >> 8) & 255, v & 255].map((x) => x.toString(16).padStart(2, "0")).join("");
      } else if (dt === "string") kind = "string";
      else if (dt === "bool") kind = "bool";
      else if (dt === "bytes") continue;
      props.push({ name: info.name, value, kind });
    }
    (ab.nodes as unknown[]).push({
      index: o.index, // グローバルindex（/edit の対象指定に使う）
      local: localIndex,
      type: o.typeName,
      name: o.properties.name ?? null,
      parentId: o.properties.parentId ?? null,
      props,
    });
  }
  return { artboards };
}

let current: {
  server: Server;
  watchers: FSWatcher[];
  port: number;
  notes: StudioNote[];
  notify: (msg: string) => void;
} | null = null;

export function stopStudio(): void {
  if (current) {
    for (const w of current.watchers) w.close();
    current.server.close();
    current = null;
  }
}

// 同一プロセス内のスタジオから未取得の指示を取り出す（MCPツール用フォールバック）
export function takeStudioNotes(): StudioNote[] | null {
  if (!current) return null;
  const out = current.notes.splice(0, current.notes.length);
  if (out.length) current.notify("notes-taken");
  return out;
}

export function startStudio(opts: StudioOptions): StudioHandle {
  stopStudio();
  const rivPath = resolve(opts.rivPath);
  const scenePath = opts.scenePath ? resolve(opts.scenePath) : undefined;
  const port = opts.port ?? 8787;
  const sseClients = new Set<import("node:http").ServerResponse>();
  const notes: StudioNote[] = [];

  const notify = (msg = "reload") => {
    for (const res of sseClients) res.write(`data: ${msg}\n\n`);
  };

  const watchers: FSWatcher[] = [];
  let debounce: ReturnType<typeof setTimeout> | null = null;
  let suppressWatch = 0; // /edit・/rebuild 直後の二重リロード抑止
  const watchFile = (p: string) => {
    if (!existsSync(p)) return;
    try {
      const w = watch(p, () => {
        if (Date.now() < suppressWatch) return;
        if (debounce) clearTimeout(debounce);
        debounce = setTimeout(() => notify(), 150);
      });
      watchers.push(w);
    } catch {
      /* watch非対応環境は手動リロード */
    }
  };
  watchFile(rivPath);
  if (scenePath) watchFile(scenePath);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${port}`);
    const send = (status: number, type: string, body: string | Uint8Array) => {
      res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
      res.end(body);
    };
    const readBody = (cb: (body: string) => void) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => cb(body));
    };
    try {
      if (url.pathname === "/") {
        return send(200, "text/html; charset=utf-8", STUDIO_HTML);
      }
      if (url.pathname === "/rive.js") {
        return send(200, "text/javascript", readFileSync(join(ASSETS_DIR, "rive-canvas.js")));
      }
      if (url.pathname === "/rive.wasm") {
        return send(200, "application/wasm", readFileSync(join(ASSETS_DIR, "rive-canvas.wasm")));
      }
      if (url.pathname === "/file.riv") {
        if (!existsSync(rivPath)) return send(404, "text/plain", "riv not found yet");
        return send(200, "application/octet-stream", readFileSync(rivPath));
      }
      if (url.pathname === "/state") {
        const state: Record<string, unknown> = {
          rivPath,
          rivName: basename(rivPath),
          scenePath: scenePath ?? null,
          pendingNotes: notes.length,
        };
        if (existsSync(rivPath)) {
          const bytes = readFileSync(rivPath);
          const d = readRiv(new Uint8Array(bytes), { tolerant: true });
          state.objects = d.objects.length;
          state.version = `${d.major}.${d.minor}`;
          state.bytes = bytes.length;
        }
        if (scenePath && existsSync(scenePath)) {
          const spec = JSON.parse(readFileSync(scenePath, "utf8")) as SceneSpec;
          state.scene = spec;
          // 画像の natural size（クリック選択・選択枠のbbox計算用）
          const sizes: Record<string, { width: number; height: number }> = {};
          const lists = [spec.images ?? [], ...(spec.artboards ?? []).map((a) => a.images ?? [])];
          for (const img of lists.flat()) {
            try {
              if (img.pngPath) {
                const p = resolve(dirname(scenePath), img.pngPath);
                if (existsSync(p)) sizes[img.id] = pngSize(new Uint8Array(readFileSync(p)));
              }
            } catch {
              /* サイズ不明はUI側で概算 */
            }
          }
          state.imageSizes = sizes;
        }
        return send(200, "application/json; charset=utf-8", JSON.stringify(state));
      }
      if (url.pathname === "/tree") {
        if (!existsSync(rivPath)) return send(404, "application/json; charset=utf-8", JSON.stringify({ artboards: [] }));
        return send(200, "application/json; charset=utf-8", JSON.stringify(buildTreeJson(new Uint8Array(readFileSync(rivPath)))));
      }
      if (url.pathname === "/events") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-store",
          Connection: "keep-alive",
        });
        res.write("data: connected\n\n");
        sseClients.add(res);
        req.on("close", () => sseClients.delete(res));
        return;
      }
      // AIへの指示: UIがPOST→積む / MCPツールがGET(consume=1)→取得して消化
      if (url.pathname === "/notes") {
        if (req.method === "POST") {
          readBody((body) => {
            try {
              const { text } = JSON.parse(body) as { text?: string };
              if (typeof text === "string" && text.trim()) {
                notes.push({ text: text.trim(), time: new Date().toISOString() });
              }
              send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, pending: notes.length }));
            } catch (e) {
              send(400, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: String(e) }));
            }
          });
          return;
        }
        const consume = url.searchParams.get("consume") === "1";
        const out = consume ? notes.splice(0, notes.length) : [...notes];
        if (consume && out.length) notify("notes-taken");
        return send(200, "application/json; charset=utf-8", JSON.stringify({ notes: out, pending: notes.length }));
      }
      // rivのみモードの直接編集（editRiv の set をそのまま通す）
      if (url.pathname === "/edit" && req.method === "POST") {
        readBody((body) => {
          try {
            const edits = JSON.parse(body) as EditOp[];
            const { bytes, log } = editRiv(new Uint8Array(readFileSync(rivPath)), edits);
            suppressWatch = Date.now() + 400;
            writeFileSync(rivPath, bytes);
            send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, log }));
            notify();
          } catch (e) {
            send(400, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        });
        return;
      }
      if (url.pathname === "/rebuild" && req.method === "POST") {
        readBody((body) => {
          try {
            const spec = JSON.parse(body) as SceneSpec;
            resolveSceneAssets(spec, scenePath ? dirname(scenePath) : dirname(rivPath));
            const { bytes, warnings } = createRiv(spec);
            suppressWatch = Date.now() + 400;
            writeFileSync(rivPath, bytes);
            if (scenePath) writeFileSync(scenePath, body);
            send(200, "application/json; charset=utf-8", JSON.stringify({ ok: true, bytes: bytes.length, warnings }));
            notify();
          } catch (e) {
            send(400, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        });
        return;
      }
      send(404, "text/plain", "not found");
    } catch (e) {
      send(500, "text/plain", e instanceof Error ? e.message : String(e));
    }
  });
  server.listen(port);
  current = { server, watchers, port, notes, notify };
  return { url: `http://localhost:${port}/`, port, close: stopStudio };
}

// ---- スタジオUI（自己完結・ダークテーマ・日英対応・3ペイン） ----------------
const STUDIO_HTML = /* html */ `<!DOCTYPE html>
<html lang="ja"><head>
<meta charset="utf-8"><title>rive-mcp Studio</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root { --bg:#14161f; --panel:#1c1f2b; --line:#2a2e3f; --fg:#e8eaf2; --dim:#8b90a5; --acc:#e94560; --acc2:#00d9ff; --sel:#20344a; }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:13px/1.5 system-ui, "Segoe UI", sans-serif; display:flex; height:100vh; overflow:hidden; }
  #left { width:250px; min-width:210px; background:var(--panel); border-right:1px solid var(--line); display:flex; flex-direction:column; }
  #right { width:300px; min-width:260px; background:var(--panel); border-left:1px solid var(--line); padding:12px; overflow-y:auto; }
  #center { flex:1; display:flex; flex-direction:column; min-width:0; }
  #left, #right { flex-shrink:0; }
  #stage { flex:1; min-width:0; min-height:0; display:flex; align-items:center; justify-content:center; background:
    repeating-conic-gradient(#191c27 0 25%, #14161f 0 50%) 0 0/24px 24px; position:relative; overflow:hidden; }
  canvas { max-width:92%; max-height:92%; min-width:0; min-height:0; box-shadow:0 8px 40px #0008; border-radius:8px; background:transparent; }
  #selBox { position:absolute; border:1.5px solid var(--acc2); border-radius:2px; pointer-events:none; display:none;
    box-shadow:0 0 0 1px #0008; }
  #selBox::after { content:''; position:absolute; left:50%; top:50%; width:6px; height:6px; margin:-3px;
    background:var(--acc2); border-radius:50%; }
  h1 { font-size:14px; margin:0; color:var(--acc2); letter-spacing:.5px; white-space:nowrap; }
  h2 { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:var(--dim); margin:14px 0 6px; }
  h2:first-child { margin-top:0; }
  select, input[type=text], input[type=number], textarea { width:100%; background:#12141d; color:var(--fg); border:1px solid var(--line); border-radius:6px; padding:5px 8px; font:inherit; }
  input[type=color] { width:100%; height:28px; background:#12141d; border:1px solid var(--line); border-radius:6px; padding:2px; }
  textarea { font:12px/1.4 Consolas, monospace; resize:vertical; }
  #scene { min-height:140px; }
  #aiText { min-height:60px; font-family:inherit; font-size:13px; }
  button { background:var(--acc); color:#fff; border:0; border-radius:6px; padding:6px 11px; font:inherit; cursor:pointer; margin:2px 4px 2px 0; }
  button.sec { background:#2a2e3f; }
  button.mini { padding:2px 8px; font-size:12px; }
  button:hover { filter:brightness(1.15); }
  button:disabled { opacity:.45; cursor:default; }
  .row { display:flex; align-items:center; gap:7px; margin:5px 0; }
  .row label { flex:1; color:var(--dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .prop { display:grid; grid-template-columns:88px 1fr; align-items:center; gap:6px; margin:4px 0; }
  .prop label { color:var(--dim); font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  input[type=range] { flex:1.4; accent-color:var(--acc2); }
  input[type=checkbox] { accent-color:var(--acc); width:15px; height:15px; }
  #log { font:11px/1.5 Consolas, monospace; color:var(--dim); background:#12141d; border-radius:6px; padding:8px; max-height:110px; overflow-y:auto; white-space:pre-wrap; }
  #toolbar { padding:7px 12px; background:var(--panel); border-top:1px solid var(--line); display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
  #toolbar input[type=range] { flex:1; min-width:110px; }
  .badge { display:inline-block; background:#2a2e3f; border-radius:4px; padding:1px 7px; font-size:11px; color:var(--acc2); }
  .num { width:64px !important; }
  .hint { font-size:12px; color:var(--dim); margin:4px 0; }
  #topbar { display:flex; align-items:center; gap:7px; padding:10px 12px 6px; }
  #topbar .spacer { flex:1; }
  #treeWrap { flex:1; overflow-y:auto; padding:4px 6px 12px; }
  .tnode { padding:2px 6px; border-radius:5px; cursor:pointer; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:12.5px; }
  .tnode:hover { background:#232738; }
  .tnode.on { background:var(--sel); color:#fff; }
  .tnode .ticon { display:inline-block; width:16px; color:var(--acc2); font-size:11px; }
  .tnode .ttype { color:var(--dim); font-size:11px; margin-left:5px; }
  #leftTabs { display:flex; gap:4px; padding:0 10px; }
  #leftTabs button { flex:1; background:#181b28; border-radius:6px 6px 0 0; margin:0; padding:5px 4px; font-size:12px; color:var(--dim); }
  #leftTabs button.on { background:#232738; color:var(--fg); }
  #playPane { display:none; padding:10px 12px; overflow-y:auto; flex:1; }
  #guide { background:#181b28; border:1px solid var(--line); border-radius:8px; padding:9px 11px; margin:8px 10px; font-size:12px; }
  #guide ol { margin:5px 0 2px; padding-left:17px; }
  #guide li { margin:2px 0; }
  #fileinfo { font-size:11.5px; color:var(--dim); word-break:break-all; padding:0 12px 6px; }
  #notesBadge { background:var(--acc); color:#fff; display:none; }
  #timeline { background:var(--panel); border-top:1px solid var(--line); max-height:150px; overflow-y:auto; display:none; }
  .trow { display:grid; grid-template-columns:150px 1fr; align-items:center; border-bottom:1px solid #20222f; }
  .trow .tlabel { font-size:11px; color:var(--dim); padding:3px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tlane { position:relative; height:20px; background:#161925; }
  .tkey { position:absolute; top:50%; width:7px; height:7px; margin:-3.5px 0 0 -3.5px; background:var(--acc2); transform:rotate(45deg); cursor:pointer; }
  .tkey:hover { background:#fff; }
  #tcursor { position:absolute; top:0; bottom:0; width:1px; background:var(--acc); pointer-events:none; }
  #helpWrap { position:fixed; inset:0; background:#000a; display:none; align-items:center; justify-content:center; z-index:10; }
  #helpWrap.open { display:flex; }
  #help { background:var(--panel); border:1px solid var(--line); border-radius:12px; max-width:660px; width:92%; max-height:86vh; overflow-y:auto; padding:22px 26px; }
  #help h3 { color:var(--acc2); margin:0 0 8px; }
  #help h4 { margin:14px 0 4px; }
  #help p, #help li { font-size:13px; color:#c6cadb; }
  #help code { background:#12141d; padding:1px 5px; border-radius:4px; font-size:12px; color:var(--acc2); }
</style></head><body>
<div id="left">
  <div id="topbar">
    <h1>rive-mcp Studio</h1>
    <span class="badge" id="status">…</span>
    <span class="spacer"></span>
    <button class="sec mini" id="langBtn">EN</button>
    <button class="sec mini" id="helpBtn">?</button>
  </div>
  <div id="fileinfo">-</div>
  <div id="guide">
    <b data-i18n="guideTitle"></b>
    <ol>
      <li data-i18n="guide1"></li>
      <li data-i18n="guide2"></li>
      <li data-i18n="guide3"></li>
    </ol>
    <button class="sec mini" id="guideClose" data-i18n="close"></button>
  </div>
  <div id="leftTabs">
    <button id="tabTree" class="on" data-i18n="tabTree"></button>
    <button id="tabPlay" data-i18n="tabPlay"></button>
  </div>
  <div id="treeWrap"></div>
  <div id="playPane">
    <h2 data-i18n="hArtboard"></h2>
    <select id="artboardSel"></select>
    <div style="height:5px"></div>
    <select id="smSel"></select>
    <h2 data-i18n="hInputs"></h2>
    <div id="inputs"><span class="hint">-</span></div>
    <h2 data-i18n="hAnim"></h2>
    <select id="animSel"></select>
    <div class="row">
      <button id="playAnim" data-i18n="play"></button>
      <button id="backSM" class="sec" data-i18n="backSM"></button>
    </div>
  </div>
</div>
<div id="center">
  <div id="stage"><canvas id="cv" width="800" height="600"></canvas><div id="selBox"></div></div>
  <div id="timeline"></div>
  <div id="toolbar">
    <button id="pauseBtn" class="sec mini">⏸</button>
    <span class="hint" data-i18n="scrubL"></span>
    <input type="range" id="scrub" min="0" max="1" step="0.001" value="0" disabled>
    <span id="time" class="badge">0.00s</span>
    <span class="hint" data-i18n="zoomL"></span>
    <input type="range" id="zoom" min="0.25" max="3" step="0.05" value="1" style="max-width:110px">
    <button id="zoomReset" class="sec mini">1:1</button>
    <button id="snap" class="sec mini" data-i18n="snapshot"></button>
  </div>
</div>
<div id="right">
  <h2 data-i18n="hInspector"></h2>
  <div id="inspector"><div class="hint" data-i18n="noSel"></div></div>
  <h2><span data-i18n="hAI"></span> <span class="badge" id="notesBadge">0</span></h2>
  <textarea id="aiText" data-i18n-ph="aiPlaceholder"></textarea>
  <div class="row">
    <button id="aiSend" data-i18n="aiSend"></button>
    <span class="hint" id="aiState"></span>
  </div>
  <div class="hint" data-i18n="aiHint"></div>
  <h2><span data-i18n="hLog"></span> <button class="sec mini" id="logClear" data-i18n="clear" style="float:right"></button></h2>
  <div id="log"></div>
  <h2 data-i18n="hScene"></h2>
  <textarea id="scene" spellcheck="false" data-i18n-ph="scenePlaceholder"></textarea>
  <div class="row">
    <button id="apply" data-i18n="rebuild"></button>
    <button id="fmt" class="sec mini" data-i18n="format"></button>
  </div>
</div>
<div id="helpWrap"><div id="help">
  <h3 data-i18n="helpTitle"></h3>
  <p data-i18n="helpIntro"></p>
  <h4 data-i18n="helpFlowT"></h4>
  <ul>
    <li data-i18n="helpFlow1"></li>
    <li data-i18n="helpFlow2"></li>
    <li data-i18n="helpFlow3"></li>
    <li data-i18n="helpFlow4"></li>
  </ul>
  <h4 data-i18n="helpPanelT"></h4>
  <ul>
    <li data-i18n="helpP1"></li>
    <li data-i18n="helpP2"></li>
    <li data-i18n="helpP3"></li>
    <li data-i18n="helpP4"></li>
    <li data-i18n="helpP5"></li>
    <li data-i18n="helpP6"></li>
  </ul>
  <p style="text-align:right"><button id="helpClose" data-i18n="close"></button></p>
</div></div>
<script src="/rive.js"></script>
<script>
// ---- i18n ----------------------------------------------------------------
const I18N = {
  ja: {
    guideTitle: 'はじめての方へ — 3ステップ',
    guide1: 'Claude に「〇〇の .riv を作って riv_studio で開いて」と頼む（もう開けています）',
    guide2: 'キャンバスのオブジェクトをクリック/ドラッグ、右のインスペクタで数値・色を微調整',
    guide3: '大きな修正は右の「AIへの指示」に書いて送信 → Claude に「スタジオの指示を見て」',
    close: '閉じる', clear: 'クリア',
    tabTree: '階層', tabPlay: '再生 / SM',
    hArtboard: 'アートボード / ステートマシン', hInputs: 'SM 入力',
    hAnim: 'アニメーション（単体再生）', hAI: 'AIへの指示', hLog: 'イベントログ',
    hScene: 'シーンJSON（上級者向け）', hInspector: 'インスペクタ',
    noSel: '未選択 — 左の階層かキャンバスのオブジェクトをクリックすると、ここで位置・サイズ・色などを直接編集できます',
    play: '▶ 再生', backSM: 'SMに戻す', rebuild: '⟳ 再ビルド', format: '整形',
    aiSend: 'AIに送る', aiPlaceholder: '例: しっぽの振りをもっと大きく、まばたきを2秒間隔に',
    aiHint: '送った指示はMCP接続中のAI（Claude）が riv_studio_notes ツールで受け取ります。チャットで「スタジオの指示を確認して」と伝えてください。',
    scenePlaceholder: 'riv_studio に scenePath を渡すとここで編集できます',
    scrubL: 'シーク', zoomL: 'ズーム', snapshot: 'PNG保存',
    noInputs: '入力なし — riv_create で stateMachine.inputs を定義するとここに操作パネルが出ます',
    animOnly: 'アニメ単体再生中', fire: '発火',
    helpTitle: 'rive-mcp Studio の使い方',
    helpIntro: 'AI（Claude等のMCPクライアント）が作った .riv を、人間がその場で確認・直接編集・修正指示するための画面です。ファイルが更新されると自動で再読み込みされます。',
    helpFlowT: '基本の流れ',
    helpFlow1: 'AIに作らせる: チャットで「ボールが跳ねるrivを作って riv_studio で開いて」など',
    helpFlow2: '直接さわる: キャンバスでクリック選択・ドラッグ移動、インスペクタで数値/色を変更（即反映）',
    helpFlow3: 'AIに頼む: 大きな変更は「AIへの指示」に書いて送信 → チャットで「スタジオの指示を確認して」',
    helpFlow4: 'AIが riv_edit / riv_create で修正すると、この画面は即座に更新されます',
    helpPanelT: '各パネル',
    helpP1: '階層: シーンのオブジェクトツリー。クリックで選択（公式エディタのHierarchy相当）',
    helpP2: 'インスペクタ: 選択オブジェクトの位置・サイズ・回転・不透明度・色・テキストを直接編集',
    helpP3: '再生/SM: ステートマシン入力（trigger/bool/number）の操作とアニメ単体再生',
    helpP4: 'タイムライン: アニメ再生中に表示。◆=キーフレーム、クリックでその時刻へジャンプ',
    helpP5: 'シーンJSON: riv_create 仕様を直接編集して再ビルド（scenePath 指定時）',
    helpP6: 'ツールバー: 一時停止 / シーク / ズーム / 表示中フレームのPNG保存',
    paused: '一時停止', resumed: '再開',
    notesSent: '指示を送信しました', notesTaken: 'AIが指示を受け取りました',
    fileUpdated: 'ファイル更新 → リロード', jsonError: 'JSONエラー: ',
    rebuildOk: '再ビルド成功', rebuildNg: '再ビルド失敗: ', warn: ' 警告: ',
    editOk: '編集を適用', editNg: '編集失敗: ',
    rivOnlyHint: '（rivを直接編集中 — 生プロパティ）',
    artboardSel: 'アートボード',
  },
  en: {
    guideTitle: 'New here? 3 steps',
    guide1: 'Ask Claude: "create a .riv of ... and open it with riv_studio" (already open)',
    guide2: 'Click / drag objects on the canvas, fine-tune numbers & colors in the Inspector',
    guide3: 'For bigger changes, write into "Instructions for AI" and tell Claude "check the studio notes"',
    close: 'Close', clear: 'Clear',
    tabTree: 'Hierarchy', tabPlay: 'Play / SM',
    hArtboard: 'Artboard / State Machine', hInputs: 'SM Inputs',
    hAnim: 'Animation (solo play)', hAI: 'Instructions for AI', hLog: 'Event Log',
    hScene: 'Scene JSON (advanced)', hInspector: 'Inspector',
    noSel: 'Nothing selected — click an object in the hierarchy or on the canvas to edit position, size, colors here',
    play: '▶ Play', backSM: 'Back to SM', rebuild: '⟳ Rebuild', format: 'Format',
    aiSend: 'Send to AI', aiPlaceholder: 'e.g. bigger tail wag, blink every 2 seconds',
    aiHint: 'The connected AI (Claude) picks these up via the riv_studio_notes tool. Just say "check the studio notes" in chat.',
    scenePlaceholder: 'Pass scenePath to riv_studio to edit the scene here',
    scrubL: 'Seek', zoomL: 'Zoom', snapshot: 'Save PNG',
    noInputs: 'No inputs — define stateMachine.inputs in riv_create to get controls here',
    animOnly: 'Playing a single animation', fire: 'Fire',
    helpTitle: 'How to use rive-mcp Studio',
    helpIntro: 'Inspect, directly edit, and request fixes to .riv animations built by an AI (an MCP client such as Claude). The page hot-reloads whenever the file changes.',
    helpFlowT: 'Basic workflow',
    helpFlow1: 'Let the AI build: "create a bouncing-ball riv and open it with riv_studio"',
    helpFlow2: 'Touch it: click-select and drag objects on the canvas; edit numbers/colors in the Inspector (applies live)',
    helpFlow3: 'Ask the AI: for bigger changes, use "Instructions for AI", then say "check the studio notes" in chat',
    helpFlow4: 'When the AI edits via riv_edit / riv_create, this page updates instantly',
    helpPanelT: 'Panels',
    helpP1: 'Hierarchy: the scene object tree; click to select (like the official editor)',
    helpP2: 'Inspector: edit position, size, rotation, opacity, colors, text of the selection',
    helpP3: 'Play / SM: drive state machine inputs (trigger/bool/number) and solo-play animations',
    helpP4: 'Timeline: shown while solo-playing. ◆ = keyframe, click to jump to that time',
    helpP5: 'Scene JSON: edit the riv_create spec directly and rebuild (needs scenePath)',
    helpP6: 'Toolbar: pause / seek / zoom / save the current frame as PNG',
    paused: 'Paused', resumed: 'Resumed',
    notesSent: 'Instruction queued', notesTaken: 'AI picked up the instructions',
    fileUpdated: 'File changed → reloading', jsonError: 'JSON error: ',
    rebuildOk: 'Rebuild OK', rebuildNg: 'Rebuild failed: ', warn: ' warnings: ',
    editOk: 'Edit applied', editNg: 'Edit failed: ',
    rivOnlyHint: '(editing riv directly — raw properties)',
    artboardSel: 'Artboard',
  },
};
let lang = localStorage.getItem('rive-mcp-lang') || (navigator.language.startsWith('ja') ? 'ja' : 'en');
const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.ja[k] || k;
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.getElementById('langBtn').textContent = lang === 'ja' ? 'EN' : '日本語';
}
document.getElementById('langBtn').onclick = () => {
  lang = lang === 'ja' ? 'en' : 'ja';
  localStorage.setItem('rive-mcp-lang', lang);
  applyLang(); renderInputs(); buildTree(); renderInspector();
};

// ---- 基本状態 ----------------------------------------------------------------
const logEl = document.getElementById('log');
const log = (m) => { logEl.textContent = new Date().toLocaleTimeString() + '  ' + m + '\\n' + logEl.textContent.slice(0, 4000); };
rive.RuntimeLoader.setWasmUrl('/rive.wasm');

let r = null, mode = 'sm', scrubAnim = null, scrubDur = 1, paused = false;
let sceneSpec = null;       // シーンJSONモード時の spec（編集の正本）
let imageSizes = {};        // 画像id → natural size
let gTree = null;           // rivのみモードの構造（/tree）
let sel = null;             // {src:'scene', kind, obj} | {src:'riv', node}
const cv = document.getElementById('cv');
const $ = (id) => document.getElementById(id);

async function loadState() {
  const st = await (await fetch('/state')).json();
  sceneSpec = st.scene ?? null;
  imageSizes = st.imageSizes ?? {};
  if (sceneSpec) $('scene').value = JSON.stringify(sceneSpec, null, 2);
  $('fileinfo').textContent = (st.rivName || '-') + (st.bytes ? ' · ' + (st.bytes / 1024).toFixed(1) + ' KB · ' + st.objects + ' obj · v' + st.version : '');
  updateNotesBadge(st.pendingNotes || 0);
  if (!sceneSpec) {
    try { gTree = await (await fetch('/tree')).json(); } catch { gTree = null; }
  }
  return st;
}
function updateNotesBadge(n) {
  const b = $('notesBadge');
  b.style.display = n > 0 ? 'inline-block' : 'none';
  b.textContent = n;
}

// ---- Rive 起動 ---------------------------------------------------------------
function boot(artboard, smName, animName) {
  if (r) { try { r.cleanup(); } catch {} r = null; }
  paused = false; $('pauseBtn').textContent = '⏸';
  const opts = {
    src: '/file.riv?' + Date.now(),
    canvas: cv,
    autoplay: true,
    autoBind: true,
    onLoad: () => {
      r.resizeDrawingSurfaceToCanvas();
      populate();
      const defaultSM = $('smSel').value;
      if (mode === 'sm' && !smName && defaultSM && defaultSM !== '-') {
        boot(artboard ?? r.activeArtboard, defaultSM);
        return;
      }
      $('status').textContent = 'ready';
      drawSelBox();
    },
    onLoadError: (e) => { $('status').textContent = 'load error'; log('load error: ' + e); },
  };
  if (artboard) opts.artboard = artboard;
  if (mode === 'sm') { if (smName) opts.stateMachines = smName; }
  else if (animName) { opts.animations = animName; }
  r = new rive.Rive(opts);
  r.on(rive.EventType.RiveEvent, (e) => log('event: ' + JSON.stringify(e.data)));
  r.on(rive.EventType.StateChange, (e) => log('state: ' + JSON.stringify(e.data)));
}

function setOptions(sel_, names, selected) {
  sel_.textContent = '';
  for (const n of names.length ? names : ['-']) {
    const o = document.createElement('option');
    o.textContent = n;
    if (n === selected) o.selected = true;
    sel_.appendChild(o);
  }
}
function populate() {
  const contents = r.contents;
  const abNames = (contents?.artboards ?? []).map(a => a.name);
  setOptions($('artboardSel'), abNames, r.activeArtboard);
  const ab = (contents?.artboards ?? []).find(a => a.name === r.activeArtboard) ?? contents?.artboards?.[0];
  setOptions($('smSel'), (ab?.stateMachines ?? []).map(s => s.name));
  setOptions($('animSel'), ab?.animations ?? []);
  renderInputs();
  buildTree();
}

function renderInputs() {
  const box = $('inputs');
  box.textContent = '';
  const dimSpan = (msg) => { const s = document.createElement('span'); s.className = 'hint'; s.textContent = msg; box.appendChild(s); };
  if (!r) return dimSpan('-');
  if (mode !== 'sm') return dimSpan(t('animOnly'));
  const smName = $('smSel').value;
  let inputs = [];
  try { inputs = r.stateMachineInputs(smName) ?? []; } catch {}
  if (!inputs.length) return dimSpan(t('noInputs'));
  for (const inp of inputs) {
    const row = document.createElement('div'); row.className = 'row';
    const label = document.createElement('label'); label.textContent = inp.name;
    row.appendChild(label);
    if (inp.type === rive.StateMachineInputType.Trigger) {
      const b = document.createElement('button'); b.textContent = t('fire');
      b.onclick = () => { inp.fire(); log('fire: ' + inp.name); };
      row.appendChild(b);
    } else if (inp.type === rive.StateMachineInputType.Boolean) {
      const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!inp.value;
      c.onchange = () => { inp.value = c.checked; log(inp.name + ' = ' + c.checked); };
      row.appendChild(c);
    } else {
      const s = document.createElement('input'); s.type = 'range'; s.min = -100; s.max = 100; s.step = 1; s.value = inp.value ?? 0;
      const n = document.createElement('input'); n.type = 'text'; n.className = 'num'; n.value = inp.value ?? 0;
      s.oninput = () => { inp.value = Number(s.value); n.value = s.value; };
      n.onchange = () => { inp.value = Number(n.value); s.value = n.value; };
      row.appendChild(s); row.appendChild(n);
    }
    box.appendChild(row);
  }
}

// ---- シーンspec ヘルパー -------------------------------------------------------
function abSpec() {
  if (!sceneSpec) return null;
  if (sceneSpec.artboards?.length) {
    const name = $('artboardSel').value;
    return sceneSpec.artboards.find(a => a.name === name) ?? sceneSpec.artboards[0];
  }
  return sceneSpec; // 単一アートボード形式（トップレベルに shapes 等）
}
function abDims() {
  if (sceneSpec) {
    const ab = abSpec();
    if (ab && ab.width) return { w: ab.width, h: ab.height };
    if (sceneSpec.artboard) return { w: sceneSpec.artboard.width, h: sceneSpec.artboard.height };
  }
  if (gTree) {
    const ab = gTree.artboards.find(a => a.name === $('artboardSel').value) ?? gTree.artboards[0];
    if (ab) return { w: ab.width, h: ab.height };
  }
  return { w: 500, h: 500 };
}
// グループ/ボーン親チェーンの累積オフセット（回転は近似無視）
function parentOffset(parentId, ab) {
  let x = 0, y = 0, guard = 0;
  let cur = parentId;
  while (cur && guard++ < 20) {
    const g = (ab.groups ?? []).find(g => g.id === cur);
    if (g) { x += g.x; y += g.y; cur = g.parent; continue; }
    const b = (ab.bones ?? []).find(b => b.id === cur);
    if (b) { x += b.x ?? 0; y += b.y ?? 0; cur = b.parent; continue; }
    break;
  }
  return { x, y };
}
function bboxOf(kind, o, ab) {
  const po = parentOffset(o.parent, ab);
  const wx = po.x + o.x, wy = po.y + o.y;
  let w = 60, h = 60;
  if (kind === 'shape') { w = o.width ?? 60; h = o.height ?? 60;
    if (o.type === 'polygon' && o.points?.length) {
      const xs = o.points.map(p => p.x), ys = o.points.map(p => p.y);
      w = Math.max(...xs) - Math.min(...xs); h = Math.max(...ys) - Math.min(...ys);
    }
  } else if (kind === 'image') {
    const nat = imageSizes[o.id];
    const s = o.scale ?? 1;
    if (nat) { w = nat.width * s; h = nat.height * s; }
  } else if (kind === 'text') {
    const fs = o.runs?.[0]?.fontSize ?? 32;
    w = o.width ?? Math.max(60, (o.runs?.[0]?.text?.length ?? 4) * fs * 0.55);
    h = o.height ?? fs * 1.4;
  } else if (kind === 'group') { w = 24; h = 24; }
  return { x: wx, y: wy, w, h };
}
// キャンバス座標 ⇔ アートボード座標（Fit.Contain・中央揃え前提）
function stageMap() {
  const rect = cv.getBoundingClientRect();
  const stageRect = $('stage').getBoundingClientRect();
  const { w: aw, h: ah } = abDims();
  const s = Math.min(rect.width / aw, rect.height / ah);
  return {
    s,
    ox: rect.left - stageRect.left + (rect.width - aw * s) / 2,
    oy: rect.top - stageRect.top + (rect.height - ah * s) / 2,
    rect, stageRect,
  };
}
function drawSelBox() {
  const box = $('selBox');
  if (!sel || sel.src !== 'scene') { box.style.display = 'none'; return; }
  const ab = abSpec();
  const bb = bboxOf(sel.kind, sel.obj, ab);
  const m = stageMap();
  box.style.display = 'block';
  box.style.left = (m.ox + (bb.x - bb.w / 2) * m.s) + 'px';
  box.style.top = (m.oy + (bb.y - bb.h / 2) * m.s) + 'px';
  box.style.width = (bb.w * m.s) + 'px';
  box.style.height = (bb.h * m.s) + 'px';
}

// ---- 階層ツリー ---------------------------------------------------------------
const KIND_ICON = { group: '⬡', bone: '⌐', shape: '■', image: '🖼', text: 'T', nested: '⊞', artboard: 'A' };
function buildTree() {
  const wrap = $('treeWrap');
  wrap.textContent = '';
  const addNode = (label, type, depth, onClick, isOn) => {
    const d = document.createElement('div');
    d.className = 'tnode' + (isOn ? ' on' : '');
    d.style.paddingLeft = (8 + depth * 14) + 'px';
    const ic = document.createElement('span'); ic.className = 'ticon'; ic.textContent = KIND_ICON[type] ?? '·';
    const nm = document.createElement('span'); nm.textContent = label;
    const ty = document.createElement('span'); ty.className = 'ttype'; ty.textContent = type;
    d.appendChild(ic); d.appendChild(nm); d.appendChild(ty);
    d.onclick = onClick;
    wrap.appendChild(d);
    return d;
  };
  if (sceneSpec) {
    const ab = abSpec();
    if (!ab) return;
    const abName = ab.name ?? sceneSpec.artboard?.name ?? 'Artboard';
    addNode(abName, 'artboard', 0, () => selectScene('artboard', ab), sel?.kind === 'artboard');
    // グループ階層（parent チェーン）
    const groups = ab.groups ?? [];
    const depthOf = (g) => { let d = 1, cur = g.parent, guard = 0;
      while (cur && guard++ < 20) { const p = groups.find(x => x.id === cur); if (!p) break; d++; cur = p.parent; } return d; };
    const emitGroup = (g, depth) => {
      addNode(g.id, 'group', depth, () => selectScene('group', g), sel?.obj === g);
      for (const c of groups.filter(x => x.parent === g.id)) emitGroup(c, depth + 1);
      for (const b of (ab.bones ?? []).filter(b => b.parent === g.id)) emitBone(b, depth + 1);
      emitChildren(g.id, depth + 1);
    };
    const emitBone = (b, depth) => {
      addNode(b.id, 'bone', depth, () => selectScene('bone', b), sel?.obj === b);
      for (const c of (ab.bones ?? []).filter(x => x.parent === b.id)) emitBone(c, depth + 1);
      emitChildren(b.id, depth + 1);
    };
    const emitChildren = (parentId, depth) => {
      for (const [kind, list] of [['shape', ab.shapes], ['image', ab.images], ['text', ab.texts], ['nested', ab.nested]]) {
        for (const o of (list ?? []).filter(o => (o.parent ?? null) === parentId)) {
          addNode(o.id, kind, depth, () => selectScene(kind, o), sel?.obj === o);
        }
      }
    };
    for (const g of groups.filter(g => !g.parent)) emitGroup(g, 1);
    for (const b of (ab.bones ?? []).filter(b => !groups.some(g => g.id === b.parent) && !(ab.bones ?? []).some(x => x.id === b.parent))) {
      if (!groups.some(g => g.id === b.parent)) emitBone(b, 1);
    }
    emitChildren(undefined, 1);
    emitChildren(null, 1);
  } else if (gTree) {
    const ab = gTree.artboards.find(a => a.name === $('artboardSel').value) ?? gTree.artboards[0];
    if (!ab) { wrap.textContent = '-'; return; }
    addNode(ab.name, 'artboard', 0, () => {}, false);
    const byLocal = new Map(ab.nodes.map(n => [n.local, n]));
    const depthOf = (n) => { let d = 1, cur = n.parentId, guard = 0;
      while (cur !== null && cur !== undefined && cur !== 0 && guard++ < 30) { const p = byLocal.get(cur); if (!p) break; d++; cur = p.parentId; } return d; };
    for (const n of ab.nodes.slice(0, 400)) {
      addNode(n.name ?? n.type, n.type.toLowerCase().includes('bone') ? 'bone' : 'shape', Math.min(depthOf(n), 8),
        () => selectRiv(n), sel?.node === n);
    }
  }
}

// ---- 選択 & インスペクタ --------------------------------------------------------
function selectScene(kind, obj) { sel = { src: 'scene', kind, obj }; buildTree(); renderInspector(); drawSelBox(); }
function selectRiv(node) { sel = { src: 'riv', node }; buildTree(); renderInspector(); drawSelBox(); }

let rebuildTimer = null;
function scheduleRebuild(delay = 300) {
  $('scene').value = JSON.stringify(sceneSpec, null, 2);
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(doRebuild, delay);
}
async function doRebuild() {
  if (!sceneSpec) return;
  $('status').textContent = 'building…';
  const res = await (await fetch('/rebuild', { method: 'POST', body: JSON.stringify(sceneSpec, null, 2) })).json();
  if (res.ok) { $('status').textContent = 'ready'; }
  else { log(t('rebuildNg') + res.error); $('status').textContent = 'error'; }
}
async function rivEditSet(index, name, value) {
  const res = await (await fetch('/edit', { method: 'POST', body: JSON.stringify([{ op: 'set', index, set: { [name]: value } }]) })).json();
  if (res.ok) log(t('editOk') + ': ' + name + ' = ' + value);
  else log(t('editNg') + res.error);
}

function propRow(labelText, input) {
  const row = document.createElement('div'); row.className = 'prop';
  const l = document.createElement('label'); l.textContent = labelText;
  row.appendChild(l); row.appendChild(input);
  return row;
}
function numField(get, set, step = 1) {
  const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = round2(get() ?? 0);
  i.onchange = () => { set(Number(i.value)); };
  return i;
}
function colorField(get, set) {
  const i = document.createElement('input'); i.type = 'color'; i.value = (get() ?? '#ffffff').slice(0, 7);
  i.oninput = () => set(i.value);
  return i;
}
function textField(get, set) {
  const i = document.createElement('input'); i.type = 'text'; i.value = get() ?? '';
  i.onchange = () => set(i.value);
  return i;
}
const round2 = (v) => Math.round(v * 100) / 100;

function renderInspector() {
  const box = $('inspector');
  box.textContent = '';
  if (!sel) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = t('noSel'); box.appendChild(d); return; }

  if (sel.src === 'scene') {
    const o = sel.obj, kind = sel.kind;
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;margin-bottom:6px;color:var(--acc2)';
    title.textContent = (o.id ?? o.name ?? kind) + '  (' + kind + ')';
    box.appendChild(title);
    const N = (label, key, step = 1, dflt = 0) => box.appendChild(propRow(label, numField(() => o[key] ?? dflt, (v) => { o[key] = v; scheduleRebuild(); }, step)));
    if (kind === 'artboard') {
      const tgt = sceneSpec.artboard && !sceneSpec.artboards ? sceneSpec.artboard : o;
      box.appendChild(propRow('width', numField(() => tgt.width, (v) => { tgt.width = v; scheduleRebuild(); })));
      box.appendChild(propRow('height', numField(() => tgt.height, (v) => { tgt.height = v; scheduleRebuild(); })));
      const bgHolder = sceneSpec.artboards ? o : sceneSpec;
      box.appendChild(propRow('background', colorField(() => bgHolder.backgroundColor, (v) => { bgHolder.backgroundColor = v; scheduleRebuild(); })));
      return;
    }
    N('x', 'x'); N('y', 'y');
    if (kind === 'shape') {
      if (o.width !== undefined || o.type !== 'polygon') { N('width', 'width'); N('height', 'height'); }
      N('rotation', 'rotation');
      if (o.type === 'rect') N('cornerRadius', 'cornerRadius');
      N('opacity', 'opacity', 0.05, 1);
      if (o.fill?.color !== undefined || !o.fill?.gradient) {
        if (!o.fill) o.fill = { color: '#ffffff' };
        if (o.fill.color !== undefined) box.appendChild(propRow('fill', colorField(() => o.fill.color, (v) => { o.fill.color = v; scheduleRebuild(); })));
      }
      if (o.stroke) {
        box.appendChild(propRow('stroke', colorField(() => o.stroke.color, (v) => { o.stroke.color = v; scheduleRebuild(); })));
        box.appendChild(propRow('thickness', numField(() => o.stroke.thickness, (v) => { o.stroke.thickness = v; scheduleRebuild(); })));
      }
    } else if (kind === 'image') {
      N('scale', 'scale', 0.01, 1); N('rotation', 'rotation'); N('opacity', 'opacity', 0.05, 1);
    } else if (kind === 'text') {
      const run = o.runs?.[0];
      if (run) {
        box.appendChild(propRow('text', textField(() => run.text, (v) => { run.text = v; scheduleRebuild(); })));
        box.appendChild(propRow('fontSize', numField(() => run.fontSize ?? 32, (v) => { run.fontSize = v; scheduleRebuild(); })));
        box.appendChild(propRow('color', colorField(() => run.color ?? '#000000', (v) => { run.color = v; scheduleRebuild(); })));
      }
    } else if (kind === 'group') {
      N('rotation', 'rotation'); N('opacity', 'opacity', 0.05, 1);
    } else if (kind === 'bone') {
      N('rotation', 'rotation'); N('length', 'length');
    }
  } else {
    // rivのみモード: 生プロパティ編集
    const n = sel.node;
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;margin-bottom:2px;color:var(--acc2)';
    title.textContent = (n.name ?? n.type) + '  (' + n.type + ')';
    box.appendChild(title);
    const hint = document.createElement('div'); hint.className = 'hint'; hint.textContent = t('rivOnlyHint');
    box.appendChild(hint);
    for (const p of n.props) {
      if (p.kind === 'color') {
        box.appendChild(propRow(p.name, colorField(() => p.value, (v) => { p.value = v; rivEditSet(n.index, p.name, v); })));
      } else if (p.kind === 'bool') {
        const c = document.createElement('input'); c.type = 'checkbox'; c.checked = !!p.value;
        c.onchange = () => { p.value = c.checked; rivEditSet(n.index, p.name, c.checked); };
        box.appendChild(propRow(p.name, c));
      } else if (p.kind === 'string') {
        box.appendChild(propRow(p.name, textField(() => p.value, (v) => { p.value = v; rivEditSet(n.index, p.name, v); })));
      } else {
        box.appendChild(propRow(p.name, numField(() => Number(p.value), (v) => { p.value = v; rivEditSet(n.index, p.name, v); }, 0.5)));
      }
    }
  }
}

// ---- キャンバスのクリック選択 & ドラッグ移動（シーンモード） ---------------------
let drag = null;
$('stage').addEventListener('pointerdown', (e) => {
  if (!sceneSpec) return;
  const ab = abSpec();
  const m = stageMap();
  const ax = (e.clientX - m.stageRect.left - m.ox) / m.s;
  const ay = (e.clientY - m.stageRect.top - m.oy) / m.s;
  // 前面から順にヒットテスト（z降順 → texts → images → shapes の順で前面寄り）
  const candidates = [];
  for (const [kind, list] of [['nested', ab.nested], ['text', ab.texts], ['image', ab.images], ['shape', ab.shapes]]) {
    for (const o of (list ?? [])) {
      const bb = bboxOf(kind, o, ab);
      if (ax >= bb.x - bb.w / 2 && ax <= bb.x + bb.w / 2 && ay >= bb.y - bb.h / 2 && ay <= bb.y + bb.h / 2) {
        candidates.push({ kind, o, z: o.z ?? 0, area: bb.w * bb.h });
      }
    }
  }
  if (!candidates.length) { sel = null; buildTree(); renderInspector(); drawSelBox(); return; }
  candidates.sort((a, b) => (b.z - a.z) || (a.area - b.area));
  const hit = candidates[0];
  selectScene(hit.kind, hit.o);
  drag = { startX: ax, startY: ay, ox: hit.o.x, oy: hit.o.y, moved: false };
  e.preventDefault();
});
window.addEventListener('pointermove', (e) => {
  if (!drag || !sel || sel.src !== 'scene') return;
  const m = stageMap();
  const ax = (e.clientX - m.stageRect.left - m.ox) / m.s;
  const ay = (e.clientY - m.stageRect.top - m.oy) / m.s;
  sel.obj.x = round2(drag.ox + (ax - drag.startX));
  sel.obj.y = round2(drag.oy + (ay - drag.startY));
  drag.moved = true;
  drawSelBox();
  scheduleRebuild(160);
});
window.addEventListener('pointerup', () => {
  if (drag?.moved) { renderInspector(); scheduleRebuild(0); }
  drag = null;
});
window.addEventListener('resize', drawSelBox);

// ---- タイムライン --------------------------------------------------------------
function renderTimeline() {
  const tl = $('timeline');
  tl.textContent = '';
  if (mode !== 'anim' || !sceneSpec) { tl.style.display = 'none'; return; }
  const ab = abSpec();
  const anim = (ab.animations ?? []).find(a => a.name === scrubAnim);
  if (!anim) { tl.style.display = 'none'; return; }
  tl.style.display = 'block';
  const durS = (anim.duration ?? 60) / (anim.fps ?? 60);
  scrubDur = durS;
  for (const tr of anim.tracks ?? []) {
    const row = document.createElement('div'); row.className = 'trow';
    const lb = document.createElement('div'); lb.className = 'tlabel'; lb.textContent = tr.target + ' · ' + tr.property;
    const lane = document.createElement('div'); lane.className = 'tlane';
    for (const k of tr.keyframes ?? []) {
      const d = document.createElement('div'); d.className = 'tkey';
      d.style.left = (100 * k.frame / (anim.duration || 1)) + '%';
      d.title = 'f' + k.frame + (k.value !== undefined ? ' = ' + k.value : '') + (k.easing ? ' (' + k.easing + ')' : '');
      d.onclick = (ev) => { ev.stopPropagation(); seekTo(k.frame / (anim.fps ?? 60)); };
      lane.appendChild(d);
    }
    const cur = document.createElement('div'); cur.id = 'tcursor'; cur.style.left = '0%';
    lane.appendChild(cur);
    lane.onclick = (ev) => {
      const rect = lane.getBoundingClientRect();
      seekTo(((ev.clientX - rect.left) / rect.width) * durS);
    };
    row.appendChild(lb); row.appendChild(lane);
    tl.appendChild(row);
  }
}
function seekTo(tsec) {
  tsec = Math.max(0, Math.min(scrubDur, tsec));
  try { r.scrub(scrubAnim, tsec); } catch {}
  $('scrub').value = scrubDur ? tsec / scrubDur : 0;
  $('time').textContent = tsec.toFixed(2) + 's';
  document.querySelectorAll('#tcursor').forEach(c => { c.style.left = (100 * tsec / scrubDur) + '%'; });
}

// ---- 操作 ----------------------------------------------------------------------
$('tabTree').onclick = () => { $('tabTree').classList.add('on'); $('tabPlay').classList.remove('on'); $('treeWrap').style.display = 'block'; $('playPane').style.display = 'none'; };
$('tabPlay').onclick = () => { $('tabPlay').classList.add('on'); $('tabTree').classList.remove('on'); $('treeWrap').style.display = 'none'; $('playPane').style.display = 'block'; };
$('artboardSel').onchange = () => { mode = 'sm'; sel = null; boot($('artboardSel').value); renderTimeline(); };
$('smSel').onchange = () => { mode = 'sm'; boot($('artboardSel').value, $('smSel').value); };
$('playAnim').onclick = () => {
  mode = 'anim';
  scrubAnim = $('animSel').value;
  boot($('artboardSel').value, null, scrubAnim);
  $('scrub').disabled = false;
  renderTimeline();
};
$('backSM').onclick = () => { mode = 'sm'; $('scrub').disabled = true; boot($('artboardSel').value, $('smSel').value); renderTimeline(); };
$('scrub').oninput = () => {
  if (!r || mode !== 'anim') return;
  seekTo(Number($('scrub').value) * scrubDur);
};
$('pauseBtn').onclick = () => {
  if (!r) return;
  paused = !paused;
  try { paused ? r.pause() : r.play(); } catch {}
  $('pauseBtn').textContent = paused ? '▶' : '⏸';
  log(paused ? t('paused') : t('resumed'));
};
$('zoom').oninput = () => { cv.style.transform = 'scale(' + $('zoom').value + ')'; drawSelBox(); };
$('zoomReset').onclick = () => { $('zoom').value = 1; cv.style.transform = ''; drawSelBox(); };
$('snap').onclick = () => {
  const a = document.createElement('a');
  a.download = 'studio-frame.png';
  a.href = cv.toDataURL('image/png');
  a.click();
};
$('logClear').onclick = () => { logEl.textContent = ''; };
$('fmt').onclick = () => {
  try { $('scene').value = JSON.stringify(JSON.parse($('scene').value), null, 2); }
  catch (e) { log(t('jsonError') + e.message); }
};
$('apply').onclick = async () => {
  try { sceneSpec = JSON.parse($('scene').value); } catch (e) { log(t('jsonError') + e.message); return; }
  sel = null; renderInspector();
  $('status').textContent = 'building…';
  const res = await (await fetch('/rebuild', { method: 'POST', body: JSON.stringify(sceneSpec, null, 2) })).json();
  if (res.ok) log(t('rebuildOk') + ' (' + res.bytes + ' bytes)' + (res.warnings?.length ? t('warn') + res.warnings.join('; ') : ''));
  else { log(t('rebuildNg') + res.error); $('status').textContent = 'error'; }
};

// ---- AIへの指示 -----------------------------------------------------------------
$('aiSend').onclick = async () => {
  const text = $('aiText').value.trim();
  if (!text) return;
  const res = await (await fetch('/notes', { method: 'POST', body: JSON.stringify({ text }) })).json();
  if (res.ok) {
    $('aiText').value = '';
    updateNotesBadge(res.pending);
    $('aiState').textContent = t('notesSent') + ' (' + res.pending + ')';
    log(t('notesSent') + ': ' + text);
  }
};

// ---- ガイド / ヘルプ ---------------------------------------------------------------
if (localStorage.getItem('rive-mcp-guide-done')) $('guide').style.display = 'none';
$('guideClose').onclick = () => { $('guide').style.display = 'none'; localStorage.setItem('rive-mcp-guide-done', '1'); };
$('helpBtn').onclick = () => $('helpWrap').classList.add('open');
$('helpClose').onclick = () => $('helpWrap').classList.remove('open');
$('helpWrap').onclick = (e) => { if (e.target.id === 'helpWrap') $('helpWrap').classList.remove('open'); };

// ---- SSE -----------------------------------------------------------------------
const sse = new EventSource('/events');
sse.onmessage = (e) => {
  if (e.data === 'reload') {
    log(t('fileUpdated'));
    const wasSel = sel;
    if (mode === 'sm') boot($('artboardSel').value, $('smSel').value || undefined);
    else boot($('artboardSel').value, null, scrubAnim);
    loadState().then(() => {
      // 選択を id で復元（specは再取得で別オブジェクトになる）
      if (wasSel?.src === 'scene' && sceneSpec) {
        const ab = abSpec();
        const list = { shape: ab.shapes, image: ab.images, text: ab.texts, group: ab.groups, bone: ab.bones, nested: ab.nested }[wasSel.kind];
        const again = (list ?? []).find(o => o.id === wasSel.obj.id);
        if (again) { sel = { src: 'scene', kind: wasSel.kind, obj: again }; }
      }
      buildTree(); renderInspector(); drawSelBox(); renderTimeline();
    });
  } else if (e.data === 'notes-taken') {
    updateNotesBadge(0);
    $('aiState').textContent = t('notesTaken');
    log(t('notesTaken'));
  } else { $('status').textContent = 'ready'; }
};

applyLang();
loadState().then(() => boot());
</script></body></html>`;

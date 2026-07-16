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
import { encodeApng } from "./apng.js";
import { encodeGif } from "./gif.js";

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
      if (url.pathname === "/inter.ttf") {
        return send(200, "font/ttf", readFileSync(join(ASSETS_DIR, "inter.ttf")));
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
      // エクスポート: クライアントがキャプチャしたフレーム列を APNG / GIF に合成して返す
      if (url.pathname === "/export/apng" && req.method === "POST") {
        readBody((body) => {
          try {
            const { frames, delayMs, loops } = JSON.parse(body) as { frames: string[]; delayMs?: number; loops?: number };
            if (!Array.isArray(frames) || !frames.length) throw new Error("frames required");
            const bytes = encodeApng(frames.map((f) => new Uint8Array(Buffer.from(f, "base64"))), { delayMs, loops: loops ?? 0 });
            res.writeHead(200, { "Content-Type": "image/apng", "Cache-Control": "no-store" });
            res.end(Buffer.from(bytes));
          } catch (e) {
            send(400, "application/json; charset=utf-8", JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
          }
        });
        return;
      }
      if (url.pathname === "/export/gif" && req.method === "POST") {
        readBody((body) => {
          try {
            const { frames, width, height, delayMs } = JSON.parse(body) as { frames: string[]; width: number; height: number; delayMs?: number };
            if (!Array.isArray(frames) || !frames.length || !width || !height) throw new Error("frames/width/height required");
            const fps = Math.max(1, Math.round(1000 / (delayMs || 33)));
            const bytes = encodeGif(frames.map((f) => Buffer.from(f, "base64")), width, height, fps);
            res.writeHead(200, { "Content-Type": "image/gif", "Cache-Control": "no-store" });
            res.end(bytes);
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
  @font-face { font-family:'Inter'; src:url('/inter.ttf') format('truetype'); font-display:swap; }
  :root {
    --bg:#141419; --panel:#1d1d24; --panel-2:#24242d; --border:#2e2e38;
    --text:#e8e8ee; --text-dim:#9b9ba6; --text-faint:#5f5f6b;
    --accent:#5ba7ff; --accent-2:#ff4e6b; --ok:#3ecf8e; --warn:#ffb454;
    --radius:8px; --radius-s:5px;
    --font:'Inter', system-ui, sans-serif;
    --mono:ui-monospace, 'Cascadia Code', Consolas, monospace;
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--text); font:12.5px/1.5 var(--font); display:flex; flex-direction:column; height:100vh; overflow:hidden; }
  ::placeholder { color:var(--text-faint); }
  :focus-visible { outline:2px solid var(--accent); outline-offset:1px; }
  /* ---- アプリバー (44px) ---- */
  #appbar { height:44px; flex-shrink:0; display:flex; align-items:center; gap:16px; padding:0 12px;
    background:var(--panel); border-bottom:1px solid var(--border); }
  #appbar .ab-left { display:flex; align-items:center; gap:8px; min-width:0; flex:1; }
  #appbar .ab-center { display:flex; align-items:center; gap:4px; }
  #appbar .ab-right { display:flex; align-items:center; gap:8px; flex:1; justify-content:flex-end; }
  #logo { font-size:13px; font-weight:600; letter-spacing:.02em; white-space:nowrap; display:flex; align-items:center; gap:6px; }
  #logo .dot { width:8px; height:8px; border-radius:50%; background:var(--accent-2); display:inline-block; }
  #fileinfo { font-size:11.5px; color:var(--text-dim); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  #dirtyBadge { color:var(--warn); font-size:14px; line-height:1; display:none; }
  #connDot { width:8px; height:8px; border-radius:50%; background:var(--ok); display:inline-block; transition:background .12s ease; }
  #connDot.off { background:var(--accent-2); }
  /* ---- レイアウト ---- */
  #main { flex:1; display:flex; min-height:0; }
  #left { width:240px; background:var(--panel); border-right:1px solid var(--border); display:flex; flex-direction:column; flex-shrink:0; }
  #right { width:300px; background:var(--panel); border-left:1px solid var(--border); padding:12px; overflow-y:auto; flex-shrink:0; }
  #center { flex:1; display:flex; flex-direction:column; min-width:0; }
  .gutter { width:5px; margin:0 -2px; cursor:col-resize; flex-shrink:0; z-index:5; }
  .gutter:hover { background:rgba(91,167,255,.25); }
  #stage { flex:1; min-width:0; min-height:0; display:flex; align-items:center; justify-content:center; background:
    repeating-conic-gradient(#17171c 0 25%, #101014 0 50%) 0 0/32px 32px; position:relative; overflow:hidden; }
  canvas { max-width:92%; max-height:92%; min-width:0; min-height:0; box-shadow:0 8px 24px rgba(0,0,0,.4); border-radius:4px; background:transparent; }
  /* ---- 選択枠 ---- */
  #selBox { position:absolute; border:1px solid var(--accent); border-radius:2px; pointer-events:none; display:none; }
  #selBox.dragging { border-style:dashed; }
  #selBox::after { content:''; position:absolute; left:50%; top:50%; width:6px; height:6px; margin:-3px;
    background:var(--accent); border-radius:50%; }
  .rzHandle { position:absolute; width:7px; height:7px; margin:-3.5px; background:#fff; border:1px solid var(--accent);
    border-radius:1.5px; pointer-events:auto; display:none; }
  #selBox.rz .rzHandle { display:block; }
  .rzHandle.nw { left:0; top:0; cursor:nwse-resize; }
  .rzHandle.se { left:100%; top:100%; cursor:nwse-resize; }
  .rzHandle.ne { left:100%; top:0; cursor:nesw-resize; }
  .rzHandle.sw { left:0; top:100%; cursor:nesw-resize; }
  body.grabbing, body.grabbing * { cursor:grabbing !important; }
  .toolbarSep { width:1px; height:18px; background:var(--border); margin:0 4px; }
  /* ---- 見出し・ラベル ---- */
  h2 { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--text-dim); margin:16px 0 8px; }
  h2:first-child { margin-top:0; }
  /* ---- 入力 ---- */
  select, input[type=text], input[type=number], textarea { width:100%; height:28px; background:var(--panel-2); color:var(--text);
    border:1px solid var(--border); border-radius:var(--radius-s); padding:4px 8px; font:inherit; transition:border-color .12s ease, box-shadow .12s ease; }
  textarea { height:auto; }
  select:focus, input:focus, textarea:focus { outline:none; border-color:var(--accent); box-shadow:0 0 0 2px rgba(91,167,255,.25); }
  input[type=color] { width:28px; height:28px; background:var(--panel-2); border:1px solid var(--border); border-radius:var(--radius-s); padding:2px; flex-shrink:0; }
  textarea { font:11.5px/1.4 var(--mono); resize:vertical; }
  #scene { min-height:140px; }
  #aiText { min-height:60px; font-family:var(--font); font-size:12.5px; }
  /* ---- ボタン ---- */
  button { height:28px; background:var(--panel-2); color:var(--text); border:1px solid var(--border); border-radius:var(--radius-s);
    padding:0 12px; font:inherit; font-size:12.5px; cursor:pointer; margin:2px 4px 2px 0;
    transition:border-color .12s ease, background .12s ease, color .12s ease; }
  button:hover { border-color:var(--accent); background:rgba(91,167,255,.08); }
  button:active { transform:translateY(1px); }
  button:disabled { opacity:.45; cursor:default; transform:none; }
  button.primary { background:var(--accent); border-color:var(--accent); color:#fff; }
  button.primary:hover { background:#6fb2ff; }
  button.danger { background:transparent; border-color:var(--accent-2); color:var(--accent-2); }
  button.mini { height:24px; padding:0 8px; font-size:11.5px; }
  button.icon { width:28px; padding:0; display:inline-flex; align-items:center; justify-content:center; }
  button.icon svg { width:14px; height:14px; }
  .row { display:flex; align-items:center; gap:8px; margin:6px 0; }
  .row label { flex:1; color:var(--text-dim); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  /* ---- インスペクタ ---- */
  .isec { font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:.06em; color:var(--text-dim); margin:16px 0 6px; }
  .isec:first-of-type { margin-top:8px; }
  .prop { display:grid; grid-template-columns:84px 1fr; align-items:center; gap:8px; margin:4px 0; }
  .prop > label { color:var(--text-dim); font-size:11px; text-transform:uppercase; letter-spacing:.06em;
    overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .prop > label.dragv { cursor:ew-resize; user-select:none; }
  .prop2 { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin:4px 0; }
  .pcell { display:flex; align-items:center; gap:6px; }
  .pcell > label { color:var(--text-dim); font-size:11px; text-transform:uppercase; letter-spacing:.06em; min-width:14px; }
  .pcell > label.dragv { cursor:ew-resize; user-select:none; }
  .colorCombo { display:flex; align-items:center; gap:6px; }
  .colorCombo input[type=text] { font-family:var(--mono); font-size:11.5px; }
  input[type=range] { height:auto; flex:1.4; accent-color:var(--accent); padding:0; border:0; background:transparent; box-shadow:none !important; }
  input[type=checkbox] { width:15px; height:15px; accent-color:var(--accent); }
  /* ---- イベントログ ---- */
  #log { font:11.5px/1.6 var(--mono); color:var(--text-dim); background:var(--panel-2); border-radius:var(--radius-s); padding:8px; max-height:110px; overflow-y:auto; }
  .lrow { display:flex; gap:6px; align-items:baseline; white-space:pre-wrap; word-break:break-all; }
  .ldot { width:6px; height:6px; border-radius:50%; flex-shrink:0; position:relative; top:-1px; background:var(--text-faint); }
  .ldot.state { background:var(--accent); }
  .ldot.event { background:var(--warn); }
  .ldot.error { background:var(--accent-2); }
  /* ---- ツールバー（再生列） ---- */
  #toolbar { padding:8px 12px; background:var(--panel); border-top:1px solid var(--border); display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
  #toolbar input[type=range] { flex:1; min-width:110px; }
  #toolbar select { width:auto; height:24px; padding:0 4px; font-size:11.5px; }
  .badge { display:inline-block; background:var(--panel-2); border:1px solid var(--border); border-radius:4px; padding:1px 8px; font-size:11px; color:var(--accent); }
  .num { width:64px !important; }
  .hint { font-size:11.5px; color:var(--text-dim); margin:4px 0; }
  /* ---- 階層ツリー ---- */
  #treeWrap { flex:1; overflow-y:auto; padding:4px 4px 12px; }
  .tnode { height:26px; display:flex; align-items:center; gap:5px; padding:0 8px; cursor:pointer; white-space:nowrap;
    overflow:hidden; font-size:12.5px; border-left:3px solid transparent; transition:background .12s ease; }
  .tnode:hover { background:var(--panel-2); }
  .tnode.on { border-left-color:var(--accent); background:rgba(91,167,255,.12); color:#fff; }
  .tnode .chev { width:12px; height:12px; flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;
    color:var(--text-dim); transition:transform .12s ease; transform:rotate(90deg); }
  .tnode .chev.closed { transform:rotate(0deg); }
  .tnode .chev svg { width:8px; height:8px; }
  .tnode .ticon { width:14px; height:14px; flex-shrink:0; color:var(--accent); display:inline-flex; }
  .tnode .ticon svg { width:14px; height:14px; }
  .tnode .tname { overflow:hidden; text-overflow:ellipsis; }
  .tnode .ttype { color:var(--text-dim); font-size:11px; margin-left:auto; padding-left:6px; }
  #leftTabs { display:flex; gap:4px; padding:8px 8px 0; }
  #leftTabs button { flex:1; height:26px; background:transparent; border:0; border-radius:var(--radius-s) var(--radius-s) 0 0;
    margin:0; padding:0 4px; font-size:11.5px; color:var(--text-dim); }
  #leftTabs button.on { background:var(--panel-2); color:var(--text); }
  #playPane { display:none; padding:12px; overflow-y:auto; flex:1; }
  /* ---- 初回ガイド（右下カード） ---- */
  #guide { position:fixed; right:16px; bottom:16px; z-index:8; width:300px; background:var(--panel);
    border:1px solid var(--border); border-radius:var(--radius); padding:12px; font-size:12px;
    box-shadow:0 8px 24px rgba(0,0,0,.4); animation:panelIn .15s ease; }
  #guide .ghead { display:flex; align-items:center; margin-bottom:8px; }
  #guide .ghead b { font-size:13px; }
  #guideClose { margin-left:auto; width:22px; height:22px; padding:0; border:0; background:transparent; color:var(--text-dim); font-size:14px; }
  #guideClose:hover { color:var(--text); background:transparent; }
  .gstep { display:flex; gap:8px; margin:6px 0; color:var(--text-dim); align-items:baseline; }
  .gstep .gcheck { width:14px; height:14px; flex-shrink:0; border:1px solid var(--border); border-radius:50%;
    display:inline-flex; align-items:center; justify-content:center; font-size:9px; color:transparent; position:relative; top:2px;
    transition:background .12s ease, color .12s ease; }
  .gstep.done { color:var(--text); }
  .gstep.done .gcheck { background:var(--ok); border-color:var(--ok); color:#0c2a1c; }
  #notesBadge { background:var(--accent-2); border-color:var(--accent-2); color:#fff; display:none; }
  /* ---- タイムライン ---- */
  #timeline { background:var(--panel); border-top:1px solid var(--border); height:160px; overflow-y:auto; display:none; flex-shrink:0; }
  .trow { display:grid; grid-template-columns:150px 1fr; align-items:center; border-bottom:1px solid var(--border); }
  .trow .tlabel { font-size:11px; color:var(--text-dim); padding:3px 8px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .tlane { position:relative; height:22px; background:var(--bg); transition:background .12s ease; }
  .trow:hover .tlane { background:#1a1a21; }
  .tlane.ruler { height:20px; background:var(--panel-2); cursor:ew-resize; }
  .rtick { position:absolute; top:0; bottom:0; width:1px; background:var(--border); pointer-events:none; }
  .rtick span { position:absolute; top:2px; left:3px; font-size:9px; color:var(--text-dim); font-family:var(--mono); }
  .tkey { position:absolute; top:50%; width:8px; height:8px; margin:-4px 0 0 -4px; background:var(--text-dim);
    transform:rotate(45deg); cursor:ew-resize; transition:transform .12s ease, background .12s ease; }
  .tkey:hover { transform:rotate(45deg) scale(1.3); background:var(--text); }
  .tkey.sel { background:var(--accent-2); }
  .tcur { position:absolute; top:0; bottom:0; width:1px; background:var(--accent-2); pointer-events:none; }
  .phead { position:absolute; top:0; width:9px; height:9px; margin-left:-5px; background:var(--accent-2);
    clip-path:polygon(0 0, 100% 0, 50% 100%); pointer-events:none; }
  /* ---- トースト ---- */
  #toasts { position:fixed; right:16px; bottom:16px; z-index:20; display:flex; flex-direction:column; gap:8px; align-items:flex-end; pointer-events:none; }
  .toast { background:var(--panel); border:1px solid var(--border); border-left:4px solid var(--ok); border-radius:var(--radius-s);
    padding:8px 14px; font-size:12px; box-shadow:0 8px 24px rgba(0,0,0,.4); animation:panelIn .15s ease; transition:opacity .4s ease; }
  .toast.err { border-left-color:var(--accent-2); }
  .toast.fade { opacity:0; }
  @keyframes panelIn { from { opacity:0; transform:translateY(4px); } to { opacity:1; transform:none; } }
  /* ---- ヘルプ ---- */
  #helpWrap { position:fixed; inset:0; background:#000a; display:none; align-items:center; justify-content:center; z-index:10; }
  #helpWrap.open { display:flex; }
  #help { background:var(--panel); border:1px solid var(--border); border-radius:var(--radius); max-width:660px; width:92%;
    max-height:86vh; overflow-y:auto; padding:24px; animation:panelIn .15s ease; }
  #help h3 { color:var(--accent); margin:0 0 8px; font-size:15px; }
  #help h4 { margin:16px 0 4px; font-size:13px; }
  #help p, #help li { font-size:12.5px; color:var(--text); }
  #help code { background:var(--panel-2); padding:1px 5px; border-radius:4px; font-size:11.5px; font-family:var(--mono); color:var(--accent); }
</style></head><body>
<div id="appbar">
  <div class="ab-left">
    <span id="logo"><span class="dot"></span>rive-mcp studio</span>
    <span id="fileinfo">-</span>
    <span id="dirtyBadge" data-i18n-title="dirtyT">●</span>
  </div>
  <div class="ab-center">
    <button id="undoBtn" class="icon" data-i18n-aria="undoA" data-i18n-title="undoA"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M6 4 3 7l3 3"/><path d="M3 7h7a3 3 0 0 1 0 6H8"/></svg></button>
    <button id="redoBtn" class="icon" data-i18n-aria="redoA" data-i18n-title="redoA"><svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 4l3 3-3 3"/><path d="M13 7H6a3 3 0 0 0 0 6h2"/></svg></button>
    <span class="toolbarSep"></span>
    <button id="addRect" class="mini" data-i18n="addRectBtn"></button>
    <button id="addEllipse" class="mini" data-i18n="addEllipseBtn"></button>
    <button id="addText" class="mini" data-i18n="addTextBtn"></button>
  </div>
  <div class="ab-right">
    <span class="badge" id="status">…</span>
    <button class="mini" id="langBtn">EN</button>
    <button class="mini icon" id="helpBtn" data-i18n-aria="helpA">?</button>
    <span id="connDot" data-i18n-title="connT"></span>
  </div>
</div>
<div id="main">
<div id="left">
  <div id="leftTabs">
    <button id="tabTree" class="on" data-i18n="tabTree"></button>
    <button id="tabPlay" data-i18n="tabPlay"></button>
  </div>
  <div id="treeWrap"></div>
  <div id="playPane">
    <h2 data-i18n="hArtboard"></h2>
    <select id="artboardSel"></select>
    <div style="height:8px"></div>
    <select id="smSel"></select>
    <h2 data-i18n="hInputs"></h2>
    <div id="inputs"><span class="hint">-</span></div>
    <h2 data-i18n="hAnim"></h2>
    <select id="animSel"></select>
    <div class="row">
      <button id="playAnim" class="primary" data-i18n="play"></button>
      <button id="backSM" data-i18n="backSM"></button>
    </div>
  </div>
</div>
<div class="gutter" id="gutterL"></div>
<div id="center">
  <div id="stage"><canvas id="cv" width="800" height="600"></canvas><div id="selBox">
    <div class="rzHandle nw" data-corner="nw"></div>
    <div class="rzHandle ne" data-corner="ne"></div>
    <div class="rzHandle sw" data-corner="sw"></div>
    <div class="rzHandle se" data-corner="se"></div>
  </div></div>
  <div id="timeline"></div>
  <div id="toolbar">
    <button id="pauseBtn" class="mini icon" data-i18n-aria="pauseA">⏸</button>
    <select id="speedSel" data-i18n-aria="speedL">
      <option value="0.25">0.25x</option>
      <option value="0.5">0.5x</option>
      <option value="1" selected>1x</option>
      <option value="2">2x</option>
    </select>
    <span class="hint" data-i18n="scrubL"></span>
    <input type="range" id="scrub" min="0" max="1" step="0.001" value="0" disabled>
    <span id="time" class="badge">0.00s</span>
    <span class="hint" data-i18n="zoomL"></span>
    <input type="range" id="zoom" min="0.25" max="3" step="0.05" value="1" style="max-width:110px">
    <button id="zoomReset" class="mini">1:1</button>
    <span class="toolbarSep"></span>
    <span class="hint" data-i18n="expL"></span>
    <button id="snap" class="mini" data-i18n="expPng" data-i18n-title="expPngT"></button>
    <button id="expApng" class="mini">APNG</button>
    <button id="expGif" class="mini">GIF</button>
    <button id="expWebm" class="mini">WebM</button>
  </div>
</div>
<div class="gutter" id="gutterR"></div>
<div id="right">
  <h2 data-i18n="hInspector"></h2>
  <div id="inspector"><div class="hint" data-i18n="noSel"></div></div>
  <h2><span data-i18n="hAI"></span> <span class="badge" id="notesBadge">0</span></h2>
  <textarea id="aiText" data-i18n-ph="aiPlaceholder"></textarea>
  <div class="row">
    <button id="aiSend" class="primary" data-i18n="aiSend"></button>
    <span class="hint" id="aiState"></span>
  </div>
  <div class="hint" data-i18n="aiHint"></div>
  <h2><span data-i18n="hLog"></span> <button class="mini" id="logClear" data-i18n="clear" style="float:right"></button></h2>
  <div id="log"></div>
  <h2 data-i18n="hScene"></h2>
  <textarea id="scene" spellcheck="false" data-i18n-ph="scenePlaceholder"></textarea>
  <div class="row">
    <button id="apply" class="primary" data-i18n="rebuild"></button>
    <button id="fmt" class="mini" data-i18n="format"></button>
  </div>
</div>
</div>
<div id="guide">
  <div class="ghead"><b data-i18n="guideTitle"></b><button id="guideClose" data-i18n-aria="close">×</button></div>
  <div class="gstep" id="gstep1"><span class="gcheck">✓</span><span data-i18n="guide1"></span></div>
  <div class="gstep" id="gstep2"><span class="gcheck">✓</span><span data-i18n="guide2"></span></div>
  <div class="gstep" id="gstep3"><span class="gcheck">✓</span><span data-i18n="guide3"></span></div>
</div>
<div id="toasts"></div>
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
    helpP6: 'ツールバー: 一時停止 / 速度 / シーク / ズーム / エクスポート（PNG・APNG・GIF・WebM）',
    paused: '一時停止', resumed: '再開',
    notesSent: '指示を送信しました', notesTaken: 'AIが指示を受け取りました',
    fileUpdated: 'ファイル更新 → リロード', jsonError: 'JSONエラー: ',
    rebuildOk: '再ビルド成功', rebuildNg: '再ビルド失敗: ', warn: ' 警告: ',
    editOk: '編集を適用', editNg: '編集失敗: ',
    rivOnlyHint: '（rivを直接編集中 — 生プロパティ）',
    artboardSel: 'アートボード',
    addRectBtn: '+ 四角形', addEllipseBtn: '+ 楕円', addTextBtn: '+ テキスト',
    speedL: '再生速度', kfDeleteMin: '最後のキーフレームは削除できません',
    undoDone: '元に戻しました', redoDone: 'やり直しました', objDeleted: 'オブジェクトを削除しました',
    undoA: '元に戻す (Ctrl+Z)', redoA: 'やり直す (Ctrl+Y)', helpA: 'ヘルプ', pauseA: '再生 / 一時停止',
    connT: 'サーバー接続中', connOffT: 'サーバー切断 — 再接続待ち', dirtyT: '未保存の変更（自動再ビルド待ち）',
    expL: 'エクスポート', expPng: 'PNG', expPngT: '表示中フレームをPNG保存',
    expProg: 'エクスポート中… ', expDone: 'エクスポート完了', expFail: 'エクスポート失敗: ',
    expNoAnim: 'エクスポートできるアニメーションがありません',
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
    helpP6: 'Toolbar: pause / speed / seek / zoom / export (PNG, APNG, GIF, WebM)',
    paused: 'Paused', resumed: 'Resumed',
    notesSent: 'Instruction queued', notesTaken: 'AI picked up the instructions',
    fileUpdated: 'File changed → reloading', jsonError: 'JSON error: ',
    rebuildOk: 'Rebuild OK', rebuildNg: 'Rebuild failed: ', warn: ' warnings: ',
    editOk: 'Edit applied', editNg: 'Edit failed: ',
    rivOnlyHint: '(editing riv directly — raw properties)',
    artboardSel: 'Artboard',
    addRectBtn: '+ Rect', addEllipseBtn: '+ Ellipse', addTextBtn: '+ Text',
    speedL: 'Playback speed', kfDeleteMin: 'Cannot delete the last keyframe',
    undoDone: 'Undo', redoDone: 'Redo', objDeleted: 'Object deleted',
    undoA: 'Undo (Ctrl+Z)', redoA: 'Redo (Ctrl+Y)', helpA: 'Help', pauseA: 'Play / Pause',
    connT: 'Connected', connOffT: 'Disconnected — waiting to reconnect', dirtyT: 'Unsaved changes (auto-rebuild pending)',
    expL: 'Export', expPng: 'PNG', expPngT: 'Save the current frame as PNG',
    expProg: 'Exporting… ', expDone: 'Export complete', expFail: 'Export failed: ',
    expNoAnim: 'No animation to export',
  },
};
let lang = localStorage.getItem('rive-mcp-lang') || (navigator.language.startsWith('ja') ? 'ja' : 'en');
const t = (k) => (I18N[lang] && I18N[lang][k]) || I18N.ja[k] || k;
function applyLang() {
  document.documentElement.lang = lang;
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
  document.querySelectorAll('[data-i18n-aria]').forEach((el) => { el.setAttribute('aria-label', t(el.dataset.i18nAria)); });
  document.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  document.getElementById('langBtn').textContent = lang === 'ja' ? 'EN' : '日本語';
}
document.getElementById('langBtn').onclick = () => {
  lang = lang === 'ja' ? 'en' : 'ja';
  localStorage.setItem('rive-mcp-lang', lang);
  applyLang(); renderInputs(); buildTree(); renderInspector();
};

// ---- 基本状態 ----------------------------------------------------------------
const logEl = document.getElementById('log');
// イベントログ: type別の色ドット付き行（state=accent / event=warn / error=accent-2 / info=faint）
const log = (m, type) => {
  const row = document.createElement('div'); row.className = 'lrow';
  const dot = document.createElement('span'); dot.className = 'ldot' + (type ? ' ' + type : '');
  const tx = document.createElement('span'); tx.textContent = new Date().toLocaleTimeString() + '  ' + m;
  row.appendChild(dot); row.appendChild(tx);
  logEl.prepend(row);
  while (logEl.childNodes.length > 80) logEl.removeChild(logEl.lastChild);
};
// トースト通知（右下・3秒でフェード。ガイドカード表示中はその上に積む）
function toast(m, kind) {
  const box = document.getElementById('toasts');
  const g = document.getElementById('guide');
  box.style.bottom = (g && g.style.display !== 'none' && g.offsetHeight) ? (g.offsetHeight + 28) + 'px' : '16px';
  const d = document.createElement('div');
  d.className = 'toast' + (kind === 'err' ? ' err' : '');
  d.textContent = m;
  box.appendChild(d);
  setTimeout(() => d.classList.add('fade'), 2600);
  setTimeout(() => d.remove(), 3000);
}
// 初回ガイドのステップ達成チェック
function guideStep(n) {
  const el = document.getElementById('gstep' + n);
  if (el) el.classList.add('done');
}
rive.RuntimeLoader.setWasmUrl('/rive.wasm');

let r = null, mode = 'sm', scrubAnim = null, scrubDur = 1, paused = false;
let sceneSpec = null;       // シーンJSONモード時の spec（編集の正本）
let imageSizes = {};        // 画像id → natural size
let gTree = null;           // rivのみモードの構造（/tree）
let sel = null;             // {src:'scene', kind, obj} | {src:'riv', node}
let keySel = null;          // {tr, k} 選択中のキーフレーム（タイムライン）
const cv = document.getElementById('cv');
const $ = (id) => document.getElementById(id);

// ---- Undo/Redo（シーンJSONモードのみ・最大50段） -------------------------------
const HISTORY_MAX = 50;
let history = [];
let redoStack = [];
function pushHistory() {
  if (!sceneSpec) return;
  try {
    history.push(JSON.parse(JSON.stringify(sceneSpec)));
    if (history.length > HISTORY_MAX) history.shift();
    redoStack = [];
  } catch {}
}
function afterHistoryChange() {
  sel = null; keySel = null;
  $('scene').value = JSON.stringify(sceneSpec, null, 2);
  buildTree(); renderInspector(); drawSelBox(); renderTimeline();
  doRebuild();
}
function performUndo() {
  if (!sceneSpec || !history.length) return;
  redoStack.push(JSON.parse(JSON.stringify(sceneSpec)));
  if (redoStack.length > HISTORY_MAX) redoStack.shift();
  sceneSpec = history.pop();
  afterHistoryChange();
  log(t('undoDone'));
  toast(t('undoDone'));
}
function performRedo() {
  if (!sceneSpec || !redoStack.length) return;
  history.push(JSON.parse(JSON.stringify(sceneSpec)));
  if (history.length > HISTORY_MAX) history.shift();
  sceneSpec = redoStack.pop();
  afterHistoryChange();
  log(t('redoDone'));
  toast(t('redoDone'));
}

let rivName = 'scene';
async function loadState() {
  const st = await (await fetch('/state')).json();
  sceneSpec = st.scene ?? null;
  imageSizes = st.imageSizes ?? {};
  if (st.rivName) rivName = st.rivName.toLowerCase().endsWith('.riv') ? st.rivName.slice(0, -4) : st.rivName;
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

// ---- 再生速度（アニメ単体再生モード限定・独自rAFループでscrubを駆動） -------------------
let playSpeed = 1;
let animRafId = null;
let animLastTs = null;
let animCurT = 0;
function stopAnimLoop() {
  if (animRafId) cancelAnimationFrame(animRafId);
  animRafId = null; animLastTs = null;
}
function animLoopStep(ts) {
  if (paused || mode !== 'anim' || !r) { animRafId = null; return; }
  if (animLastTs == null) animLastTs = ts;
  const dt = (ts - animLastTs) / 1000 * playSpeed;
  animLastTs = ts;
  animCurT += dt;
  if (scrubDur > 0 && animCurT > scrubDur) animCurT = animCurT % scrubDur;
  seekTo(animCurT);
  animRafId = requestAnimationFrame(animLoopStep);
}
function startAnimLoopIfNeeded() {
  if (mode === 'anim' && !paused && animRafId == null) {
    animLastTs = null;
    animRafId = requestAnimationFrame(animLoopStep);
  }
}

// ---- Rive 起動 ---------------------------------------------------------------
let bootSeq = 0; // 連続リロード時に破棄済みインスタンスの stale コールバックを無視する
function boot(artboard, smName, animName) {
  if (r) { try { r.cleanup(); } catch {} r = null; }
  const myBoot = ++bootSeq;
  stopAnimLoop();
  paused = false; $('pauseBtn').textContent = '⏸';
  const opts = {
    src: '/file.riv?' + Date.now(),
    canvas: cv,
    autoplay: true,
    autoBind: true,
    onLoad: () => {
      if (myBoot !== bootSeq) return;
      r.resizeDrawingSurfaceToCanvas();
      populate();
      const defaultSM = $('smSel').value;
      if (mode === 'sm' && !smName && defaultSM && defaultSM !== '-') {
        boot(artboard ?? r.activeArtboard, defaultSM);
        return;
      }
      if (mode === 'anim') {
        try { r.pause(); } catch {}
        animCurT = 0;
        startAnimLoopIfNeeded();
      }
      $('status').textContent = 'ready';
      guideStep(1);
      drawSelBox();
    },
    onLoadError: (e) => {
      if (myBoot !== bootSeq) return;
      $('status').textContent = 'load error'; log('load error: ' + e, 'error');
    },
  };
  if (artboard) opts.artboard = artboard;
  if (mode === 'sm') { if (smName) opts.stateMachines = smName; }
  else if (animName) { opts.animations = animName; }
  r = new rive.Rive(opts);
  r.on(rive.EventType.RiveEvent, (e) => log('event: ' + JSON.stringify(e.data), 'event'));
  r.on(rive.EventType.StateChange, (e) => log('state: ' + JSON.stringify(e.data), 'state'));
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
  box.classList.toggle('rz', ['shape', 'image', 'text'].includes(sel.kind));
}

// ---- 階層ツリー ---------------------------------------------------------------
// タイプ別インラインSVGアイコン（14px・stroke currentColor）
const KIND_ICON = {
  shape: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.5" y="2.5" width="9" height="9" rx="1"/></svg>',
  image: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2.5" width="10" height="9" rx="1"/><circle cx="5.2" cy="5.6" r="1"/><path d="M3 10.5 6 7.5l2 2 1.8-1.8 1.2 1.3"/></svg>',
  text: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M3.5 4V3h7v1M7 3v8M5.7 11h2.6"/></svg>',
  group: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M7 2.2 11.8 7 7 11.8 2.2 7z"/></svg>',
  bone: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="3.6" cy="3.6" r="1.6"/><circle cx="10.4" cy="10.4" r="1.6"/><path d="M4.8 4.8 9.2 9.2"/></svg>',
  nested: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2.5" y="2.5" width="9" height="9" rx="1"/><path d="M7 2.5v9M2.5 7h9"/></svg>',
  artboard: '<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M4.5 1.5v11M9.5 1.5v11M1.5 4.5h11M1.5 9.5h11"/></svg>',
};
const CHEV_SVG = '<svg viewBox="0 0 8 8"><path d="M2 1l4 3-4 3z" fill="currentColor"/></svg>';
const collapsedTree = new Set();
function buildTree() {
  const wrap = $('treeWrap');
  wrap.textContent = '';
  const addNode = (label, type, depth, onClick, isOn, kid) => {
    const d = document.createElement('div');
    d.className = 'tnode' + (isOn ? ' on' : '');
    d.style.paddingLeft = (5 + depth * 14) + 'px';
    if (kid && kid.hasKids) {
      const ch = document.createElement('span');
      ch.className = 'chev' + (collapsedTree.has(kid.key) ? ' closed' : '');
      ch.innerHTML = CHEV_SVG;
      ch.onclick = (ev) => {
        ev.stopPropagation();
        if (collapsedTree.has(kid.key)) collapsedTree.delete(kid.key); else collapsedTree.add(kid.key);
        buildTree();
      };
      d.appendChild(ch);
    } else {
      const sp = document.createElement('span'); sp.className = 'chev'; sp.style.visibility = 'hidden';
      d.appendChild(sp);
    }
    const ic = document.createElement('span'); ic.className = 'ticon'; ic.innerHTML = KIND_ICON[type] ?? KIND_ICON.shape;
    const nm = document.createElement('span'); nm.className = 'tname'; nm.textContent = label;
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
    const hasChildrenOf = (id) =>
      groups.some(x => x.parent === id) ||
      (ab.bones ?? []).some(b => b.parent === id) ||
      [ab.shapes, ab.images, ab.texts, ab.nested].some(list => (list ?? []).some(o => (o.parent ?? null) === id));
    const emitGroup = (g, depth) => {
      const kids = hasChildrenOf(g.id);
      addNode(g.id, 'group', depth, () => selectScene('group', g), sel?.obj === g, { key: 'g:' + g.id, hasKids: kids });
      if (collapsedTree.has('g:' + g.id)) return;
      for (const c of groups.filter(x => x.parent === g.id)) emitGroup(c, depth + 1);
      for (const b of (ab.bones ?? []).filter(b => b.parent === g.id)) emitBone(b, depth + 1);
      emitChildren(g.id, depth + 1);
    };
    const emitBone = (b, depth) => {
      const kids = hasChildrenOf(b.id);
      addNode(b.id, 'bone', depth, () => selectScene('bone', b), sel?.obj === b, { key: 'b:' + b.id, hasKids: kids });
      if (collapsedTree.has('b:' + b.id)) return;
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
function selectScene(kind, obj) { sel = { src: 'scene', kind, obj }; guideStep(2); buildTree(); renderInspector(); drawSelBox(); }
function selectRiv(node) { sel = { src: 'riv', node }; buildTree(); renderInspector(); drawSelBox(); }

let rebuildTimer = null;
function scheduleRebuild(delay = 300) {
  $('scene').value = JSON.stringify(sceneSpec, null, 2);
  $('dirtyBadge').style.display = 'inline-block';
  guideStep(2);
  if (rebuildTimer) clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(doRebuild, delay);
}
async function doRebuild() {
  if (!sceneSpec) return;
  $('status').textContent = 'building…';
  const res = await (await fetch('/rebuild', { method: 'POST', body: JSON.stringify(sceneSpec, null, 2) })).json();
  if (res.ok) { $('status').textContent = 'ready'; $('dirtyBadge').style.display = 'none'; }
  else { log(t('rebuildNg') + res.error, 'error'); toast(t('rebuildNg') + res.error, 'err'); $('status').textContent = 'error'; }
}
async function rivEditSet(index, name, value) {
  const res = await (await fetch('/edit', { method: 'POST', body: JSON.stringify([{ op: 'set', index, set: { [name]: value } }]) })).json();
  if (res.ok) log(t('editOk') + ': ' + name + ' = ' + value);
  else { log(t('editNg') + res.error, 'error'); toast(t('editNg') + res.error, 'err'); }
}

const round2 = (v) => Math.round(v * 100) / 100;
// 数値ラベルの横ドラッグで値変更（Figma/Rive流）
function bindLabelDrag(labelEl, input) {
  if (!input || input.type !== 'number' || !input._set) return;
  labelEl.classList.add('dragv');
  labelEl.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    labelEl.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startV = Number(input.value) || 0;
    const step = Number(input.step) || 1;
    let pushed = false, lastApply = 0;
    const move = (ev) => {
      const nv = round2(startV + (ev.clientX - startX) * step);
      input.value = nv;
      if (!pushed) { pushHistory(); pushed = true; }
      const now = Date.now();
      if (now - lastApply > 120) { input._set(nv); lastApply = now; }
    };
    const up = () => {
      try { labelEl.releasePointerCapture(e.pointerId); } catch {}
      labelEl.removeEventListener('pointermove', move);
      labelEl.removeEventListener('pointerup', up);
      if (pushed) input._set(Number(input.value));
    };
    labelEl.addEventListener('pointermove', move);
    labelEl.addEventListener('pointerup', up);
  });
}
function propRow(labelText, input) {
  const row = document.createElement('div'); row.className = 'prop';
  const l = document.createElement('label'); l.textContent = labelText;
  bindLabelDrag(l, input);
  row.appendChild(l); row.appendChild(input);
  return row;
}
// 2カラム（x/y・w/h 横並び）行
function pairRow(aLabel, aInput, bLabel, bInput) {
  const row = document.createElement('div'); row.className = 'prop2';
  const mk = (lb, inp) => {
    const c = document.createElement('div'); c.className = 'pcell';
    const l = document.createElement('label'); l.textContent = lb;
    bindLabelDrag(l, inp);
    c.appendChild(l); c.appendChild(inp);
    return c;
  };
  row.appendChild(mk(aLabel, aInput));
  if (bInput) row.appendChild(mk(bLabel, bInput));
  return row;
}
function inspSection(box, name) {
  const h = document.createElement('div'); h.className = 'isec'; h.textContent = name;
  box.appendChild(h);
}
function numField(get, set, step = 1) {
  const i = document.createElement('input'); i.type = 'number'; i.step = step; i.value = round2(get() ?? 0);
  i._set = set;
  i.onchange = () => { pushHistory(); set(Number(i.value)); };
  return i;
}
// 色スウォッチ + hex 入力の複合フィールド
function colorField(get, set) {
  const wrap = document.createElement('div'); wrap.className = 'colorCombo';
  const c = document.createElement('input'); c.type = 'color';
  const hx = document.createElement('input'); hx.type = 'text'; hx.spellcheck = false;
  const cur = String(get() ?? '#ffffff');
  c.value = cur.slice(0, 7); hx.value = cur;
  let armed = true;
  c.addEventListener('focus', () => { armed = true; });
  c.oninput = () => { if (armed) { pushHistory(); armed = false; } hx.value = c.value; set(c.value); };
  hx.onchange = () => {
    let v = hx.value.trim();
    if (v && v[0] !== '#') v = '#' + v;
    if (/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(v)) { pushHistory(); c.value = v.slice(0, 7); hx.value = v; set(v); }
    else { hx.value = String(get() ?? '#ffffff'); }
  };
  wrap.appendChild(c); wrap.appendChild(hx);
  return wrap;
}
function textField(get, set) {
  const i = document.createElement('input'); i.type = 'text'; i.value = get() ?? '';
  i.onchange = () => { pushHistory(); set(i.value); };
  return i;
}

function renderInspector() {
  const box = $('inspector');
  box.textContent = '';
  if (!sel) { const d = document.createElement('div'); d.className = 'hint'; d.textContent = t('noSel'); box.appendChild(d); return; }

  if (sel.src === 'scene') {
    const o = sel.obj, kind = sel.kind;
    const title = document.createElement('div');
    title.style.cssText = 'font-weight:600;margin-bottom:6px;color:var(--accent)';
    title.textContent = (o.id ?? o.name ?? kind) + '  (' + kind + ')';
    box.appendChild(title);
    const NF = (key, step = 1, dflt = 0) => numField(() => o[key] ?? dflt, (v) => { o[key] = v; scheduleRebuild(); }, step);
    const N = (label, key, step = 1, dflt = 0) => box.appendChild(propRow(label, NF(key, step, dflt)));
    if (kind === 'artboard') {
      const tgt = sceneSpec.artboard && !sceneSpec.artboards ? sceneSpec.artboard : o;
      inspSection(box, 'SIZE');
      box.appendChild(pairRow(
        'W', numField(() => tgt.width, (v) => { tgt.width = v; scheduleRebuild(); }),
        'H', numField(() => tgt.height, (v) => { tgt.height = v; scheduleRebuild(); })));
      const bgHolder = sceneSpec.artboards ? o : sceneSpec;
      inspSection(box, 'FILL');
      box.appendChild(propRow('background', colorField(() => bgHolder.backgroundColor, (v) => { bgHolder.backgroundColor = v; scheduleRebuild(); })));
      return;
    }
    inspSection(box, 'TRANSFORM');
    box.appendChild(pairRow('X', NF('x'), 'Y', NF('y')));
    if (kind === 'shape') {
      if (o.width !== undefined || o.type !== 'polygon') {
        box.appendChild(pairRow('W', NF('width'), 'H', NF('height')));
      }
      N('rotation', 'rotation');
      if (o.type === 'rect') N('cornerRadius', 'cornerRadius');
      N('opacity', 'opacity', 0.05, 1);
      inspSection(box, 'FILL');
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
        inspSection(box, 'TEXT');
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
    title.style.cssText = 'font-weight:600;margin-bottom:2px;color:var(--accent)';
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
let resizeDrag = null;
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
  drag = { startX: ax, startY: ay, ox: hit.o.x, oy: hit.o.y, moved: false, historyPushed: false };
  e.preventDefault();
});
document.querySelectorAll('.rzHandle').forEach((h) => {
  h.addEventListener('pointerdown', (e) => {
    if (!sel || sel.src !== 'scene' || !['shape', 'image', 'text'].includes(sel.kind)) return;
    e.stopPropagation(); e.preventDefault();
    const ab = abSpec();
    const bb = bboxOf(sel.kind, sel.obj, ab);
    const m = stageMap();
    const ax = (e.clientX - m.stageRect.left - m.ox) / m.s;
    const ay = (e.clientY - m.stageRect.top - m.oy) / m.s;
    resizeDrag = {
      corner: h.dataset.corner, kind: sel.kind, o: sel.obj,
      startW: bb.w, startH: bb.h, startCx: sel.obj.x, startCy: sel.obj.y,
      startAx: ax, startAy: ay, historyPushed: false,
    };
  });
});
function applyResize(rd, newW, newH, cx, cy) {
  const o = rd.o;
  if (rd.kind === 'shape') {
    if (o.type === 'polygon' && o.points?.length) {
      const rx = newW / (rd.startW || 1), ry = newH / (rd.startH || 1);
      o.points = o.points.map((p) => ({ ...p, x: round2(p.x * rx), y: round2(p.y * ry) }));
    } else {
      o.width = round2(newW); o.height = round2(newH);
    }
  } else if (rd.kind === 'image') {
    const ratio = (newW / (rd.startW || 1) + newH / (rd.startH || 1)) / 2;
    o.scale = Math.max(0.01, round2((o.scale ?? 1) * ratio * 100) / 100);
  } else if (rd.kind === 'text') {
    if (o.width !== undefined) {
      o.width = round2(newW);
      if (o.height !== undefined) o.height = round2(newH);
    } else if (o.runs?.[0]) {
      const ratio = (newW / (rd.startW || 1) + newH / (rd.startH || 1)) / 2;
      o.runs[0].fontSize = Math.max(4, round2((o.runs[0].fontSize ?? 32) * ratio));
    }
  }
  o.x = round2(cx); o.y = round2(cy);
}
window.addEventListener('pointermove', (e) => {
  if (drag && sel && sel.src === 'scene') {
    if (!drag.historyPushed) { pushHistory(); drag.historyPushed = true; }
    document.body.classList.add('grabbing');
    $('selBox').classList.add('dragging');
    const m = stageMap();
    const ax = (e.clientX - m.stageRect.left - m.ox) / m.s;
    const ay = (e.clientY - m.stageRect.top - m.oy) / m.s;
    sel.obj.x = round2(drag.ox + (ax - drag.startX));
    sel.obj.y = round2(drag.oy + (ay - drag.startY));
    drag.moved = true;
    drawSelBox();
    scheduleRebuild(160);
    return;
  }
  if (resizeDrag) {
    if (!resizeDrag.historyPushed) { pushHistory(); resizeDrag.historyPushed = true; }
    const m = stageMap();
    const ax = (e.clientX - m.stageRect.left - m.ox) / m.s;
    const ay = (e.clientY - m.stageRect.top - m.oy) / m.s;
    const dx = ax - resizeDrag.startAx, dy = ay - resizeDrag.startAy;
    const signX = resizeDrag.corner.includes('e') ? 1 : -1;
    const signY = resizeDrag.corner.includes('s') ? 1 : -1;
    const newW = Math.max(4, resizeDrag.startW + signX * dx);
    const newH = Math.max(4, resizeDrag.startH + signY * dy);
    const cx = resizeDrag.startCx + signX * (newW - resizeDrag.startW) / 2;
    const cy = resizeDrag.startCy + signY * (newH - resizeDrag.startH) / 2;
    applyResize(resizeDrag, newW, newH, cx, cy);
    renderInspector();
    drawSelBox();
    scheduleRebuild(160);
  }
});
window.addEventListener('pointerup', () => {
  if (drag?.moved) { renderInspector(); scheduleRebuild(0); }
  drag = null;
  if (resizeDrag) { scheduleRebuild(0); resizeDrag = null; }
  document.body.classList.remove('grabbing');
  $('selBox').classList.remove('dragging');
});
window.addEventListener('resize', drawSelBox);

// ---- ペインのドラッグリサイズ（min 180/240・localStorage記憶） --------------------
// 注意: #center は min-width:0 のまま維持（canvas の intrinsic width による押し出し防止）
function setupGutter(id, paneId, min, max, storageKey, fromRight) {
  const pane = $(paneId);
  const saved = Number(localStorage.getItem(storageKey));
  if (saved >= min && saved <= max) pane.style.width = saved + 'px';
  $(id).addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const g = $(id);
    g.setPointerCapture(e.pointerId);
    const move = (ev) => {
      const w = Math.max(min, Math.min(max, fromRight ? (window.innerWidth - ev.clientX) : ev.clientX));
      pane.style.width = w + 'px';
      drawSelBox();
    };
    const up = () => {
      g.removeEventListener('pointermove', move);
      g.removeEventListener('pointerup', up);
      localStorage.setItem(storageKey, parseInt(pane.style.width, 10));
      drawSelBox();
    };
    g.addEventListener('pointermove', move);
    g.addEventListener('pointerup', up);
  });
}
setupGutter('gutterL', 'left', 180, 480, 'rive-mcp-pane-left', false);
setupGutter('gutterR', 'right', 240, 520, 'rive-mcp-pane-right', true);

// ---- キーボード操作（矢印移動・削除・Undo/Redo。入力欄フォーカス時は無効） ------------
function isEditableFocus() {
  const ae = document.activeElement;
  if (!ae) return false;
  return ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable;
}
function genId(prefix) {
  const ab = abSpec();
  const all = new Set();
  for (const list of [ab?.shapes, ab?.images, ab?.texts, ab?.groups, ab?.bones, ab?.nested]) {
    for (const o of (list ?? [])) all.add(o.id);
  }
  let n = 1;
  while (all.has(prefix + n)) n++;
  return prefix + n;
}
function addShape(type) {
  if (!sceneSpec) return;
  pushHistory();
  const ab = abSpec();
  const { w, h } = abDims();
  const o = { id: genId(type), type, x: round2(w / 2), y: round2(h / 2), width: 80, height: 80, fill: { color: '#e94560' } };
  if (!ab.shapes) ab.shapes = [];
  ab.shapes.push(o);
  selectScene('shape', o);
  scheduleRebuild(0);
}
function addText() {
  if (!sceneSpec) return;
  pushHistory();
  const ab = abSpec();
  const { w, h } = abDims();
  const o = { id: genId('text'), x: round2(w / 2), y: round2(h / 2), runs: [{ text: 'Text', fontSize: 32, color: '#ffffff' }] };
  if (!ab.texts) ab.texts = [];
  ab.texts.push(o);
  selectScene('text', o);
  scheduleRebuild(0);
}
function deleteSelectedObject() {
  if (!sceneSpec || !sel || sel.src !== 'scene') return;
  const listKey = { shape: 'shapes', text: 'texts', image: 'images', group: 'groups' }[sel.kind];
  if (!listKey) return;
  const ab = abSpec();
  const list = ab[listKey];
  const idx = (list ?? []).findIndex((o) => o.id === sel.obj.id);
  if (idx < 0) return;
  pushHistory();
  list.splice(idx, 1);
  sel = null;
  buildTree(); renderInspector(); drawSelBox();
  scheduleRebuild(0);
  log(t('objDeleted'));
  toast(t('objDeleted'));
}
function deleteSelectedKeyframe() {
  if (!keySel) return false;
  const { tr, k } = keySel;
  if (!tr.keyframes || tr.keyframes.length <= 1) { log(t('kfDeleteMin')); toast(t('kfDeleteMin'), 'err'); return true; }
  const idx = tr.keyframes.indexOf(k);
  if (idx < 0) return false;
  pushHistory();
  tr.keyframes.splice(idx, 1);
  keySel = null;
  renderTimeline();
  scheduleRebuild(0);
  return true;
}
window.addEventListener('keydown', (e) => {
  if (isEditableFocus()) return;
  const mod = e.ctrlKey || e.metaKey;
  if (mod && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) { e.preventDefault(); performUndo(); return; }
  if (mod && ((e.key === 'y' || e.key === 'Y') || (e.shiftKey && (e.key === 'z' || e.key === 'Z')))) { e.preventDefault(); performRedo(); return; }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (deleteSelectedKeyframe()) { e.preventDefault(); return; }
    if (sel && sel.src === 'scene') { e.preventDefault(); deleteSelectedObject(); }
    return;
  }
  if (!sceneSpec || !sel || sel.src !== 'scene' || sel.kind === 'artboard') return;
  const step = e.shiftKey ? 10 : 1;
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    pushHistory();
    if (e.key === 'ArrowUp') sel.obj.y = round2(sel.obj.y - step);
    else if (e.key === 'ArrowDown') sel.obj.y = round2(sel.obj.y + step);
    else if (e.key === 'ArrowLeft') sel.obj.x = round2(sel.obj.x - step);
    else sel.obj.x = round2(sel.obj.x + step);
    renderInspector(); drawSelBox();
    scheduleRebuild();
  }
});
$('addRect').onclick = () => addShape('rect');
$('addEllipse').onclick = () => addShape('ellipse');
$('addText').onclick = () => addText();
$('undoBtn').onclick = () => performUndo();
$('redoBtn').onclick = () => performRedo();

// ---- タイムライン --------------------------------------------------------------
// 隣接キーフレーム間の線形補間（ダブルクリック追加時の既定値の近似算出用。イージング形状は無視）
function interpAt(tr, frame) {
  const kfs = (tr.keyframes ?? []).slice().sort((a, b) => a.frame - b.frame);
  if (!kfs.length) return 0;
  if (frame <= kfs[0].frame) return kfs[0].value ?? 0;
  if (frame >= kfs[kfs.length - 1].frame) return kfs[kfs.length - 1].value ?? 0;
  for (let i = 0; i < kfs.length - 1; i++) {
    const a = kfs[i], b = kfs[i + 1];
    if (frame >= a.frame && frame <= b.frame) {
      const f = (frame - a.frame) / ((b.frame - a.frame) || 1);
      const va = a.value ?? 0, vb = b.value ?? 0;
      return va + (vb - va) * f;
    }
  }
  return kfs[kfs.length - 1].value ?? 0;
}
function nearestColor(tr, frame) {
  const kfs = (tr.keyframes ?? []).slice().sort((a, b) => a.frame - b.frame);
  if (!kfs.length) return '#ffffff';
  let best = kfs[0];
  for (const k of kfs) if (Math.abs(k.frame - frame) < Math.abs(best.frame - frame)) best = k;
  return best.color ?? '#ffffff';
}
function addKeyframeAt(tr, frame) {
  if (!tr.keyframes) tr.keyframes = [];
  let existing = tr.keyframes.find((k) => k.frame === frame);
  if (tr.property === 'fillColor') {
    const col = existing?.color ?? nearestColor(tr, frame);
    if (existing) existing.color = col; else tr.keyframes.push({ frame, color: col });
  } else {
    const val = round2(interpAt(tr, frame));
    if (existing) existing.value = val; else tr.keyframes.push({ frame, value: val });
  }
  tr.keyframes.sort((a, b) => a.frame - b.frame);
  return tr.keyframes.find((k) => k.frame === frame);
}
let kfDrag = null;
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
  // ルーラー行（フレーム目盛 10刻み + 再生ヘッドつまみ）
  {
    const row = document.createElement('div'); row.className = 'trow';
    const lb = document.createElement('div'); lb.className = 'tlabel';
    lb.textContent = anim.name + ' · ' + (anim.duration ?? 60) + 'f';
    const lane = document.createElement('div'); lane.className = 'tlane ruler';
    const durF = anim.duration || 1;
    for (let f = 0; f <= durF; f += 10) {
      const tick = document.createElement('div'); tick.className = 'rtick';
      tick.style.left = (100 * f / durF) + '%';
      const num = document.createElement('span'); num.textContent = f;
      tick.appendChild(num);
      lane.appendChild(tick);
    }
    const cur = document.createElement('div'); cur.className = 'tcur'; cur.style.left = '0%';
    const head = document.createElement('div'); head.className = 'phead'; head.style.left = '0%';
    lane.appendChild(cur); lane.appendChild(head);
    // ルーラーはドラッグでスクラブ
    lane.addEventListener('pointerdown', (ev) => {
      lane.setPointerCapture(ev.pointerId);
      const scrubAt = (x) => {
        const rect = lane.getBoundingClientRect();
        const tsec = ((x - rect.left) / rect.width) * durS;
        animCurT = Math.max(0, Math.min(durS, tsec));
        seekTo(animCurT);
      };
      scrubAt(ev.clientX);
      const move = (e2) => scrubAt(e2.clientX);
      const up = () => { lane.removeEventListener('pointermove', move); lane.removeEventListener('pointerup', up); };
      lane.addEventListener('pointermove', move);
      lane.addEventListener('pointerup', up);
    });
    row.appendChild(lb); row.appendChild(lane);
    tl.appendChild(row);
  }
  for (const tr of anim.tracks ?? []) {
    const row = document.createElement('div'); row.className = 'trow';
    const lb = document.createElement('div'); lb.className = 'tlabel'; lb.textContent = tr.target + ' · ' + tr.property;
    const lane = document.createElement('div'); lane.className = 'tlane';
    for (const k of tr.keyframes ?? []) {
      const d = document.createElement('div'); d.className = 'tkey' + (keySel && keySel.tr === tr && keySel.k === k ? ' sel' : '');
      d.style.left = (100 * k.frame / (anim.duration || 1)) + '%';
      d.title = 'f' + k.frame + (k.value !== undefined ? ' = ' + k.value : '') + (k.easing ? ' (' + k.easing + ')' : '');
      d.addEventListener('pointerdown', (ev) => {
        ev.stopPropagation(); ev.preventDefault();
        const laneRect = lane.getBoundingClientRect();
        kfDrag = { tr, k, anim, startClientX: ev.clientX, startFrame: k.frame, laneWidth: laneRect.width, moved: false, historyPushed: false };
      });
      lane.appendChild(d);
    }
    const cur = document.createElement('div'); cur.className = 'tcur'; cur.style.left = '0%';
    lane.appendChild(cur);
    lane.onclick = (ev) => {
      if (ev.target.classList.contains('tkey')) return;
      const rect = lane.getBoundingClientRect();
      seekTo(((ev.clientX - rect.left) / rect.width) * durS);
    };
    lane.ondblclick = (ev) => {
      if (ev.target.classList.contains('tkey')) return;
      const rect = lane.getBoundingClientRect();
      const frac = (ev.clientX - rect.left) / rect.width;
      const frame = Math.max(0, Math.min(anim.duration || 0, Math.round(frac * (anim.duration || 1))));
      pushHistory();
      const k = addKeyframeAt(tr, frame);
      keySel = { tr, k };
      renderTimeline();
      seekTo(frame / (anim.fps ?? 60));
      scheduleRebuild(0);
    };
    row.appendChild(lb); row.appendChild(lane);
    tl.appendChild(row);
  }
}
window.addEventListener('pointermove', (e) => {
  if (!kfDrag) return;
  const dx = e.clientX - kfDrag.startClientX;
  if (!kfDrag.moved && Math.abs(dx) < 3) return;
  if (!kfDrag.historyPushed) { pushHistory(); kfDrag.historyPushed = true; }
  kfDrag.moved = true;
  const durFrames = kfDrag.anim.duration || 1;
  const deltaFrames = (dx / (kfDrag.laneWidth || 1)) * durFrames;
  let nf = Math.round(kfDrag.startFrame + deltaFrames);
  nf = Math.max(0, Math.min(durFrames, nf));
  kfDrag.k.frame = nf;
  renderTimeline();
  scheduleRebuild(160);
});
window.addEventListener('pointerup', () => {
  if (!kfDrag) return;
  const { tr, k, anim, moved } = kfDrag;
  keySel = { tr, k };
  if (!moved) {
    seekTo(k.frame / (anim.fps ?? 60));
    renderTimeline();
  } else {
    scheduleRebuild(0);
    renderTimeline();
  }
  kfDrag = null;
});
function seekTo(tsec) {
  tsec = Math.max(0, Math.min(scrubDur, tsec));
  try { r.scrub(scrubAnim, tsec); } catch {}
  $('scrub').value = scrubDur ? tsec / scrubDur : 0;
  $('time').textContent = tsec.toFixed(2) + 's';
  const pct = (100 * tsec / scrubDur) + '%';
  document.querySelectorAll('.tcur, .phead').forEach(c => { c.style.left = pct; });
}

// ---- 操作 ----------------------------------------------------------------------
$('tabTree').onclick = () => { $('tabTree').classList.add('on'); $('tabPlay').classList.remove('on'); $('treeWrap').style.display = 'block'; $('playPane').style.display = 'none'; };
$('tabPlay').onclick = () => { $('tabPlay').classList.add('on'); $('tabTree').classList.remove('on'); $('treeWrap').style.display = 'none'; $('playPane').style.display = 'block'; };
$('artboardSel').onchange = () => { mode = 'sm'; sel = null; boot($('artboardSel').value); renderTimeline(); };
$('smSel').onchange = () => { mode = 'sm'; const v = $('smSel').value; boot($('artboardSel').value, v && v !== '-' ? v : undefined); };
$('playAnim').onclick = () => {
  mode = 'anim';
  scrubAnim = $('animSel').value;
  boot($('artboardSel').value, null, scrubAnim);
  $('scrub').disabled = false;
  renderTimeline();
};
$('backSM').onclick = () => { mode = 'sm'; $('scrub').disabled = true; const v = $('smSel').value; boot($('artboardSel').value, v && v !== '-' ? v : undefined); renderTimeline(); };
$('scrub').oninput = () => {
  if (!r || mode !== 'anim') return;
  animCurT = Number($('scrub').value) * scrubDur;
  seekTo(animCurT);
};
$('pauseBtn').onclick = () => {
  if (!r) return;
  paused = !paused;
  if (mode === 'anim') {
    if (paused) stopAnimLoop(); else startAnimLoopIfNeeded();
  } else {
    try { paused ? r.pause() : r.play(); } catch {}
  }
  $('pauseBtn').textContent = paused ? '▶' : '⏸';
  log(paused ? t('paused') : t('resumed'));
};
$('speedSel').onchange = () => { playSpeed = Number($('speedSel').value); };
$('zoom').oninput = () => { cv.style.transform = 'scale(' + $('zoom').value + ')'; drawSelBox(); };
$('zoomReset').onclick = () => { $('zoom').value = 1; cv.style.transform = ''; drawSelBox(); };
$('snap').onclick = () => {
  const a = document.createElement('a');
  a.download = rivName + '.png';
  a.href = cv.toDataURL('image/png');
  a.click();
};

// ---- エクスポート（APNG / GIF / WebM。対象=選択中アニメ、未選択なら先頭。30fps・1ループ） ----
let progToast = null;
function showProgress(msg) {
  if (!progToast) {
    progToast = document.createElement('div');
    progToast.className = 'toast';
    document.getElementById('toasts').appendChild(progToast);
  }
  progToast.textContent = msg;
}
function hideProgress() { if (progToast) { progToast.remove(); progToast = null; } }
function saveBlob(blob, name) {
  const a = document.createElement('a');
  a.download = name;
  a.href = URL.createObjectURL(blob);
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function b64FromBytes(u8) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < u8.length; i += CH) s += String.fromCharCode.apply(null, u8.subarray(i, i + CH));
  return btoa(s);
}
const raf2 = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
function waitReady(timeout = 6000) {
  return new Promise((resolve) => {
    const t0 = Date.now();
    const iv = setInterval(() => {
      if ($('status').textContent === 'ready' || Date.now() - t0 > timeout) { clearInterval(iv); resolve(); }
    }, 60);
  });
}
// アニメ単体再生モードに切替（未選択時は先頭アニメ）。復帰情報を返す
async function ensureAnimMode() {
  if (mode === 'anim' && scrubAnim) return { restore: null };
  const anims = (abSpec()?.animations ?? []);
  if (!anims.length) return { error: true };
  const restore = { mode, smName: $('smSel').value };
  mode = 'anim';
  scrubAnim = anims[0].name;
  boot($('artboardSel').value, null, scrubAnim);
  $('scrub').disabled = false;
  renderTimeline();
  await waitReady();
  return { restore };
}
function restoreAfterExport(st) {
  if (st && st.restore) {
    mode = st.restore.mode;
    $('scrub').disabled = true;
    boot($('artboardSel').value, st.restore.smName && st.restore.smName !== '-' ? st.restore.smName : undefined);
    renderTimeline();
  }
}
// 0..duration を等間隔にシークしてフレームを収集（wantRgba: GIF用 raw RGBA / それ以外は PNG bytes）
async function captureFrames(wantRgba) {
  const st = await ensureAnimMode();
  if (st.error) { toast(t('expNoAnim'), 'err'); return null; }
  const wasPaused = paused;
  paused = true; stopAnimLoop();
  const prevT = animCurT;
  const N = Math.max(2, Math.min(300, Math.round(scrubDur * 30)));
  const scale = wantRgba ? Math.min(1, 480 / (cv.width || 480)) : 1;
  const ow = Math.max(2, Math.round(cv.width * scale));
  const oh = Math.max(2, Math.round(cv.height * scale));
  const oc = document.createElement('canvas'); oc.width = ow; oc.height = oh;
  const octx = oc.getContext('2d', { willReadFrequently: true });
  // GIFは透過を持てないため背景色を合成（シーンの backgroundColor を優先）
  const bg = (sceneSpec && ((abSpec() || {}).backgroundColor || sceneSpec.backgroundColor)) || '#141419';
  const frames = [];
  for (let i = 0; i < N; i++) {
    seekTo((i / N) * scrubDur);
    await raf2();
    octx.fillStyle = bg; octx.fillRect(0, 0, ow, oh);
    octx.drawImage(cv, 0, 0, ow, oh);
    if (wantRgba) {
      frames.push(new Uint8Array(octx.getImageData(0, 0, ow, oh).data.buffer));
    } else {
      const blob = await new Promise((res) => oc.toBlob(res, 'image/png'));
      frames.push(new Uint8Array(await blob.arrayBuffer()));
    }
    showProgress(t('expProg') + (i + 1) + '/' + N);
  }
  paused = wasPaused;
  animCurT = prevT;
  if (!st.restore && !paused) startAnimLoopIfNeeded();
  return { frames, width: ow, height: oh, delayMs: Math.max(10, Math.round(scrubDur * 1000 / N)), state: st };
}
async function exportEncoded(path, payloadOf, ext) {
  let cap = null;
  try {
    cap = await captureFrames(path === '/export/gif');
    if (!cap) return;
    const res = await fetch(path, { method: 'POST', body: JSON.stringify(payloadOf(cap)) });
    if (!res.ok) throw new Error((await res.text()).slice(0, 200));
    saveBlob(await res.blob(), rivName + ext);
    toast(t('expDone'));
  } catch (e) {
    toast(t('expFail') + (e && e.message ? e.message : e), 'err');
  } finally {
    hideProgress();
    if (cap) restoreAfterExport(cap.state);
  }
}
$('expApng').onclick = () => exportEncoded('/export/apng',
  (cap) => ({ frames: cap.frames.map(b64FromBytes), delayMs: cap.delayMs, loops: 0 }), '.apng');
$('expGif').onclick = () => exportEncoded('/export/gif',
  (cap) => ({ frames: cap.frames.map(b64FromBytes), width: cap.width, height: cap.height, delayMs: cap.delayMs }), '.gif');
$('expWebm').onclick = async () => {
  const st = await ensureAnimMode();
  if (st.error) { toast(t('expNoAnim'), 'err'); return; }
  const prevPaused = paused, prevSpeed = playSpeed, prevT = animCurT;
  try {
    // リアルタイム録画: 1x でアニメ1ループ分
    playSpeed = 1; paused = false;
    animCurT = 0; seekTo(0);
    stopAnimLoop(); startAnimLoopIfNeeded();
    const stream = cv.captureStream(30);
    let mt = 'video/webm;codecs=vp9';
    if (!MediaRecorder.isTypeSupported(mt)) mt = 'video/webm;codecs=vp8';
    if (!MediaRecorder.isTypeSupported(mt)) mt = 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: mt, videoBitsPerSecond: 6000000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise((res) => { rec.onstop = res; });
    rec.start(200);
    showProgress(t('expProg') + 'WebM');
    await new Promise((res) => setTimeout(res, Math.max(400, scrubDur * 1000)));
    rec.stop();
    await stopped;
    saveBlob(new Blob(chunks, { type: 'video/webm' }), rivName + '.webm');
    toast(t('expDone'));
  } catch (e) {
    toast(t('expFail') + (e && e.message ? e.message : e), 'err');
  } finally {
    hideProgress();
    playSpeed = prevSpeed; paused = prevPaused; animCurT = prevT;
    if (paused) stopAnimLoop();
    restoreAfterExport(st);
  }
};
$('logClear').onclick = () => { logEl.textContent = ''; };
$('fmt').onclick = () => {
  try { $('scene').value = JSON.stringify(JSON.parse($('scene').value), null, 2); }
  catch (e) { log(t('jsonError') + e.message, 'error'); toast(t('jsonError') + e.message, 'err'); }
};
$('apply').onclick = async () => {
  try { sceneSpec = JSON.parse($('scene').value); } catch (e) { log(t('jsonError') + e.message, 'error'); toast(t('jsonError') + e.message, 'err'); return; }
  sel = null; renderInspector();
  $('status').textContent = 'building…';
  const res = await (await fetch('/rebuild', { method: 'POST', body: JSON.stringify(sceneSpec, null, 2) })).json();
  if (res.ok) {
    log(t('rebuildOk') + ' (' + res.bytes + ' bytes)' + (res.warnings?.length ? t('warn') + res.warnings.join('; ') : ''));
    toast(t('rebuildOk'));
    $('dirtyBadge').style.display = 'none';
  }
  else { log(t('rebuildNg') + res.error, 'error'); toast(t('rebuildNg') + res.error, 'err'); $('status').textContent = 'error'; }
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
    toast(t('notesSent'));
    guideStep(3);
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
    keySel = null;
    const smv = $('smSel').value;
    if (mode === 'sm') boot($('artboardSel').value, smv && smv !== '-' ? smv : undefined);
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
    toast(t('notesTaken'));
  } else { $('status').textContent = 'ready'; }
};
sse.onopen = () => { $('connDot').classList.remove('off'); $('connDot').title = t('connT'); };
sse.onerror = () => { $('connDot').classList.add('off'); $('connDot').title = t('connOffT'); };

applyLang();
loadState().then(() => boot());
</script></body></html>`;

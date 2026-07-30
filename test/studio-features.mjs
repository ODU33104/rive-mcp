// 軽量テスト: Studio の新規エンドポイント(アセット差し替え/スナップショット履歴)を
// HTTP経由で直接検証する。riveHost(headless Chromium)は起動しない — サーバー側の
// バイナリ処理(rivAssets.replaceAssetBytes)とファイルI/O(/api/snapshots系)のみが対象。
// dist/ を直接importする(CLAUDE.md 落とし穴7: セッション中のMCPサーバーはビルド後も
// 古いdistを使い続けるため、動作検証はこのように直接importして行う)。
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";
import zlib from "node:zlib";

// 最小のPNGエンコーダ(単色べた塗り)。差し替え検証用の確実に有効なPNGバイト列を作る。
function makePng(width, height, [r, g, b, a]) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const typeBuf = Buffer.from(type, "ascii");
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
    return Buffer.concat([len, typeBuf, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type: RGBA
  const rowBytes = width * 4;
  const raw = Buffer.alloc((rowBytes + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * (rowBytes + 1); // [0]=filter type(none)
    for (let x = 0; x < width; x++) {
      const px = rowStart + 1 + x * 4;
      raw[px] = r; raw[px + 1] = g; raw[px + 2] = b; raw[px + 3] = a;
    }
  }
  const idat = zlib.deflateSync(raw);
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", Buffer.alloc(0))]);
}

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const distStudio = pathToFileURL(join(root, "dist", "studio.js")).href;
const distBinary = pathToFileURL(join(root, "dist", "rivBinary.js")).href;
const distAssets = pathToFileURL(join(root, "dist", "rivAssets.js")).href;
const distEdit = pathToFileURL(join(root, "dist", "rivEdit.js")).href;

const { startStudio, stopStudio } = await import(distStudio);
const { readRiv } = await import(distBinary);
const { extractAssets } = await import(distAssets);
const { editRiv } = await import(distEdit);

let failures = 0;
function check(label, cond, detail = "") {
  const mark = cond ? "PASS" : "FAIL";
  if (!cond) failures++;
  console.log(`[${mark}] ${label}${detail ? " — " + detail : ""}`);
}

// 1x1 の最小PNG(赤)。差し替え検証用。
const PNG_1x1 = makePng(1, 1, [255, 0, 0, 255]);
// 2x2 の最小PNG(緑)。「2回目の差し替え」用(スナップショット復元で消えることを確認する対象)。
const PNG_2x2 = makePng(2, 2, [0, 255, 0, 255]);

const scratch = mkdtempSync(join(tmpdir(), "rive-mcp-studio-test-"));
const workRiv = join(scratch, "e2e-image.riv");
writeFileSync(workRiv, readFileSync(join(root, "samples", "e2e-image.riv")));
const origBytes = readFileSync(workRiv);
const origDump = readRiv(new Uint8Array(origBytes), { tolerant: true });

const PORT = 8799;
let handle = null;

async function api(path, opts) {
  const res = await fetch(`http://localhost:${PORT}${path}`, opts);
  return { status: res.status, json: await res.json() };
}

try {
  handle = startStudio({ rivPath: workRiv, port: PORT });
  check("studio started", !!handle.url, handle.url);

  // ---- アセット差し替え ----------------------------------------------------
  const list1 = await api("/api/assets");
  check("GET /api/assets returns the embedded image", list1.json.assets?.length === 1, JSON.stringify(list1.json));
  const asset = list1.json.assets?.[0];
  check("asset has expected name/ext/index", asset?.name === "img" && asset?.ext === "png" && asset?.index === 1);

  const rep1 = await api("/api/replace-asset", {
    method: "POST",
    body: JSON.stringify({ index: asset.index, dataBase64: PNG_1x1.toString("base64") }),
  });
  check("POST /api/replace-asset (1x1) ok", rep1.json.ok === true, JSON.stringify(rep1.json));

  const list2 = await api("/api/assets");
  const asset2 = list2.json.assets?.[0];
  check(
    "asset bytes updated to the new PNG",
    Buffer.from(asset2?.dataBase64 ?? "", "base64").equals(PNG_1x1),
    `len=${asset2?.dataBase64?.length}`
  );
  check("ImageAsset width/height updated to new image size (best-effort)", asset2?.width === 1 && asset2?.height === 1);

  // 無損失性: バイナリを再パースして、アセット以外のオブジェクト列(型・個数・名前)が変化していないことを確認
  const afterDump = readRiv(new Uint8Array(readFileSync(workRiv)), { tolerant: true });
  check("object count unchanged after replace", afterDump.objects.length === origDump.objects.length,
    `${afterDump.objects.length} vs ${origDump.objects.length}`);
  const typesMatch = afterDump.objects.every((o, i) => o.typeName === origDump.objects[i].typeName);
  check("object type sequence unchanged after replace (lossless)", typesMatch);
  const meshVertexUnchanged = afterDump.objects[7].typeName === "MeshVertex" &&
    JSON.stringify(afterDump.objects[7].properties) === JSON.stringify(origDump.objects[7].properties);
  check("unrelated object (MeshVertex) byte-identical after replace", meshVertexUnchanged);

  // ---- スナップショット履歴 ------------------------------------------------
  const empty = await api("/api/snapshots");
  check("snapshot list starts empty", Array.isArray(empty.json.snapshots) && empty.json.snapshots.length === 0);

  const save1 = await api("/api/snapshots", { method: "POST", body: JSON.stringify({ name: "after-1x1" }) });
  check("POST /api/snapshots (save) ok", save1.json.ok === true && save1.json.snapshots.length === 1, JSON.stringify(save1.json));
  const snapId = save1.json.snapshots[0].id;
  check("saved snapshot has the given name", save1.json.snapshots[0].name === "after-1x1");

  // スナップショット後にさらに書き換え、復元でロールバックされることを確認する
  const rep2 = await api("/api/replace-asset", {
    method: "POST",
    body: JSON.stringify({ index: asset.index, dataBase64: PNG_2x2.toString("base64") }),
  });
  check("POST /api/replace-asset (2x2, post-snapshot mutation) ok", rep2.json.ok === true);
  const midAssets = extractAssets(new Uint8Array(readFileSync(workRiv)));
  check("file reflects the 2x2 mutation before restore", Buffer.from(midAssets[0].bytes).equals(PNG_2x2));

  const restore = await api("/api/snapshots/restore", { method: "POST", body: JSON.stringify({ id: snapId }) });
  check("POST /api/snapshots/restore ok", restore.json.ok === true, JSON.stringify(restore.json));
  const restoredAssets = extractAssets(new Uint8Array(readFileSync(workRiv)));
  check("restore rolled back to the 1x1 PNG (snapshot content)", Buffer.from(restoredAssets[0].bytes).equals(PNG_1x1));

  const del = await api("/api/snapshots/delete", { method: "POST", body: JSON.stringify({ id: snapId }) });
  check("POST /api/snapshots/delete ok and list empties", del.json.ok === true && del.json.snapshots.length === 0, JSON.stringify(del.json));

  // ---- エラー系: 存在しないindex/idはok:falseで返る(サーバーが落ちない) ----
  const badAsset = await api("/api/replace-asset", { method: "POST", body: JSON.stringify({ index: 999, dataBase64: PNG_1x1.toString("base64") }) });
  check("replace-asset with bad index returns ok:false (not a crash)", badAsset.json.ok === false);
  const badRestore = await api("/api/snapshots/restore", { method: "POST", body: JSON.stringify({ id: "nope" }) });
  check("snapshot restore with bad id returns ok:false (not a crash)", badRestore.json.ok === false);

  // ---- マルチアートボードの下地データ(タブはクライアント側でr.contents.artboardsから描画する。
  // ここではその情報源である /tree が複数アートボードを正しく列挙することだけを確認する) ----
  const vehiclesWork = join(scratch, "vehicles.riv");
  writeFileSync(vehiclesWork, readFileSync(join(root, "samples", "vehicles.riv")));
  const PORT2 = PORT + 1; // 別ポート: 直前サーバーのclose()はソケット解放を待たないため同一ポート即再利用はレースの元
  const handle2 = startStudio({ rivPath: vehiclesWork, port: PORT2 });
  const tree = await (await fetch(`http://localhost:${PORT2}/tree`)).json();
  const abNames = (tree.artboards ?? []).map((a) => a.name);
  check("multi-artboard file exposes both artboards via /tree", abNames.includes("Truck") && abNames.includes("Jeep"), JSON.stringify(abNames));
  handle2.close();

  // ---- ドープシート強化: キーフレーム移動/コピペ/タイムスケール(rivのみモード) --------------------
  // Studio UI(STUDIO_HTML)のクライアントJSはブラウザ専用のためNode側からは直接importできない。
  // ここではクライアントが行うのと同じ手順(/anim で読み取り→ setKeyframes(replace) で /edit へ送る)を
  // このテストスクリプト自身が組み立てて実行し、サーバー側(rivEdit.setKeyframes/replace)が
  // 値・補間タイプ・カーブを無損失に往復させることをエンドポイントレベルで検証する。
  // segmentToEasingSpec: studio.ts の同名関数と同じ変換(k.segment=「入ってくる区間」→ easing=「次への区間」)
  function segmentToEasingSpec(segment) {
    if (!segment) return undefined;
    if (segment.interpolationType === 0) return "hold";
    if (segment.interpolationType === 1) return "linear";
    const interp = segment.interpolator;
    if (interp && interp.kind === "cubic") return [interp.x1, interp.y1, interp.x2, interp.y2];
    return "linear";
  }
  function trackToKeyframeSpecs(tr, frameOf) {
    const sorted = tr.keyframes.slice().sort((a, b) => a.frame - b.frame);
    return sorted.map((k, i) => {
      const easing = i + 1 < sorted.length ? segmentToEasingSpec(sorted[i + 1].segment) : undefined;
      let value = k.value;
      if (tr.propertyName === "rotation" && typeof value === "number") value = (value * 180) / Math.PI;
      return { frame: frameOf(k, i), value, easing };
    });
  }

  const kfWork = join(scratch, "e2e-keyframes.riv");
  writeFileSync(kfWork, readFileSync(join(root, "samples", "e2e-keyframes.riv")));
  const PORT3 = PORT + 2;
  const handle3 = startStudio({ rivPath: kfWork, port: PORT3 });
  async function api3(path, opts) {
    const res = await fetch(`http://localhost:${PORT3}${path}`, opts);
    return { status: res.status, json: await res.json() };
  }

  const anim1 = await api3("/anim?artboard=Gen&animation=wobble");
  check("GET /anim returns the wobble animation tracks", Array.isArray(anim1.json.tracks) && anim1.json.tracks.length === 4, JSON.stringify(anim1.json).slice(0, 200));
  const yTrack = anim1.json.tracks.find((tr) => tr.propertyName === "y");
  check("y-track found with 3 keyframes (0/30/60)", yTrack && yTrack.keyframes.length === 3, JSON.stringify(yTrack));
  const rotTrack = anim1.json.tracks.find((tr) => tr.propertyName === "rotation");
  check("rotation-track found with 2 keyframes (0/60)", rotTrack && rotTrack.keyframes.length === 2, JSON.stringify(rotTrack));
  const colorTrack = anim1.json.tracks.find((tr) => tr.propertyName && tr.propertyName.toLowerCase().includes("color"));
  check("color-track exists and is excluded from RIV_EDITABLE_PROPS (bulk-edit unsupported by design)", !!colorTrack, JSON.stringify(colorTrack));

  // ---- 1. 複数移動: y-track の中間キーフレーム(frame30)を frame20 へ ----
  {
    const specs = trackToKeyframeSpecs(yTrack, (k) => (k.frame === 30 ? 20 : k.frame));
    const res = await api3("/edit", {
      method: "POST",
      body: JSON.stringify([{ op: "setKeyframes", index: yTrack.targetIndex, animation: "wobble", property: "y", mode: "replace", keyframes: specs }]),
    });
    check("move: POST /edit ok", res.json.ok === true, JSON.stringify(res.json));
    const after = await api3("/anim?artboard=Gen&animation=wobble");
    const yAfter = after.json.tracks.find((tr) => tr.propertyName === "y");
    const frames = yAfter.keyframes.map((k) => k.frame).sort((a, b) => a - b);
    check("move: frames shifted to [0,20,60]", JSON.stringify(frames) === JSON.stringify([0, 20, 60]), JSON.stringify(frames));
    const values = yAfter.keyframes.map((k) => Math.round(k.value));
    check("move: values preserved [100,20,100] (order by frame)", JSON.stringify(values) === JSON.stringify([100, 20, 100]), JSON.stringify(values));
    const midKf = yAfter.keyframes.find((k) => k.frame === 20);
    const cubicSeg = midKf.segment; // 「frame0→frame20」区間 = 元々の frame0→frame30 と同じ linear のはず
    check("move: interpolation shape into the moved keyframe preserved (linear)", cubicSeg && cubicSeg.interpolationType === 1, JSON.stringify(cubicSeg));
    const lastKf = yAfter.keyframes.find((k) => k.frame === 60);
    const cubicIntoLast = lastKf.segment; // 「frame20→frame60」区間 = 元々の frame30→frame60 と同じcubic(0,0,0.58,1)のはず
    check(
      "move: cubic curve control points preserved exactly across the move (not rounded to a preset)",
      cubicIntoLast?.interpolator?.kind === "cubic" &&
        Math.abs(cubicIntoLast.interpolator.x1 - 0) < 1e-4 &&
        Math.abs(cubicIntoLast.interpolator.y1 - 0) < 1e-4 &&
        Math.abs(cubicIntoLast.interpolator.x2 - 0.58) < 1e-3 &&
        Math.abs(cubicIntoLast.interpolator.y2 - 1) < 1e-4,
      JSON.stringify(cubicIntoLast)
    );
  }

  // ---- 2. コピー&ペースト: y-track の frame0(100,先頭)/frame20(20) を frame2 起点で複製 ----
  {
    const before = await api3("/anim?artboard=Gen&animation=wobble");
    const yBefore = before.json.tracks.find((tr) => tr.propertyName === "y");
    const anchor = Math.min(...yBefore.keyframes.map((k) => k.frame)); // 0
    const copied = yBefore.keyframes.filter((k) => k.frame === 0 || k.frame === 20);
    const pasteBase = 2; // 貼り付け先の再生ヘッド相当。既存の0/20/60と衝突しない
    const pastedKfs = copied.map((k) => ({ frame: pasteBase + (k.frame - anchor), value: k.value, segment: k.segment }));
    // 既存トラックへ新規キーフレームをマージしてから setKeyframes(replace) 用に変換(commitRivTrackEditsと同じ手順)
    const mergedTr = {
      propertyName: "y",
      keyframes: [...yBefore.keyframes, ...pastedKfs.map((p) => ({ frame: p.frame, value: p.value, segment: p.segment }))],
    };
    const specs = trackToKeyframeSpecs(mergedTr, (k) => k.frame);
    const res = await api3("/edit", {
      method: "POST",
      body: JSON.stringify([{ op: "setKeyframes", index: yBefore.targetIndex, animation: "wobble", property: "y", mode: "replace", keyframes: specs }]),
    });
    check("paste: POST /edit ok", res.json.ok === true, JSON.stringify(res.json));
    const after = await api3("/anim?artboard=Gen&animation=wobble");
    const yAfter = after.json.tracks.find((tr) => tr.propertyName === "y");
    const frames = yAfter.keyframes.map((k) => k.frame).sort((a, b) => a - b);
    check("paste: track now has 5 keyframes at [0,2,20,22,60]", JSON.stringify(frames) === JSON.stringify([0, 2, 20, 22, 60]), JSON.stringify(frames));
    const pastedAt2 = yAfter.keyframes.find((k) => k.frame === 2);
    check("paste: pasted keyframe (from original frame0, value100) has the copied value", pastedAt2 && Math.round(pastedAt2.value) === 100, JSON.stringify(pastedAt2));
    const originalUntouched = yAfter.keyframes.find((k) => k.frame === 0);
    check("paste: original source keyframe (frame0) left untouched", originalUntouched && Math.round(originalUntouched.value) === 100);
  }

  // ---- 3. タイムスケール: rotation-track (frame0=0deg, frame60=360deg) を x0.5 に圧縮(アンカー=frame0) ----
  {
    const before = await api3("/anim?artboard=Gen&animation=wobble");
    const rBefore = before.json.tracks.find((tr) => tr.propertyName === "rotation");
    const anchor = Math.min(...rBefore.keyframes.map((k) => k.frame));
    const specs = trackToKeyframeSpecs(rBefore, (k) => Math.round(anchor + (k.frame - anchor) * 0.5));
    const res = await api3("/edit", {
      method: "POST",
      body: JSON.stringify([{ op: "setKeyframes", index: rBefore.targetIndex, animation: "wobble", property: "rotation", mode: "replace", keyframes: specs }]),
    });
    check("timescale: POST /edit ok", res.json.ok === true, JSON.stringify(res.json));
    const after = await api3("/anim?artboard=Gen&animation=wobble");
    const rAfter = after.json.tracks.find((tr) => tr.propertyName === "rotation");
    const frames = rAfter.keyframes.map((k) => k.frame).sort((a, b) => a - b);
    check("timescale: frames scaled from [0,60] to [0,30]", JSON.stringify(frames) === JSON.stringify([0, 30]), JSON.stringify(frames));
    const endVal = rAfter.keyframes.find((k) => k.frame === 30)?.value;
    check("timescale: rotation value preserved (~2π rad, degrees round-trip through EditOp intact)", Math.abs((endVal ?? 0) - 2 * Math.PI) < 1e-3, String(endVal));
  }

  // ---- 4. rivEdit.ts 拡張: setKeyframes の easing に「プリセットに一致しないカスタムベジェ」配列を
  // 直接渡しても、その正確な制御点で CubicEaseInterpolator が作られること(ドープシートの移動/コピペが
  // カーブをプリセットへ丸めず無損失で複製できるようにするための拡張。rivEdit.ts KeyframeEditSpec.easing 参照) ----
  {
    const bytes = new Uint8Array(readFileSync(kfWork));
    const dump0 = readRiv(bytes, { tolerant: true });
    const sqIndex = dump0.objects.find((o) => o.typeName === "Shape" && o.properties.name === "sq").index;
    const CUSTOM_BEZIER = [0.11, 0.22, 0.33, 0.44]; // どの名前付きプリセットとも一致しない値
    const { bytes: outBytes } = editRiv(bytes, [
      {
        op: "setKeyframes",
        index: sqIndex,
        animation: "wobble",
        property: "rotation",
        mode: "replace",
        keyframes: [
          { frame: 0, value: 0, easing: CUSTOM_BEZIER },
          { frame: 60, value: 360 },
        ],
      },
    ]);
    const dump1 = readRiv(outBytes, { tolerant: true });
    const customInterp = dump1.objects.find(
      (o) => o.typeName === "CubicEaseInterpolator" && Math.abs((o.properties.x1 ?? -99) - 0.11) < 1e-4 && Math.abs((o.properties.y2 ?? -99) - 0.44) < 1e-4
    );
    check("rivEdit.setKeyframes: custom (non-preset) bezier array creates a matching CubicEaseInterpolator", !!customInterp, JSON.stringify(customInterp?.properties));
  }

  handle3.close();
} catch (e) {
  console.error(e);
  failures++;
} finally {
  if (handle) { try { handle.close(); } catch { /* ignore */ } }
  try { stopStudio(); } catch { /* ignore */ }
  try { rmSync(scratch, { recursive: true, force: true }); } catch { /* ignore */ }
}

console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);

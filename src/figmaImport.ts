// Figma REST から SVG を 1 枚取ってくるだけのモジュール。**既定では動かない。**
//
// このサーバーの前提は「エディタ不要・無料・ローカル完結」で、ネットワークに出るのは
// ここだけ。env FIGMA_TOKEN が設定されているときにしか呼ばれず、設定されていなければ
// 「設定してください」と言って何もしない（黙って別の入口を探したりはしない）。
//
// 出て行く先は 2 つに限る:
//   1. api.figma.com — こちらが組み立てる唯一の URL
//   2. その応答が名指しした https の書き出し先（Figma が S3 に置く）— 我々が選ぶホストではない
// トークンはヘッダにしか載せない。**例外の文面にもログにも出さない**（応答をそのまま
// 貼り付ける運用で漏れるのが一番ありがちな事故なので、文字列に混ぜない規約にしてある）。
const API_HOST = "api.figma.com";

export interface FigmaRef {
  /** ファイルキー（URL の /file/<key>/ か /design/<key>/） */
  key: string;
  /** API が要求する形（"1:2"）。URL 上は "1-2" で出る */
  nodeId: string;
}

export function parseFigmaUrl(raw: string): FigmaRef {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error(`figmaUrl is not a URL: ${raw}`);
  }
  if (!/(^|\.)figma\.com$/i.test(u.hostname)) {
    throw new Error(`figmaUrl must be a figma.com link (got ${u.hostname})`);
  }
  // /file/<key>/ は旧形式、/design/<key>/ が現行。/proto/ も同じ位置にキーがある
  const m = u.pathname.match(/^\/(?:file|design|proto|board)\/([A-Za-z0-9]+)(?:\/|$)/);
  if (!m) {
    throw new Error(
      `Could not find the file key in ${u.pathname}. A Figma link looks like ` +
        `https://www.figma.com/design/<key>/<name>?node-id=1-2`
    );
  }
  const nodeParam = u.searchParams.get("node-id") ?? u.searchParams.get("node_id");
  if (!nodeParam) {
    throw new Error(
      "figmaUrl has no node-id, so there is no way to tell which frame to export. " +
        "In Figma select the frame and use Copy link to selection."
    );
  }
  // URL では ':' が '-' で書かれる（1-2）。%3A で来たときは searchParams が復号済み
  return { key: m[1], nodeId: nodeParam.replace(/-/g, ":") };
}

/**
 * Figma の 1 フレームを SVG 文字列で返す。
 * `svg_outline_text=false` を渡すのは、テキストをパスに潰されると M3 の
 * 「<text> を編集可能な Rive Text にする」経路が丸ごと死ぬため。
 * `svg_include_id=true` はレイヤー名を id として残させるため（roleHint の元）。
 */
export async function fetchFigmaSvg(
  rawUrl: string,
  opts: { token?: string; fetchImpl?: typeof fetch }
): Promise<{ svg: string; ref: FigmaRef }> {
  const token = opts.token;
  if (!token) {
    throw new Error(
      "figmaUrl needs a Figma access token. Set FIGMA_TOKEN in the environment that runs this " +
        "server (Figma → Settings → Security → Personal access tokens, file_content scope is enough). " +
        "Everything else in this server works without it — export the frame as an SVG and pass svgPath instead."
    );
  }
  const ref = parseFigmaUrl(rawUrl);
  const doFetch = opts.fetchImpl ?? fetch;
  const api =
    `https://${API_HOST}/v1/images/${encodeURIComponent(ref.key)}` +
    `?ids=${encodeURIComponent(ref.nodeId)}&format=svg&svg_outline_text=false&svg_include_id=true`;
  const res = await doFetch(api, { headers: { "X-Figma-Token": token } });
  if (!res.ok) {
    // 403 は「トークンが無効か、そのファイルへの権限が無い」のどちらか。
    // どちらかは応答からは分からないので、断定せず両方を出す
    throw new Error(
      `Figma API returned ${res.status}${res.statusText ? ` ${res.statusText}` : ""} for file ${ref.key}. ` +
        (res.status === 403 || res.status === 404
          ? "The token may be invalid or expired, or it may not have access to this file."
          : "")
    );
  }
  const body = (await res.json()) as { err?: string | null; images?: Record<string, string | null> };
  if (body?.err) throw new Error(`Figma API error: ${body.err}`);
  const href = body?.images?.[ref.nodeId];
  if (!href) {
    throw new Error(
      `Figma rendered no image for node ${ref.nodeId}. Check that the node-id in the link belongs to file ${ref.key}.`
    );
  }
  // 2 つ目の宛先は Figma 自身が名指ししたもの。それでも https でなければ取りに行かない
  let renderUrl: URL;
  try {
    renderUrl = new URL(href);
  } catch {
    throw new Error("Figma returned a render location that is not a URL");
  }
  if (renderUrl.protocol !== "https:") {
    throw new Error(`Figma returned a non-https render location (${renderUrl.protocol}) — not fetching it`);
  }
  const svgRes = await doFetch(renderUrl.toString());
  if (!svgRes.ok) {
    throw new Error(`Could not download the rendered SVG from Figma (${svgRes.status})`);
  }
  const svg = await svgRes.text();
  if (!svg.includes("<svg")) {
    throw new Error("What Figma returned is not an SVG document");
  }
  return { svg, ref };
}

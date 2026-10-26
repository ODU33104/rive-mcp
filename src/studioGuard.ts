// Studio（編集用サーバー）の入口チェック。ループバック待ち受け + Host 検査だけでは、
// 悪意のあるウェブページからの cross-site POST（編集中の .riv の破壊）を防げないため、
// Origin / Sec-Fetch-Site の検査とセッション認証を重ねる。OS レベルのサンドボックスではない。
import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export const MAX_BODY_BYTES = 16 * 1024 * 1024;

const TOKEN_RE = /^[a-f0-9]{64}$/;

export interface StudioGuard {
  token: string;
  /** ブラウザで開く URL。トークンは fragment に置く（サーバーのログや Referer に残らない） */
  entryUrl: string;
  /** MCP プロセス自身が同じ Studio を叩くときの Authorization ヘッダ値 */
  bearer: string;
  /** true のときだけ呼び出し側が続きを処理する。false ならレスポンスは送信済み */
  check(req: IncomingMessage, res: ServerResponse): boolean;
}

export function createStudioGuard(port: number): StudioGuard {
  const token = randomBytes(32).toString("hex");
  const nonce = randomBytes(18).toString("base64");
  const origin = `http://127.0.0.1:${port}`;
  const cookieName = `rivestudio_${port}`;
  const tokenOk = (v: string | undefined): boolean => {
    if (!v || !TOKEN_RE.test(v)) return false;
    return timingSafeEqual(Buffer.from(v), Buffer.from(token));
  };
  // 認証前に返す入口ページ。fragment のトークンを /session に渡して Cookie に引き換え、アドレスバーから消す
  const entryPage =
    `<!doctype html><meta charset="utf-8"><title>Rive Studio</title><p id="m">Opening Studio…</p>` +
    `<script nonce="${nonce}">const t=location.hash.slice(1);history.replaceState(null,"","/");` +
    `const m=document.getElementById("m");` +
    `if(!/^[a-f0-9]{64}$/.test(t))m.textContent="Open the Studio link returned by riv_studio.";` +
    `else fetch("/session",{method:"POST",headers:{Authorization:"Bearer "+t}})` +
    `.then(r=>{if(!r.ok)throw 0;location.replace("/")}).catch(()=>{m.textContent="Session expired. Open a new Studio link."});</script>`;

  return {
    token,
    entryUrl: `${origin}/#${token}`,
    bearer: `Bearer ${token}`,
    check(req, res) {
      // 外部への通信を許さない。インラインスクリプトは Studio 本体が使うので許可する（XSS 対策ではなく、持ち出し・埋め込み対策）
      const appCsp =
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' blob: data:; connect-src 'self'; " +
        "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'";
      const baseHeaders = {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
      };
      const deny = (status: number, message: string) => {
        res.writeHead(status, { ...baseHeaders, "Content-Type": "text/plain" });
        res.end(message);
        return false;
      };
      const url = req.url ?? "";
      if (!url.startsWith("/") || url.startsWith("//") || url.includes("\\")) return deny(400, "bad request");
      // DNS リバインディング: Host は自分のループバック名だけ
      const hm = /^(127\.0\.0\.1|localhost|\[::1\])(?::(\d+))?$/.exec((req.headers.host ?? "").toLowerCase());
      if (!hm || (hm[2] !== undefined && Number(hm[2]) !== port)) return deny(403, "forbidden");
      // 別オリジンのページからのリクエスト（単純 POST を含む）は理由を問わず拒否
      const reqOrigin = req.headers.origin;
      if (reqOrigin && reqOrigin !== origin && reqOrigin !== `http://localhost:${port}`) return deny(403, "cross-origin request denied");
      if (req.headers["sec-fetch-site"] === "cross-site") return deny(403, "cross-site request denied");
      if (req.method !== "GET" && req.method !== "POST") return deny(405, "method not allowed");

      const auth = req.headers.authorization;
      const viaBearer = typeof auth === "string" && auth.startsWith("Bearer ") && tokenOk(auth.slice(7));
      const cookie = req.headers.cookie
        ?.split(";")
        .map((s) => s.trim())
        .find((s) => s.startsWith(`${cookieName}=`))
        ?.slice(cookieName.length + 1);
      const authed = viaBearer || tokenOk(cookie);

      const path = url.split("?")[0];
      if (path === "/session" && req.method === "POST") {
        if (!viaBearer) return deny(401, "Studio link required");
        res.writeHead(204, { ...baseHeaders, "Set-Cookie": `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/` });
        res.end();
        return false;
      }
      if (!authed) {
        if (path === "/" && req.method === "GET") {
          res.writeHead(200, {
            ...baseHeaders,
            "Content-Type": "text/html; charset=utf-8",
            "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'`,
          });
          res.end(entryPage);
          return false;
        }
        return deny(401, "authentication required");
      }
      // Cookie だけの POST は同一オリジンのページからに限る（Bearer を持つ MCP 側は Origin を送らない）
      if (req.method === "POST" && !viaBearer && reqOrigin !== origin && reqOrigin !== `http://localhost:${port}`) {
        return deny(403, "same-origin POST required");
      }
      for (const [k, v] of Object.entries(baseHeaders)) res.setHeader(k, v);
      res.setHeader("Content-Security-Policy", appCsp);
      return true;
    },
  };
}

// Studio（編集用サーバー）の入口チェックの回帰テスト。ブラウザ不要。
// 実行: npm run build && node test/studio-security.mjs
import { request } from "node:http";
import { copyFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { startStudio, stopStudio } from "../dist/studio.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
mkdirSync(join(root, "local"), { recursive: true });
const work = join(root, "local", "studio-security.riv");
copyFileSync(join(root, "samples", "vehicles.riv"), work);

const PORT = 8861;
let failed = 0;
const check = (name, ok, detail = "") => {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed++;
};

// fetch は Host / Origin を自由に付けられないので http.request を使う
const call = (method, path, { headers = {}, body } = {}) =>
  new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port: PORT, method, path, agent: false, headers: { Host: `127.0.0.1:${PORT}`, ...headers } }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", (e) => resolve({ status: 0, headers: {}, text: String(e.code ?? e.message) }));
    if (body) req.write(body);
    req.end();
  });

const handle = startStudio({ rivPath: work, port: PORT });
await new Promise((r) => setTimeout(r, 400));
const auth = { Authorization: handle.authHeader };
try {
  check("入口 URL は fragment にトークンを持つ", /^http:\/\/127\.0\.0\.1:8861\/#[a-f0-9]{64}$/.test(handle.url), handle.url);

  const anon = await call("GET", "/state");
  check("認証なしの /state は 401", anon.status === 401, String(anon.status));
  const anonFile = await call("GET", "/file.riv");
  check("認証なしの /file.riv は 401", anonFile.status === 401, String(anonFile.status));
  const entry = await call("GET", "/");
  check("認証なしの / は入口ページだけ返す（本体 HTML ではない）", entry.status === 200 && entry.text.includes("/session") && !entry.text.includes("rive.js"), String(entry.status));
  const anonPost = await call("POST", "/rebuild", { body: "{}" });
  check("認証なしの POST は 401", anonPost.status === 401, String(anonPost.status));

  const ok = await call("GET", "/state", { headers: auth });
  check("Bearer 付きの /state は 200", ok.status === 200, String(ok.status));
  check("応答に CSP とクリックジャッキング対策が付く", /connect-src 'self'/.test(ok.headers["content-security-policy"] ?? "") && ok.headers["x-frame-options"] === "DENY");

  const badHost = await call("GET", "/state", { headers: { ...auth, Host: "evil.example:8861" } });
  check("不正な Host は 403（DNS リバインディング）", badHost.status === 403, String(badHost.status));
  const badOrigin = await call("POST", "/rebuild", { headers: { ...auth, Origin: "https://evil.example" }, body: "{}" });
  check("別オリジンからの POST は Bearer があっても 403", badOrigin.status === 403, String(badOrigin.status));
  const crossSite = await call("GET", "/state", { headers: { ...auth, "Sec-Fetch-Site": "cross-site" } });
  check("Sec-Fetch-Site: cross-site は 403", crossSite.status === 403, String(crossSite.status));
  const put = await call("PUT", "/state", { headers: auth });
  check("GET / POST 以外のメソッドは 405", put.status === 405, String(put.status));

  const sess = await call("POST", "/session", { headers: auth });
  const setCookie = String(sess.headers["set-cookie"] ?? "");
  check("/session は HttpOnly + SameSite=Strict の Cookie を発行する", sess.status === 204 && /HttpOnly/.test(setCookie) && /SameSite=Strict/.test(setCookie), setCookie.split(";")[0].slice(0, 30));
  const noBearerSession = await call("POST", "/session");
  check("Bearer なしの /session は 401", noBearerSession.status === 401, String(noBearerSession.status));

  const cookie = setCookie.split(";")[0];
  const cookieGet = await call("GET", "/state", { headers: { Cookie: cookie } });
  check("Cookie だけでも GET は通る", cookieGet.status === 200, String(cookieGet.status));
  const cookiePostNoOrigin = await call("POST", "/rebuild", { headers: { Cookie: cookie }, body: "{}" });
  check("Cookie だけで Origin なしの POST は 403（CSRF）", cookiePostNoOrigin.status === 403, String(cookiePostNoOrigin.status));
  const cookiePostOk = await call("POST", "/chat", {
    headers: { Cookie: cookie, Origin: `http://127.0.0.1:${PORT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text: "ping", role: "user" }),
  });
  check("Cookie + 同一 Origin の POST は通る", cookiePostOk.status < 400, String(cookiePostOk.status));

  const big = await call("POST", "/chat", { headers: { ...auth, "Content-Type": "application/json" }, body: Buffer.alloc(17 * 1024 * 1024, 0x20) });
  check("16MiB を超える本文は 413 か切断", big.status === 413 || big.status === 0, String(big.status));
  const after = await call("GET", "/state", { headers: auth });
  check("巨大本文の後もサーバーは生きている", after.status === 200, `${after.status} ${after.status === 200 ? "" : after.text}`);
} finally {
  stopStudio();
}
console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
process.exit(failed ? 1 : 0);

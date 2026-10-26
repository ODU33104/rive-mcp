// リリースを一発で始める: バージョン更新 → ビルドと検査 → コミット → タグ → push。
// 以降（npm 公開・MCP Registry 登録・GitHub Release）は .github/workflows/release.yml がタグを受けて行う。
// 使い方: npm run release -- patch | minor | major | 0.7.0   （--dry-run で push せずに確認）
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const arg = process.argv[2];
const dry = process.argv.includes("--dry-run");
if (!arg || !/^(patch|minor|major|\d+\.\d+\.\d+)$/.test(arg)) {
  console.error("usage: npm run release -- <patch|minor|major|x.y.z> [--dry-run]");
  process.exit(2);
}

// Windows の npm は .cmd なので shell が要るが、shell を通すと引数が連結される（コミットメッセージが割れる）。npm にだけ使う
const run = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: "utf8", stdio: opts.inherit ? "inherit" : ["ignore", "pipe", "inherit"], shell: cmd === "npm" && process.platform === "win32" });
const out = (cmd, args) => run(cmd, args).trim();
const fail = (msg) => { console.error(`release: ${msg}`); process.exit(1); };

// 作業ツリーは追跡ファイルがクリーンで、main の最新であること（未追跡ファイルは無視）
if (out("git", ["branch", "--show-current"]) !== "main") fail("run this on the main branch");
if (out("git", ["status", "--porcelain", "--untracked-files=no"])) fail("tracked files have uncommitted changes; commit or stash them first");
run("git", ["fetch", "origin", "main"]);
if (out("git", ["rev-list", "--count", "HEAD..origin/main"]) !== "0") fail("origin/main has commits you do not have; git pull first");

// 公開前の機械検査: ビルドと、ブラウザ不要のセキュリティテスト
console.log("building and testing…");
run("npm", ["run", "build"], { inherit: true });
run("node", ["test/studio-security.mjs"], { inherit: true });

// package.json / package-lock.json / server.json のバージョンをそろえる
run("npm", ["version", arg, "--no-git-tag-version"]);
const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const server = JSON.parse(readFileSync("server.json", "utf8"));
server.version = version;
for (const p of server.packages ?? []) p.version = version;
writeFileSync("server.json", JSON.stringify(server, null, 2) + "\n");

const tag = `v${version}`;
if (out("git", ["tag", "--list", tag])) fail(`tag ${tag} already exists`);
run("git", ["add", "package.json", "package-lock.json", "server.json"]);
run("git", ["commit", "-m", `Release ${version}`]);
run("git", ["tag", "-a", tag, "-m", `Release ${version}`]);

if (dry) {
  console.log(`dry run: created commit and tag ${tag} locally. Undo with: git tag -d ${tag} && git reset --hard HEAD~1`);
  process.exit(0);
}
run("git", ["push", "origin", "main", tag], { inherit: true });
console.log(`\npushed ${tag}. GitHub Actions now publishes it: https://github.com/ODU33104/rive-mcp/actions`);

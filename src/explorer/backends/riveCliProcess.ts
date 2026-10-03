import { createHash } from "node:crypto";
import { spawn } from "node:child_process";

export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function hashCanonicalData(text: string): string {
  return sha256(text);
}

/** Hash PNG render payload while ignoring ancillary metadata chunks. */
export function hashPngVisualPayload(bytes: Uint8Array): string {
  const signature = Buffer.from(bytes.subarray(0, 8));
  const expected = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (signature.length !== 8 || !signature.equals(expected)) return sha256(bytes);

  const hash = createHash("sha256");
  let offset = 8;
  let consumed = false;
  while (offset + 12 <= bytes.length) {
    const view = Buffer.from(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset);
    const length = view.readUInt32BE(0);
    const total = 12 + length;
    if (offset + total > bytes.length) return sha256(bytes);
    const type = view.subarray(4, 8).toString("ascii");
    if (["IHDR", "PLTE", "tRNS", "IDAT"].includes(type)) {
      hash.update(view.subarray(4, total - 4));
      consumed = true;
    }
    offset += total;
    if (type === "IEND") break;
  }
  return consumed ? hash.digest("hex") : sha256(bytes);
}

export function diagnosticLines(stderr: string): string[] {
  return stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 20).map((line) => line.slice(0, 500));
}

export function runCommand(
  executable: string,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; env: NodeJS.ProcessEnv }
): Promise<CommandResult> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, { cwd: options.cwd, env: options.env, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, options.timeoutMs);
    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("close", (code) => {
      clearTimeout(timer);
      const out = Buffer.concat(stdout).toString("utf8");
      const err = Buffer.concat(stderr).toString("utf8");
      if (timedOut) return reject(new Error(`Rive CLI timed out after ${options.timeoutMs}ms${err ? `: ${err.trim()}` : ""}`));
      resolvePromise({ code: code ?? 1, stdout: out, stderr: err });
    });
  });
}

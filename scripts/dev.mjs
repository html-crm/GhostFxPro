import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const node = process.execPath;
const isWin = process.platform === "win32";

const api = spawn(node, ["--import", "tsx", "src/dev-server.ts"], {
  cwd: join(root, "apps", "api"),
  stdio: "inherit",
  shell: isWin,
});

const nextBin = join(root, "node_modules", "next", "dist", "bin", "next");
const web = spawn(node, [nextBin, "dev", "-p", "3000"], {
  cwd: join(root, "apps", "web"),
  stdio: "inherit",
  shell: isWin,
});

let shuttingDown = false;
function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of [api, web]) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));
api.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`[dev] api exited (${code})`);
    shutdown(code ?? 1);
  }
});
web.on("exit", (code) => {
  if (!shuttingDown) {
    console.error(`[dev] web exited (${code})`);
    shutdown(code ?? 1);
  }
});

console.log("[dev] API  -> http://127.0.0.1:4000");
console.log("[dev] WEB  -> http://localhost:3000");

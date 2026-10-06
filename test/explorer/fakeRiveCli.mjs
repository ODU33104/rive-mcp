import { writeFileSync } from "node:fs";

if (process.argv.includes("--version")) {
  console.log("rive 9.9.9-test");
  process.exit(0);
}

let score = 0;
let clicked = false;
let elapsed = 0;
let lastKey = null;
let screenshot;
let dataDump;
for (const arg of process.argv.slice(2)) {
  if (arg.startsWith("--screenshot=")) screenshot = arg.slice("--screenshot=".length);
  else if (arg.startsWith("--data-dump=")) dataDump = arg.slice("--data-dump=".length);
  else if (arg.startsWith("--data=score=")) score = Number(arg.slice("--data=score=".length));
  else if (arg.startsWith("--pointer=click@")) clicked = true;
  else if (arg.startsWith("--advance=")) elapsed += Number(arg.slice("--advance=".length).replace(/s$/, ""));
  else if (arg.startsWith("--key=")) lastKey = arg.slice("--key=".length);
}
if (!screenshot || !dataDump) {
  console.error("fake cli requires screenshot and data dump paths");
  process.exit(2);
}
const state = { score, clicked, elapsed, lastKey };
writeFileSync(dataDump, JSON.stringify(state));
writeFileSync(screenshot, Buffer.from(`fake-frame:${JSON.stringify(state)}`));
console.error("fake build log");

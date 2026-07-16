// hello_world_text.riv から Inter フォント（OFL）を抽出して assets/ に保存
import { readFileSync, writeFileSync } from "node:fs";
import { readRiv } from "../dist/rivBinary.js";

const d = readRiv(readFileSync("samples/ref/hello_world_text.riv"));
const fc = d.objects.find((o) => o.typeName === "FileAssetContents");
const bytes = fc.raw.find((p) => p.key === 212).value;
writeFileSync("assets/inter.ttf", Buffer.from(bytes));
console.log("extracted font:", bytes.length, "bytes");

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const summaryDir = resolve(process.argv[2] || "test/tmp/creative-ab/_summary");
const scoresPath = resolve(process.argv[3] || "test/ab/scores.csv");
const mapPath = summaryDir + "/blind-map.keep-hidden.json";
if (!existsSync(mapPath)) throw new Error("Missing blind map: " + mapPath);
if (!existsSync(scoresPath)) throw new Error("Missing scores CSV: " + scoresPath);

function parseCsv(text) {
  const lines = text.trim().split(/\r?\n/);
  const header = lines[0].split(",");
  return lines.slice(1).filter(Boolean).map((line) => {
    const cells = [];
    let cur = "", quoted = false;
    for (let i=0;i<line.length;i++) {
      const ch=line[i];
      if (ch === '"') {
        if (quoted && line[i+1] === '"') { cur += '"'; i++; }
        else quoted = !quoted;
      } else if (ch === "," && !quoted) { cells.push(cur); cur=""; }
      else cur += ch;
    }
    cells.push(cur);
    return Object.fromEntries(header.map((h,i)=>[h,cells[i]??""]));
  });
}

const dims=["brief_adherence","composition_hierarchy","visual_polish","motion_quality","readability","coherence_restraint","technical_correctness"];
const scores=parseCsv(readFileSync(scoresPath,"utf8"));
const map=JSON.parse(readFileSync(mapPath,"utf8"));
const bySample=new Map(map.map((m)=>[m.sample,m]));
const rows=[];

for(const s of scores){
  const meta=bySample.get(s.sample);
  if(!meta) throw new Error("Unknown blind sample: "+s.sample);
  const numeric={};
  for(const d of dims){
    const v=Number(s[d]);
    if(!Number.isFinite(v)||v<1||v>5) throw new Error(`Invalid ${d} for ${s.sample}: ${s[d]}`);
    numeric[d]=v;
  }
  rows.push({
    ...meta,
    scores:numeric,
    mean:dims.reduce((n,d)=>n+numeric[d],0)/dims.length,
    brokenArtifact:/^(1|true|yes|y)$/i.test(s.broken_artifact),
    shipWithoutCorrection:/^(1|true|yes|y)$/i.test(s.ship_without_visual_correction),
    notes:s.notes||"",
  });
}

function stats(version){
  const rs=rows.filter((r)=>r.version===version);
  const mean=(xs)=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
  return {
    samples:rs.length,
    meanQuality:mean(rs.map((r)=>r.mean)),
    shipRate:mean(rs.map((r)=>r.shipWithoutCorrection?1:0)),
    brokenRate:mean(rs.map((r)=>r.brokenArtifact?1:0)),
    dimensions:Object.fromEntries(dims.map((d)=>[d,mean(rs.map((r)=>r.scores[d]))])),
  };
}
const result={baseline:stats("baseline"),current:stats("current"),rows};
writeFileSync(summaryDir+"/quality-scores.json",JSON.stringify(result,null,2));

let md="# Blind creative quality scores\n\n";
md+="| Metric | Baseline | Current |\n|---|---:|---:|\n";
md+=`| Samples | ${result.baseline.samples} | ${result.current.samples} |\n`;
md+=`| Mean quality / 5 | ${result.baseline.meanQuality?.toFixed(2)??"n/a"} | ${result.current.meanQuality?.toFixed(2)??"n/a"} |\n`;
md+=`| Ship without correction | ${result.baseline.shipRate==null?"n/a":(result.baseline.shipRate*100).toFixed(1)+"%"} | ${result.current.shipRate==null?"n/a":(result.current.shipRate*100).toFixed(1)+"%"} |\n`;
md+=`| Broken artifact rate | ${result.baseline.brokenRate==null?"n/a":(result.baseline.brokenRate*100).toFixed(1)+"%"} | ${result.current.brokenRate==null?"n/a":(result.current.brokenRate*100).toFixed(1)+"%"} |\n`;
for(const d of dims) md+=`| ${d} | ${result.baseline.dimensions[d]?.toFixed(2)??"n/a"} | ${result.current.dimensions[d]?.toFixed(2)??"n/a"} |\n`;
writeFileSync(summaryDir+"/quality-scores.md",md);
console.log(md);

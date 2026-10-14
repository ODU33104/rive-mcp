// Build the 60 catalog-derived causal analyses without copying third-party assets.
// Usage: node scripts/motif-distill-catalog.mjs [--check|--write]
import {readFileSync,writeFileSync,mkdirSync,existsSync} from "node:fs";
import {resolve,dirname} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {analyzeCatalog,buildClusters} from "./motif-distill-core.mjs";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const INPUT=resolve(ROOT,"data/motion-recipes/catalog.v1.json");
const DEST=resolve(ROOT,"data/motion-motifs/catalog-analyses.v1.json");
export function materialize(){
 const catalog=JSON.parse(readFileSync(INPUT,"utf8"));
 const analyses=analyzeCatalog(catalog);
 if(analyses.length!==catalog.recipes.length)throw Error("Catalog coverage incomplete");
 const clusters=buildClusters(analyses);
 return {schema:"causal-motif-analysis-collection/v1",
  source:{path:"data/motion-recipes/catalog.v1.json",count:catalog.recipes.length},
  claimLimits:["Catalog gives timing, not drawable geometry or verified visual causality",
   "ReferenceIds do not grant permission to copy source, embedded art, fonts, or training data",
   "Temporal precedence is a hypothesis, never a demonstrated dependency"],
  analyses,clusters};
}
export function writeAnalyses(){
 const v=materialize();mkdirSync(dirname(DEST),{recursive:true});
 writeFileSync(DEST,JSON.stringify(v,null,2)+"\n");
 return {recipes:v.analyses.length,clusters:v.clusters.length,path:DEST};
}
function main(args){
 if(args.includes("--write")){console.log(JSON.stringify(writeAnalyses()));return;}
 const current=materialize();
 if(args.includes("--check")){
  if(!existsSync(DEST))throw Error("Run --write first: catalog analysis output missing");
  const actual=JSON.parse(readFileSync(DEST,"utf8"));
  if(JSON.stringify(actual)!==JSON.stringify(current))
   throw Error("Motif analyses stale; run --write and commit generated output");
 }
 console.log(JSON.stringify({recipes:current.analyses.length,clusters:current.clusters.length,
  checked:args.includes("--check")}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{main(process.argv.slice(2));}catch(e){console.error(e);process.exitCode=1;}
}

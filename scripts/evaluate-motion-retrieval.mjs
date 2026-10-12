// Dependency-free auditable benchmark. Node >=20.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const DEFAULT_CATALOG=new URL('../data/motion-recipes/catalog.v1.json',import.meta.url);
const DEFAULT_BENCH=new URL('../data/motion-recipes/query-benchmark.v1.json',import.meta.url);
export const THRESHOLDS=Object.freeze({top1:0.85,top3:0.90,abstentionAccuracy:0.75,forbiddenTop1Rate:0.07,forbiddenTop3Rate:0.26});

function validate(catalog,benchmark){
 if(benchmark.schemaVersion!==1||!Array.isArray(benchmark.cases)||benchmark.cases.length<50)throw Error('benchmark requires schemaVersion=1 and >=50 cases');
 const ids=new Set(catalog.recipes.map(r=>r.id)),prompts=new Set();
 for(const [i,c] of benchmark.cases.entries()){
  if(typeof c.prompt!=='string'||!c.prompt.trim()||prompts.has(c.prompt))throw Error('invalid/duplicate prompt at case '+i);
  prompts.add(c.prompt);
  if(typeof c.rationale!=='string'||!c.rationale.trim())throw Error('missing rationale at case '+i);
  if(!Array.isArray(c.acceptableTopIds)||!Array.isArray(c.forbiddenTopIds))throw Error('missing labels at case '+i);
  for(const id of [...c.acceptableTopIds,...c.forbiddenTopIds])if(!ids.has(id))throw Error('unknown recipe id '+id+' at case '+i);
  if(c.acceptableTopIds.some(id=>c.forbiddenTopIds.includes(id)))throw Error('contradictory labels at case '+i);
 }
}
export function evaluateRetrieval(catalog,benchmark,selectRecipes){
 validate(catalog,benchmark);
 const totals={cases:benchmark.cases.length,positiveCases:0,abstentionCases:0,top1Hits:0,top3Hits:0,abstentionHits:0,forbiddenEligibleCases:0,forbiddenTop1Hits:0,forbiddenTop3Hits:0};
 const details=[],byLanguage={ja:{cases:0,top1Hits:0,positiveCases:0},en:{cases:0,top1Hits:0,positiveCases:0}};
 for(const entry of benchmark.cases){
  const predictions=selectRecipes(catalog,entry.prompt,{limit:5});
  if(!Array.isArray(predictions))throw Error('selectRecipes did not return an array');
  const actual=predictions.map(x=>x.id),expected=entry.acceptableTopIds,forbidden=entry.forbiddenTopIds;
  const language=/[\u3040-\u30ff\u3400-\u9fff]/.test(entry.prompt)?'ja':'en';
  byLanguage[language].cases++;
  const top1=expected.length>0&&expected.includes(actual[0]);
  const top3=expected.length>0&&actual.slice(0,3).some(id=>expected.includes(id));
  const abstained=actual.length===0;
  if(expected.length){
   totals.positiveCases++;byLanguage[language].positiveCases++;
   if(top1){totals.top1Hits++;byLanguage[language].top1Hits++;}
   if(top3)totals.top3Hits++;
  }else{totals.abstentionCases++;if(abstained)totals.abstentionHits++;}
  if(forbidden.length){
   totals.forbiddenEligibleCases++;
   if(forbidden.includes(actual[0]))totals.forbiddenTop1Hits++;
   if(actual.slice(0,3).some(id=>forbidden.includes(id)))totals.forbiddenTop3Hits++;
  }
  details.push({prompt:entry.prompt,language,expected,forbidden,actual:actual.slice(0,3),top1,top3,abstained,why:predictions.slice(0,3).map(p=>({id:p.id,score:p.score,why:p.why})),rationale:entry.rationale});
 }
 const fraction=(n,d)=>d===0?1:n/d;
 return {
  counts:totals,
  metrics:{
   top1:fraction(totals.top1Hits,totals.positiveCases),
   top3:fraction(totals.top3Hits,totals.positiveCases),
   abstentionAccuracy:fraction(totals.abstentionHits,totals.abstentionCases),
   forbiddenTop1Rate:fraction(totals.forbiddenTop1Hits,totals.cases),
   forbiddenTop3Rate:fraction(totals.forbiddenTop3Hits,totals.cases),
   forbiddenTop1ConditionalRate:fraction(totals.forbiddenTop1Hits,totals.forbiddenEligibleCases),
   forbiddenTop3ConditionalRate:fraction(totals.forbiddenTop3Hits,totals.forbiddenEligibleCases)
  },byLanguage,details
 };
}
export function regressionFailures(metrics,thresholds=THRESHOLDS){
 return Object.entries(thresholds).filter(([k,v])=>k.startsWith('forbidden')?metrics[k]>v:metrics[k]<v)
  .map(([k,v])=>k+': '+metrics[k].toFixed(3)+' '+(k.startsWith('forbidden')?'>':'<')+' '+v);
}
async function main(argv){
 let modulePath=new URL('./motion-recipe.mjs',import.meta.url),catalogPath=DEFAULT_CATALOG,benchmarkPath=DEFAULT_BENCH;
 let noGate=false,json=false,explain=false;
 for(let i=0;i<argv.length;i++){
  const a=argv[i];
  if(a==='--module'||a==='--catalog'||a==='--benchmark'){
   if(!argv[i+1])throw Error('missing value after '+a);
   const value=pathToFileURL(resolve(argv[++i]));
   if(a==='--module')modulePath=value;else if(a==='--catalog')catalogPath=value;else benchmarkPath=value;
  }else if(a==='--no-gate')noGate=true;
  else if(a==='--json')json=true;
  else if(a==='--explain')explain=true;
  else throw Error('Unknown option: '+a);
 }
 const catalog=JSON.parse(readFileSync(catalogPath,'utf8'));
 const benchmark=JSON.parse(readFileSync(benchmarkPath,'utf8'));
 const {selectRecipes}=await import(modulePath.href);
 if(typeof selectRecipes!=='function')throw Error('ranker module must export selectRecipes');
 const result=evaluateRetrieval(catalog,benchmark,selectRecipes),failures=regressionFailures(result.metrics);
 if(json)console.log(JSON.stringify({counts:result.counts,metrics:result.metrics,byLanguage:result.byLanguage,thresholds:THRESHOLDS,failures},null,2));
 else{
  console.log('Motion retrieval benchmark: '+result.counts.cases+' prompts ('+result.counts.positiveCases+' labeled; '+result.counts.abstentionCases+' abstain)');
  for(const [key,value] of Object.entries(result.metrics))console.log(key+': '+(value*100).toFixed(1)+'%');
  console.log('Language counts:',JSON.stringify(result.byLanguage));
  if(explain)for(const d of result.details){
   if((d.expected.length&&(!d.top1||!d.top3))||(!d.expected.length&&!d.abstained)||d.forbidden.includes(d.actual[0]))
    console.log(JSON.stringify(d));
  }
  console.log(failures.length&&!noGate?'GATE FAILED: '+failures.join('; '):'GATE PASSED'+(noGate?' (--no-gate)':''));
 }
 if(failures.length&&!noGate)process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main(process.argv.slice(2)).catch(e=>{console.error(e.stack??e.message);process.exitCode=1;});

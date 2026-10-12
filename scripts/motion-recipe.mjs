// Generation-oriented motion recipe search and Rive AnimationSpec compiler.
// Third-party content is not stored or downloaded here. Node >= 20.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
const DATA_URL=new URL("../data/motion-recipes/catalog.v1.json",import.meta.url);
export function loadCatalog(){return JSON.parse(readFileSync(DATA_URL,"utf8"));}

const LEXICON={
  "goal:success": [
    "成功",
    "完了",
    "達成",
    "success",
    "complete",
    "checkmark"
  ],
  "goal:feedback": [
    "ボタン",
    "タップ",
    "押す",
    "クリック",
    "通知",
    "反応",
    "feedback",
    "press",
    "tap"
  ],
  "goal:loading": [
    "ローディング",
    "読み込み",
    "ロード中",
    "待機",
    "loading",
    "spinner",
    "loader"
  ],
  "goal:progress": [
    "進捗",
    "プログレス",
    "progress"
  ],
  "goal:intro": [
    "登場",
    "イントロ",
    "タイトル",
    "出現",
    "導入",
    "intro",
    "reveal",
    "entrance"
  ],
  "goal:typography": [
    "文字",
    "タイポグラフィ",
    "見出し",
    "headline",
    "typography",
    "text reveal"
  ],
  "goal:product": [
    "製品",
    "商品",
    "プロダクト",
    "product"
  ],
  "goal:onboarding": [
    "オンボーディング",
    "導入",
    "歓迎",
    "ようこそ",
    "onboarding",
    "welcome"
  ],
  "goal:notification": [
    "通知",
    "トースト",
    "notification",
    "toast"
  ],
  "goal:error": [
    "エラー",
    "失敗",
    "警告",
    "error",
    "invalid"
  ],
  "goal:toggle": [
    "スイッチ",
    "切替",
    "トグル",
    "toggle",
    "switch"
  ],
  "goal:reward": [
    "報酬",
    "ご褒美",
    "ポイント",
    "reward",
    "achievement"
  ],
  "goal:navigation": [
    "ページ遷移",
    "画面遷移",
    "切替",
    "navigation"
  ],
  "goal:transition": [
    "画面遷移",
    "切替",
    "transition"
  ],
  "goal:character": [
    "キャラクター",
    "マスコット",
    "手を振る",
    "character",
    "mascot"
  ],
  "goal:form": [
    "フォーム",
    "入力",
    "フォーカス",
    "input",
    "focus"
  ],
  "goal:ambient": [
    "背景",
    "ふわふわ",
    "環境",
    "アイドル",
    "background",
    "ambient",
    "idle"
  ],
  "style:premium": [
    "高級",
    "上質",
    "洗練",
    "上品",
    "エレガント",
    "premium",
    "luxury",
    "elegant",
    "apple風"
  ],
  "style:minimal": [
    "控えめ",
    "シンプル",
    "ミニマル",
    "静か",
    "さりげなく",
    "minimal",
    "subtle",
    "quiet"
  ],
  "style:playful": [
    "かわいい",
    "楽しい",
    "ポップ",
    "弾む",
    "遊び心",
    "playful",
    "bouncy",
    "cute"
  ],
  "style:energetic": [
    "派手",
    "豪華",
    "爆発",
    "賑やか",
    "energetic",
    "flashy",
    "explosive"
  ],
  "style:cinematic": [
    "映画",
    "壮大",
    "シネマ",
    "cinematic",
    "dramatic"
  ],
  "style:technical": [
    "精密",
    "機械",
    "硬質",
    "technical",
    "mechanical"
  ]
};

function norm(value){return String(value).normalize("NFKC").toLowerCase().trim();}
function contains(hay,needle){
 const n=norm(needle);
 if(!n)return false;
 if(/^[a-z0-9][a-z0-9 -]*$/.test(n)){
  const escaped=n.replace(/[.*+?^$()|[\]{}\\]/g,"\\$&");
  return new RegExp("(^|[^a-z0-9])"+escaped+"($|[^a-z0-9])","i").test(hay);
 }
 return hay.includes(n);
}
// Curated concepts remain independently inspectable; no external embedding or API.
const EXTRA_LEXICON={
 'goal:success':['チェック','完了した','終わった','保存できた','completed','completed successfully','succeeded','saved successfully','confirmation','confirm','win'],
 'goal:feedback':['反応する','押した瞬間','クリックの反応','acknowledge','acknowledgement','click','control','checkmark','知らせたい','伝える'],
 'goal:loading':['ロード','脈動','fetching','waiting','during load','pulse','pulsing'],
 'goal:progress':['ゲージ','進み具合','プログレスバー','progress bar','upload progress','filling'],
 'goal:intro':['現れる','登場する','見せる','launch','appear','appears','introduce','introduction'],
 'goal:typography':['見出し','雑誌','記事タイトル','editorial','heading','article headline'],
 'goal:product':['新商品','商品紹介','新作製品','製品紹介','product launch','product reveal'],
 'goal:onboarding':['初回','新規ユーザー','説明画面','new users','first-run','guide','introductory'],
 'goal:notification':['お知らせ','notice','message toast'],
 'goal:error':['不正','入力ミス','失敗した入力','warning','failed','mistake'],
 'goal:toggle':['オンオフ','on off','settings switch'],
 'goal:reward':['バッジ','獲得','達成した記念','earned','earning','prize','trophy'],
 'goal:navigation':['次のページ','前のページ','ページへの','between pages','navigate','page change'],
 'goal:transition':['ページへの切り替え','between pages','page change'],
 'goal:character':['挨拶','手を振って','キャラ','waves hello','waves','greet','greeting'],
 'goal:form':['入力欄','フィールド','text field','field focus'],
 'goal:ambient':['モチーフ','漂う','ゆらゆら','環境演出','motif','floating','endlessly looping'],
 'style:premium':['高級感','上質感','品のある','expensive','sophisticated','refined','high-end'],
 'style:minimal':['派手さを抑え','ひかえめ','穏やか','やさしい','そっと','calm','restrained','understated','clean','without fanfare','gentle'],
 'style:playful':['弾ませ','飛び跳ね','かわいく','元気','楽しく','bounce','bouncing','pop','cartoon','fun','lively'],
 'style:energetic':['勢い','華やか','大げさ','盛大','花火','bold','fireworks','high-energy','loud'],
 'style:cinematic':['予告編','cinema','film-like','movie-like','depth'],
 'style:technical':['きっちり','機械的','technical','precise','mechanical']
};
const TERM_ALIASES={'sticker':['ステッカー'],'弾む':['弾ける','弾けるよう','pop'],'ポップ':['pop'],'press':['click','clicked'],'tap':['タップして'],'成功':['completed','succeeded','confirmation'],'完了':['completed','finished']};
const ALL_LEXICON=Object.fromEntries(Object.entries(LEXICON).map(([key,terms])=>[key,[...terms,...(EXTRA_LEXICON[key]??[])]]));
function matches(hay,needle){
 const term=norm(needle);
 if(!term)return [];
 const escaped=term.replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff]/g,'\\$&');
 const ascii=/^[a-z0-9][a-z0-9 -]*$/.test(term);
 const regex=new RegExp((ascii?'(^|[^a-z0-9])':'')+escaped+(ascii?'(?=$|[^a-z0-9])':''),'g');
 const found=[];let m;
 while((m=regex.exec(hay))){found.push({start:m.index+(ascii?m[1].length:0),end:regex.lastIndex});if(!regex.lastIndex)regex.lastIndex++;}
 return found;
}
function isNegated(text,start,end){
 const before=text.slice(Math.max(0,start-45),start).split(/[,.，。;；!！?？\n]/).at(-1).trim();
 const after=text.slice(end,end+24).split(/[,.，。;；!！?？\n]/)[0];
 const clause=text.slice(0,end).split(/[,.，。;；!！?？\n]/).at(-1);
 if(/(?:ではなく|じゃなく|ではない|じゃない|は表示せず|は不要|はなし)/.test(clause+after)&&
    /(?:ではなく|じゃなく|ではない|じゃない|は表示せず|は不要|はなし)/.test(after))return true;
 if(/^(?:.{0,9}?)(?:すぎない|すぎず|ではない|じゃない|じゃなく|ではなく|しない|させない|せない|ない|くない|はなし|なし|避けたい|避ける|不要|禁止|控える|は表示せず)/.test(after))return true;
 if(/(?:\b(?:not|no|without|avoid|never|less)\b|\bdon't\b|\bdo not\b)(?:\s+[a-z0-9'-]+){0,4}\s*$/.test(before))return true;
 return false;
}
function evidence(text,terms){
 let positive=null,negative=null;
 for(const term of terms){for(const range of matches(text,term)){
  if(isNegated(text,range.start,range.end))negative??=term;
  else positive??=term;
 }}
 return {positive,negative};
}
export function selectRecipes(catalog,prompt,options={}){
 const text=norm(prompt);
 if(!text||/(?:what .{0,45} means|explain what|とは何|を解説|sound effect|音を作|効果音)/.test(text))return [];
 const signals=new Set(),forbidden=new Set();
 for(const [feature,terms] of Object.entries(ALL_LEXICON)){
  const e=evidence(text,terms);
  if(e.positive && !(feature==='goal:form' && e.positive==='input' && /\b(?:click|control|acknowledge)\b/.test(text)))signals.add(feature);
  if(e.negative)forbidden.add(feature);
 }
 const anyGoal=[...signals].some(x=>x.startsWith('goal:'));
 const positiveTerms=new Map();
 for(const recipe of catalog.recipes){
  const terms=recipe.terms.filter(t=>!(t==='input'&&/\b(?:click|control|acknowledge)\b/.test(text)&&!/\b(?:form|field|focus)\b/.test(text))&&evidence(text,[t,...(TERM_ALIASES[t]??[])]).positive);
  if(terms.length)positiveTerms.set(recipe.id,terms);
 }
 if(!anyGoal&&!positiveTerms.size)return [];
 const quick=/(短く|素早く|速い|quick|snappy|instantly)/.test(text);
 const slow=/(ゆったり|ゆっくり|slow|gentle|calm|smoothly)/.test(text);
 return catalog.recipes.map(recipe=>{
  let score=0;const why=[];
  for(const g of recipe.goals){
   const key='goal:'+g;
   if(signals.has(key)){score+=10;why.push(key+'(+10)');}
   if(forbidden.has(key)&&!signals.has(key)){score-=7;why.push('avoid:'+key+'(-7)');}
  }
  for(const s of recipe.styles){
   const key='style:'+s;
   if(signals.has(key)){score+=4;why.push(key+'(+4)');}
   if(forbidden.has(key)&&!signals.has(key)){score-=5;why.push('avoid:'+key+'(-5)');}
  }
  for(const term of positiveTerms.get(recipe.id)??[]){score+=2;why.push('term:'+term+'(+2)');}
  if(recipe.energy==='high'&&(forbidden.has('style:energetic')||forbidden.has('style:playful'))){score-=10;why.push('avoid:high-energy(-10)');}
  if(signals.has('style:minimal')&&recipe.energy==='low'){score+=3;why.push('energy:low(+3)');}
  if(quick&&recipe.durationMs<=700){score+=2;why.push('timing:quick(+2)');}
  if(slow&&recipe.durationMs>=650){score+=2;why.push('timing:slow(+2)');}
  const grounded=recipe.goals.some(g=>signals.has('goal:'+g))||positiveTerms.has(recipe.id);
  return {id:recipe.id,title:recipe.title,score,why,requiredRoles:recipe.roles,durationMs:recipe.durationMs,grounded};
 }).filter(x=>x.grounded&&x.score>0).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id))
 .slice(0,options.limit??5).map(({grounded,...row})=>row);
}

export function validateCatalog(catalog){
 const issues=[],ids=new Set(),sourceIds=new Set(catalog.sources.map(s=>s.id));
 for(const source of catalog.sources){
  if(source.permission!=="reference-only")issues.push(source.id+": source must default to reference-only");
 }
 for(const recipe of catalog.recipes){
  if(ids.has(recipe.id))issues.push(recipe.id+": duplicate id");ids.add(recipe.id);
  if(!recipe.structure?.steps?.length)issues.push(recipe.id+": no steps");
  const lanes=new Map();
  for(const step of recipe.structure?.steps??[]){
   if(!recipe.roles.includes(step.role))issues.push(recipe.id+": unknown role "+step.role);
   if(!["x","y","rotation","scaleX","scaleY","opacity"].includes(step.property))issues.push(recipe.id+": unsupported property "+step.property);
   if(![step.from,step.to,step.atMs,step.durationMs].every(Number.isFinite)||step.durationMs<=0||step.atMs<0)issues.push(recipe.id+": invalid keyframe segment");
   if(step.atMs+step.durationMs>recipe.durationMs)issues.push(recipe.id+": segment exceeds total");
   const k=step.role+"|"+step.property;
   if(!lanes.has(k))lanes.set(k,[]);
   lanes.get(k).push(step);
  }
  for(const [key,segments] of lanes){
   segments.sort((a,b)=>a.atMs-b.atMs);
   for(let i=1;i<segments.length;i++){
    const a=segments[i-1],b=segments[i];
    if(a.atMs+a.durationMs>b.atMs)issues.push(recipe.id+": overlap on "+key);
    if(a.atMs+a.durationMs===b.atMs&&Math.abs(a.to-b.from)>1e-8)issues.push(recipe.id+": discontinuity on "+key);
   }
   if(recipe.loop==="loop"&&Math.abs(segments[0].from-segments[segments.length-1].to)>1e-8)issues.push(recipe.id+": open loop "+key);
  }
  for(const reference of recipe.referenceIds)
   if(!sourceIds.has(reference))issues.push(recipe.id+": unknown source "+reference);
 }
 return issues;
}
export function compileRecipe(recipe,bindings,options={}){
 const fps=options.fps??60;
 if(!Number.isFinite(fps)||fps<=0)throw Error("fps must be positive");
 const duration=Math.ceil(recipe.durationMs*fps/1000)+1;
 const tracksByLane=new Map();
 for(const step of recipe.structure.steps){
  const binding=bindings[step.role];
  if(!binding||typeof binding.target!=="string"||!binding.target)
   throw Error("Missing bound target for role: "+step.role);
  const base=binding.base?.[step.property]??(["scaleX","scaleY","opacity"].includes(step.property)?1:0);
  if(!Number.isFinite(base))throw Error("Non-finite base: "+step.role+"."+step.property);
  const value=v=>step.property==="opacity"?v:(step.property==="scaleX"||step.property==="scaleY"?base*v:base+v);
  const start=Math.round(step.atMs*fps/1000);
  const end=Math.round((step.atMs+step.durationMs)*fps/1000);
  if(start>=end)throw Error("Segment too short for fps: "+step.role+"."+step.property);
  const lane=binding.target+"|"+step.property;
  if(!tracksByLane.has(lane))tracksByLane.set(lane,{target:binding.target,property:step.property,segments:[]});
  tracksByLane.get(lane).segments.push({start,end,from:value(step.from),to:value(step.to),easing:step.easing});
 }
 const tracks=[];
 for(const lane of tracksByLane.values()){
  const keyframes=[];let endOfPrevious=-1;
  lane.segments.sort((a,b)=>a.start-b.start);
  for(const segment of lane.segments){
   if(segment.start<endOfPrevious)throw Error("Overlapping bound targets: "+lane.target+"."+lane.property);
   if(segment.start===endOfPrevious&&keyframes.length){
    if(Math.abs(keyframes[keyframes.length-1].value-segment.from)>1e-6)throw Error("Discontinuous bound values");
    keyframes[keyframes.length-1].easing=segment.easing;
   }else keyframes.push({frame:segment.start,value:segment.from,easing:segment.easing});
   keyframes.push({frame:segment.end,value:segment.to});
   endOfPrevious=segment.end;
  }
  tracks.push({target:lane.target,property:lane.property,keyframes});
 }
 tracks.sort((a,b)=>a.target.localeCompare(b.target)||a.property.localeCompare(b.property));
 return {name:options.name??recipe.id,fps,duration,loop:recipe.loop,tracks};
}
function main(args){
 const catalog=loadCatalog(),cmd=args[0];
 if(cmd==="validate"){
  const errors=validateCatalog(catalog);
  if(errors.length){console.error(errors.join("\n"));process.exitCode=1;}
  else console.log(JSON.stringify({valid:true,recipes:catalog.recipes.length,sources:catalog.sources.length}));
  return;
 }
 if(cmd==="search"){
  const prompt=args.slice(1).join(" ").trim();
  if(!prompt)throw Error("Usage: search <natural language prompt>");
  console.log(JSON.stringify({prompt,matches:selectRecipes(catalog,prompt)},null,2));return;
 }
 if(cmd==="compile"){
  const recipe=catalog.recipes.find(x=>x.id===args[1]);
  if(!recipe)throw Error("Unknown recipe: "+args[1]);
  if(!args[2])throw Error("Usage: compile <recipe-id> <role-bindings.json>");
  const bindings=JSON.parse(readFileSync(resolve(args[2]),"utf8"));
  console.log(JSON.stringify(compileRecipe(recipe,bindings),null,2));return;
 }
 console.log("Usage: node scripts/motion-recipe.mjs validate | search <prompt> | compile <id> <bindings.json>");
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 try{main(process.argv.slice(2));}catch(error){console.error(error.message);process.exitCode=1;}
}

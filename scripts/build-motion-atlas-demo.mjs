// Demonstrates prompt-selected choreography bound to 3 deliberately small original vector scenes.
// Requires: npm run build; node scripts/build-motion-atlas-demo.mjs <recipe-id> <out.riv>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRiv } from "../dist/rivWriter.js";
import {loadCatalog,compileRecipe} from "./motion-recipe.mjs";
const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const W=480,H=320;
const circle=(id,x,y,size,fill,parent,z=10)=>({id,type:"ellipse",x,y,width:size,height:size,parent,z,fill:{color:fill}});
const rect=(id,x,y,w,h,fill,radius=0,parent,z=10)=>({id,type:"rect",x,y,width:w,height:h,cornerRadius:radius,parent,z,fill:{color:fill}});
const group=(id,x,y)=>({id,x,y,opacity:1,scaleX:1,scaleY:1});
function sceneFor(id){
 const groups=[],shapes=[],texts=[];
 const bg=id==="success-burst"?"#0B1727":id==="editorial-headline"?"#111827":"#080E1D";
 shapes.push(rect("background",W/2,H/2,W,H,bg,0,undefined,0));
 const put=(role,x,y)=>{
  groups.push(group(role,x,y));
  return {target:role,base:{x,y,opacity:1,scaleX:1,scaleY:1,rotation:0}};
 };
 const bindings={};
 if(id==="success-burst"){
  bindings.hero=put("hero",W/2,120);
  bindings.halo=put("halo",W/2,120);
  bindings.caption=put("caption",0,220);
  shapes.push(circle("halo-ring",0,0,124,"#1C3C57","halo",3));
  shapes.push(circle("hero-disc",0,0,92,"#0DBF99","hero",10));
  shapes.push({id:"check",type:"polygon",x:0,y:0,parent:"hero",z:11,closed:false,
   points:[{x:-20,y:0},{x:-6,y:14},{x:20,y:-15}],
   stroke:{color:"#FFFFFF",thickness:8,cap:"round",join:"round"}});
  texts.push({id:"caption-text",parent:"caption",x:0,y:0,width:W,align:"center",z:50,
   runs:[{text:"SUCCESS",font:"inter",fontSize:30,color:"#F4F8FF"}]});
 }else if(id==="editorial-headline"){
  bindings.headline=put("headline",0,122);
  bindings.rule=put("rule",W/2,183);
  bindings.caption=put("caption",0,214);
  texts.push({id:"headline-text",parent:"headline",x:0,y:0,width:W,align:"center",z:10,
   runs:[{text:"MAKE IT MOVE.",font:"inter",fontSize:37,color:"#F3F4F6"}]});
  shapes.push(rect("rule-bar",0,0,290,4,"#CEAB74",2,"rule",15));
  texts.push({id:"caption-text",parent:"caption",x:0,y:0,width:W,align:"center",z:20,
   runs:[{text:"Design has a rhythm.",font:"inter",fontSize:15,color:"#AAB4C7"}]});
 }else if(id==="premium-product-intro"){
  bindings.product=put("product",W/2,142);
  bindings.glow=put("glow",W/2,145);
  bindings.title=put("title",0,251);
  shapes.push(circle("back-halo",0,0,188,"#203D74","glow",2));
  shapes.push(rect("product-shadow",12,69,180,24,"#17203B",12,"product",5));
  shapes.push(rect("product-plate",0,0,154,146,"#DFE8F6",24,"product",10));
  shapes.push(rect("product-screen",0,-14,110,72,"#192C49",12,"product",11));
  shapes.push(circle("product-orb",0,-14,40,"#50E6D5","product",12));
  shapes.push(rect("product-base",0,45,54,7,"#91A5BE",3,"product",12));
  texts.push({id:"title-text",parent:"title",x:0,y:0,width:W,align:"center",z:50,
   runs:[{text:"BUILT TO INSPIRE",font:"inter",fontSize:24,color:"#F3F7FF"}]});
 }else throw Error("Only success-burst, editorial-headline and premium-product-intro have complete demo visuals");
 return {groups,shapes,texts,bindings};
}
export function buildDemo(id){
 const recipe=loadCatalog().recipes.find(r=>r.id===id);
 if(!recipe)throw Error("Unknown recipe: "+id);
 const visual=sceneFor(id);
 const animation=compileRecipe(recipe,visual.bindings);
 const scene={
  artboard:{name:"MotionRecipeDemo",width:W,height:H},
  fonts:[{id:"inter",bytes:new Uint8Array(readFileSync(resolve(ROOT,"assets/inter.ttf")))}],
  groups:visual.groups,shapes:visual.shapes,texts:visual.texts,
  animations:[animation],
  stateMachine:{name:"Showcase",states:[{name:"Motion",animation:id}],transitions:[{from:"entry",to:"Motion"}]}
 };
 return createRiv(scene);
}
const [id,output]=process.argv.slice(2);
if(id&&output){
 const {bytes,warnings}=buildDemo(id);
 const destination=resolve(output);
 mkdirSync(dirname(destination),{recursive:true});
 writeFileSync(destination,Buffer.from(bytes));
 console.log(JSON.stringify({recipe:id,path:destination,bytes:bytes.length,warnings}));
}else if(import.meta.url===new URL("file://"+resolve(process.argv[1]??"")).href){
 console.log("Usage: node scripts/build-motion-atlas-demo.mjs <success-burst|editorial-headline|premium-product-intro> <output.riv>");
}

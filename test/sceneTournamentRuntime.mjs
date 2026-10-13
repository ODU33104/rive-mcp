// Mandatory real Rive runtime; no graceful Chromium skip in CI.
import assert from "node:assert/strict";
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve} from "node:path";
import {buildGold} from "../scripts/build-motion-atlas-gold.mjs";
import {createRiv} from "../dist/rivWriter.js";
import {RiveHost} from "../dist/riveHost.js";
import {PAGE_SCRIPT} from "../dist/pageScript.js";
import {pivotCheck,FAIL} from "../scripts/scene-tournament-verify.mjs";
const dir=resolve("test/tmp/scene-tournament");mkdirSync(dir,{recursive:true});
const {bytes,scene}=buildGold();
const mutated=structuredClone(scene);
const body=mutated.shapes.find(s=>s.id==="caseMetal");
assert.ok(body&&body.type==="ellipse");
body.x+=8; // true art-object translation, not metadata or animation-name tamper
const tampered=createRiv(mutated);
assert.equal(Buffer.from(bytes).subarray(0,4).toString("ascii"),"RIVE");
assert.equal(Buffer.from(tampered.bytes).subarray(0,4).toString("ascii"),"RIVE");
const hand=structuredClone(scene);
hand.groups.find(g=>g.id==="minuteHand").x+=8;
assert.equal(pivotCheck(hand,{nodePath:"minuteHand",referencePath:"watch",frames:[0,270],tolerancePx:0.5}).status,FAIL);
const host=new RiveHost(PAGE_SCRIPT);
try {
  const originalInfo=await host.inspect(Buffer.from(bytes));
  const tamperInfo=await host.inspect(Buffer.from(tampered.bytes));
  for(const info of [originalInfo,tamperInfo])
    assert.ok(info.artboards.some(a=>a.name==="SolsticeChronograph"&&a.animations.some(x=>x.name==="Reveal")));
  const render=async b=>{
    const result=await host.renderFrames(Buffer.from(b),{animation:"Reveal",startTime:4,
      frameCount:1,fps:1,width:720,format:"png"});
    const png=Buffer.from(result.frames[0],"base64");
    assert.equal(png.subarray(0,8).toString("hex"),"89504e470d0a1a0a");
    return png;
  };
  const first=await render(bytes),second=await render(tampered.bytes);
  writeFileSync(resolve(dir,"art-original.png"),first);
  writeFileSync(resolve(dir,"art-tampered.png"),second);
  assert.notDeepEqual(first,second,
    "FAIL: shifted caseMetal must alter official-runtime pixels; a blind structural-only check is insufficient");
  console.log("sceneTournamentRuntime: PASS — official renderer detected +8px vector object tamper and structural pivot tamper");
}finally{await host.close();}

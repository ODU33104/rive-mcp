import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {PORT_IDS,parsePinnedSVG,importSourceFx} from "../scripts/v3-sourcefx-port.mjs";
const manifest=JSON.parse(readFileSync(new URL("../data/v3-sourcefx/source-registry.v1.json",import.meta.url),"utf8"));
assert.equal(manifest.workCount,manifest.entries.length);
assert.ok(manifest.workCount>=100);
assert.equal(new Set(manifest.entries.map(e=>e.sourceUrl)).size,manifest.workCount);
assert.ok(manifest.entries.filter(e=>e.site==="Rive Marketplace").length>=40);
assert.ok(manifest.entries.filter(e=>e.site==="permissive-source-repository").length>=40);
assert.ok(manifest.entries.filter(e=>e.state==="LINK_ONLY").every(e=>!e.sourceFile));
assert.ok(manifest.entries.filter(e=>e.site==="Rive Marketplace").every(e=>e.rights==="REFERENCE_ONLY"));
assert.equal(PORT_IDS.length,6);
assert.equal(new Set(PORT_IDS).size,6);
assert.deepEqual(new Set(Object.keys(manifest.families)),new Set(["sam","utk","kabi"]));
assert.equal(new Set(manifest.ports.map(x=>x.host)).size,6);
assert.equal(new Set(manifest.ports.map(x=>x.technique)).size,6);
assert.equal(new Set(manifest.ports.map(x=>x.file)).size,6);
for(const p of manifest.ports){
 const pin=manifest.pinning.find(x=>x.family===p.family&&x.path===p.file);
 assert.ok(pin);
 assert.match(pin.gitBlobSha,/^[a-f0-9]{40}$/);
}
assert.throws(()=>parsePinnedSVG('<svg viewBox="0 0 24 24"><path d="M0 0Z"/></svg>'),/Unsupported/);
assert.throws(()=>parsePinnedSVG('<svg viewBox="0 0 24 24"><script>alert(1)</script></svg>'),/Unsafe/);
assert.throws(()=>parsePinnedSVG('<svg viewBox="0 0 24 24"><image href="x"/></svg>'),/Unsafe/);
assert.throws(()=>parsePinnedSVG('<svg viewBox="0 0 24 24"><circle cx="1" cy="1" r="2"><animate attributeName="filter" values="1;2" dur="1s"/></circle></svg>'),/Unsupported/);
assert.throws(()=>importSourceFx("unknown"),/Unknown V3/);
for(const id of PORT_IDS){
 const v=importSourceFx(id),p=v.evidence;
 assert.equal(v.after.subarray(0,4).toString("ascii"),"RIVE");
 assert.notDeepEqual(v.before,v.after);
 assert.ok(v.after.length>3000);
 assert.equal(p.license,"MIT");
 assert.equal(p.independentAesthetics,"NOT_EVALUATED");
 assert.equal(p.visiblePixelImpact,"NOT_TESTED_UNTIL_OFFICIAL_RUNTIME");
 assert.ok(p.sourceTrackCount>=2);
 assert.equal(p.sourceNodes.length,p.importedIds.length);
 assert.ok(p.sourceNodes.every(n=>n.authoredSMIL.every(a=>a.values.length>=2&&a.keyTimes.length===a.values.length)));
 const sh=v.scene.shapes.filter(x=>x.id.startsWith("v3_sourcefx__"));
 assert.equal(sh.length,p.sourceNodes.length);
 const tracks=v.scene.animations[0].tracks.filter(x=>x.target.startsWith("v3_sourcefx__"));
 assert.ok(tracks.length>=2);
 assert.ok(tracks.every(t=>t.keyframes.length>=2&&t.keyframes.every((k,i)=>k.frame>=0&&k.frame<=270&&Number.isFinite(k.value)&&(i===0||k.frame>t.keyframes[i-1].frame))));
 assert.ok(p.embeddedAssets.fonts.length===0&&p.embeddedAssets.images.length===0);
 console.log(id,p.sourceTrackCount,"source tracks ->",tracks.length,"Rive lanes");
}
console.log("V3 sourceFX core contract PASS (official runtime still untested)");

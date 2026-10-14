// V7: actual external Poly Haven CC0 studio environment in Rive, NOT a fake
// painted bloom. FFmpeg preserves source .hdr linear float RGB before a
// bounded float16 upload; output retains source URL/SHA and HDR range.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
const hash=b=>createHash("sha256").update(b).digest("hex");
export const ENV={id:"studio_small_03",author:"Greg Zaal",
 source:"https://polyhaven.com/a/studio_small_03",
 license:"CC0-1.0",licenseUrl:"https://polyhaven.com/license",
 api:"https://api.polyhaven.com/files/studio_small_03",
 apiRules:"API usage requires Powered by Poly Haven credit; asset content itself is CC0",
 format:"Radiance RGBE .hdr",maxEdge:"512x256 native Rive GPU sampler"};
export function verifiedPolyHavenURL(apiJSON){
 const x=apiJSON?.hdri?.["1k"]?.hdr;
 if(!x?.url)throw Error("No Poly Haven original 1K HDR source metadata");
 const u=new URL(x.url);
 if(u.protocol!=="https:"||u.hostname!=="dl.polyhaven.org"||
  !/^\/file\/ph-assets\/HDRIs\/hdr\/1k\/studio_small_03_1k\.hdr$/.test(u.pathname))
  throw Error("HDR source not an official expected Poly Haven 1k studio_small_03 asset");
 return {url:u.href,remoteMD5:x.md5??null,remoteBytes:x.size??null};
}
function half(v){
 if(!Number.isFinite(v))throw Error("Nonfinite source Radiance HDR sample");
 if(v<=0)return 0;
 if(v>=65504)return 0x7bff;
 const e=Math.floor(Math.log2(v));
 if(e< -14)return Math.min(0x3ff,Math.round(v*16777216));
 const exponent=e+15;
 const mantissa=Math.max(0,Math.min(1023,Math.round((v/Math.pow(2,e)-1)*1024)));
 return (exponent<<10)|mantissa;
}
export function convertHDRToNativeFloat16(hdrPath,apiJSON,outDir){
 const provenance=verifiedPolyHavenURL(apiJSON);
 const source=readFileSync(resolve(hdrPath)),head=source.toString("latin1",0,Math.min(source.length,200));
 if(!head.startsWith("#?RADIANCE")&&!head.startsWith("#?RGBE"))throw Error("Not a genuine Radiance HDR environment");
 if(source.length<100000||source.length>40000000)throw Error("Unexpected original HDRI file size");
 const out=resolve(outDir);mkdirSync(out,{recursive:true});
 const width=512,height=256,tmp=join(out,"studio-source-f32.gbr");
 // GBR planar float from the actual ORIGINAL Radiance source. FFmpeg
 // handles RGBE scanline decoding and high dynamic range (> 1.0) natively.
 const ff=spawnSync("ffmpeg",["-nostdin","-y","-v","error","-i",resolve(hdrPath),
  "-vf","scale="+width+":"+height+":flags=lanczos",
  "-frames:v","1","-pix_fmt","gbrpf32le","-f","rawvideo",tmp],
  {encoding:"utf8",timeout:120000});
 if(ff.status!==0)throw Error("Cannot decode CC0 Studio HDR linear radiance: "+ff.stderr?.slice(-800));
 const raw=readFileSync(tmp),pixels=width*height;
 if(raw.length!==pixels*12)throw Error("FFmpeg HDR input is not 3 planar f32 RGB channels");
 const out16=Buffer.alloc(pixels*8);let peak=0,overOne=0,average=0;
 for(let i=0;i<pixels;i++){
  const g=raw.readFloatLE(i*4),b=raw.readFloatLE((pixels+i)*4),r=raw.readFloatLE((pixels*2+i)*4);
  if([r,g,b].some(x=>!Number.isFinite(x)||x<0))throw Error("Invalid source HDR radiance sample");
  const rgb=[r,g,b];peak=Math.max(peak,...rgb);
  if(rgb.some(x=>x>1))overOne++;
  average+=(r+g+b)/3;
  for(let k=0;k<3;k++)out16.writeUInt16LE(half(rgb[k]),i*8+k*2);
  out16.writeUInt16LE(0x3c00,i*8+6);
 }
 if(overOne<200||peak<2)throw Error("Source lost HDR latitude/highlights during decoding");
 const stats={schema:"external-original-PolyHaven-CC0-HDRI-f16/v1",
  asset:ENV,officialFile:provenance,sourceSHA256:hash(source),
  sourceBytes:source.length,sourceHDRPositivePixelsOverOne:overOne,sourcePeak:peak,
  sourceMeanRadiance:average/pixels,float16RGBASHA256:hash(out16),
  outputPixels:[width,height],outputBytes:out16.length,
  conversion:"original .hdr decoded to genuine linear f32 GBR then interleaved rgba16float half samples",
  clipStrategy:"float16 max 65504",toneMapped:false,
  rights:"Poly Haven Studio Small 03 CC0 by Greg Zaal; API Powered by Poly Haven credit needed",
  browserSignedPlayback:"NOT_TESTED",beauty:"NOT_EVALUATED"};
 writeFileSync(join(out,"StudioEnvironment.bin"),out16);
 writeFileSync(join(out,"polyhaven-provenance.json"),JSON.stringify(stats,null,2)+"\n");
 console.log(JSON.stringify({id:ENV.id,peak,overOne,mean:stats.sourceMeanRadiance,sourceSha:stats.sourceSHA256}));
 return stats;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const mode=process.argv[2];
 if(mode==="url"){
  const p=verifiedPolyHavenURL(JSON.parse(readFileSync(resolve(process.argv[3]),"utf8")));
  console.log(p.url);
 }else if(mode==="convert"){
  convertHDRToNativeFloat16(process.argv[3],JSON.parse(readFileSync(resolve(process.argv[4]),"utf8")),process.argv[5]);
 }else throw Error("Usage: url api.json | convert studio.hdr api.json output");
}

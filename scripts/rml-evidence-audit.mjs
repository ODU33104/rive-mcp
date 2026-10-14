// Analyze genuine CLI-produced PNG pixels; a SHA-only change is not evidence of motion.
import {readFileSync,writeFileSync,existsSync} from "node:fs";
import {resolve,join} from "node:path";
import {fileURLToPath,pathToFileURL} from "node:url";
import {inflateSync} from "node:zlib";
import {createHash} from "node:crypto";
const sha=b=>createHash("sha256").update(b).digest("hex");
const pngHeader=Buffer.from("89504e470d0a1a0a","hex");
function rgbaPNG(src){
 const bytes=Buffer.isBuffer(src)?src:readFileSync(src);
 if(!bytes.subarray(0,8).equals(pngHeader))throw Error("Invalid actual PNG signature");
 let off=8,width=0,height=0,bpp=0,interlace=0,depth=0;
 const idats=[];
 while(off+12<=bytes.length){
  const len=bytes.readUInt32BE(off);const type=bytes.toString("ascii",off+4,off+8);
  const end=off+12+len;
  if(end>bytes.length)throw Error("PNG chunk truncated");
  if(type==="IHDR"){
   width=bytes.readUInt32BE(off+8);height=bytes.readUInt32BE(off+12);
   depth=bytes[off+16];
   const color=bytes[off+17];interlace=bytes[off+20];
   bpp=color===6?4:color===2?3:0;
  }
  if(type==="IDAT")idats.push(bytes.subarray(off+8,off+8+len));
  off=end;if(type==="IEND")break;
 }
 if(depth!==8||!bpp||interlace!==0||width<80||height<80||width*height>8000000)
  throw Error("Unsupported screenshot PNG color/depth/interlace");
 const raw=inflateSync(Buffer.concat(idats)),pitch=width*bpp;
 const result=Buffer.alloc(width*height*4);let k=0;
 let last=Buffer.alloc(pitch);
 for(let y=0;y<height;y++){
  const filter=raw[k++],line=Buffer.from(raw.subarray(k,k+pitch));k+=pitch;
  if(line.length!==pitch)throw Error("PNG scanline truncated");
  for(let x=0;x<pitch;x++){
   const a=x>=bpp?line[x-bpp]:0,b=last[x],c=x>=bpp?last[x-bpp]:0;
   if(filter===1)line[x]=(line[x]+a)&255;
   else if(filter===2)line[x]=(line[x]+b)&255;
   else if(filter===3)line[x]=(line[x]+Math.floor((a+b)/2))&255;
   else if(filter===4){const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);
    line[x]=(line[x]+(pa<=pb&&pa<=pc?a:pb<=pc?b:c))&255;}
   else if(filter!==0)throw Error("Unsupported screenshot filter "+filter);
  }
  for(let x=0;x<width;x++){
   const i=x*bpp,j=(y*width+x)*4;
   result[j]=line[i];result[j+1]=line[i+1];result[j+2]=line[i+2];
   result[j+3]=bpp===4?line[i+3]:255;
  }
  last=line;
 }
 return {width,height,rgba:result,fileHash:sha(bytes)};
}
export function pixelDifference(a,b,threshold=18){
 const A=rgbaPNG(a),B=rgbaPNG(b);
 if(A.width!==B.width||A.height!==B.height)throw Error("Not comparable viewports");
 let changed=0,visPixels=0;
 for(let i=0;i<A.rgba.length;i+=4){
  const d=Math.max(...[0,1,2,3].map(k=>Math.abs(A.rgba[i+k]-B.rgba[i+k])));
  if(d>=threshold)changed++;
  const brightness=Math.max(B.rgba[i],B.rgba[i+1],B.rgba[i+2]);
  if(brightness>30&&B.rgba[i+3]>0)visPixels++;
 }
 return {width:A.width,height:A.height,changedPixels:changed,
  changedPercent:+(100*changed/(A.width*A.height)).toFixed(4),
  visiblePixels:visPixels,comparable:true,sha256:[A.fileHash,B.fileHash]};
}
export function auditCLIOutput(name,projectDir,outputDir){
 const root=resolve(projectDir),out=resolve(outputDir);
 const names=["t0.png","t1.png","t2.png"];
 const pngs=names.map(n=>join(out,n));
 const prov=JSON.parse(readFileSync(join(root,"provenance.json"),"utf8"));
 const scene=readFileSync(join(root,"scene.rml"));
 if(prov.sourceSha256!==sha(scene))throw Error("RML source changed without updating provenance");
 for(const p of pngs)if(!existsSync(p))throw Error("Missing official Rive CLI screenshot "+p);
 const riv=readFileSync(join(root,"build","rml_"+name+".riv"));
 if(riv.subarray(0,4).toString("ascii")!=="RIVE")throw Error("CLI did not emit native RIVE");
 const diffs=[pixelDifference(pngs[0],pngs[1]),pixelDifference(pngs[1],pngs[2])];
 if(!diffs.every(d=>d.width===900&&d.height===540))
  throw Error("CLI viewport did not match 900x540");
 if(!diffs.some(d=>d.changedPercent>=.02))
  throw Error("Native RML animation is not visually progressing");
 const report={...prov,route:"OFFICIAL_RIVE_CLI_RML",
  nativeRivBytes:riv.length,nativeRivSha256:sha(riv),
  sceneVisible:true,animationVisible:true,frames:3,
  officialCLIVersion:readFileSync(join(out,"rive-version.txt"),"utf8").trim(),
  pixelChanges:diffs,pngHashes:pngs.map(x=>sha(readFileSync(x))),
  beauty:"NOT_EVALUATED",distribution:"Unsigned, original scriptless .riv from official CLI",
  status:"OFFICIAL_CLI_BUILD_RENDER_PASS"};
 writeFileSync(join(out,"rml-direct-proof.json"),JSON.stringify(report,null,2)+"\n");
 console.log(JSON.stringify({id:name,bytes:riv.length,changes:diffs.map(x=>x.changedPercent),status:report.status}));
 return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 auditCLIOutput(process.argv[2],process.argv[3],process.argv[4]);
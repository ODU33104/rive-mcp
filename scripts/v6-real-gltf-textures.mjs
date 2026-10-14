// Real CC0 glTF source UV, texture images and tangent frames.
// Closed to the independently hash-pinned Khronos WaterBottle model.
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync} from "node:fs";
import {resolve,join} from "node:path";
import {tmpdir} from "node:os";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
import {packGLB,SOURCE} from "./v5-real-glb-mesh.mjs";
const sha=b=>createHash("sha256").update(b).digest("hex");
export const SOURCE_SHA256="b337e526fd6a162013c2984aeec163f5fbb4f717252724dfc3f3458bd51df94b";
export const ROLES=Object.freeze(["base","orm","normal","emissive"]);
const names={base:"PbrBase",orm:"PbrORM",normal:"PbrNormal",emissive:"PbrEmissive"};
function parse(b){
 if(b.length<32||b.toString("ascii",0,4)!=="glTF"||b.readUInt32LE(4)!==2||b.readUInt32LE(8)!==b.length)
  throw Error("Not original GLB 2.0");
 let doc,data,off=12;
 while(off+8<=b.length){let len=b.readUInt32LE(off),kind=b.readUInt32LE(off+4);
  if(off+8+len>b.length)throw Error("Broken GLB chunk bounds");
  if(kind===0x4e4f534a)doc=JSON.parse(b.toString("utf8",off+8,off+8+len).trim());
  if(kind===0x004e4942)data=b.subarray(off+8,off+8+len);
  off+=8+len;
 }
 if(!doc||!data)throw Error("GLB missing source image/mesh data");
 return {doc,data};
}
function numbers(doc,data,index,kind){
 const a=doc.accessors[index],v=a&&doc.bufferViews[a.bufferView];
 if(!a||!v||a.sparse||v.buffer!==0||a.type!==(kind==="uv"?"VEC2":"SCALAR"))
  throw Error("Unsupported original GLB accessor");
 const component=kind==="uv"?5126:a.componentType;
 if(a.componentType!==component||(![5121,5123,5125].includes(component)&&kind!=="uv"))
  throw Error("Unsupported GLB accessor numeric type");
 const size=kind==="uv"?8:component===5121?1:component===5123?2:4;
 const step=v.byteStride??size,start=(v.byteOffset??0)+(a.byteOffset??0);
 if(start+(a.count-1)*step+size>data.length)throw Error("GLB attribute range out of file");
 return i=>{
  if(i<0||i>=a.count||!Number.isInteger(i))throw Error("GLB vertex out of range");
  const pos=start+i*step;
  return kind==="uv"?[data.readFloatLE(pos),data.readFloatLE(pos+4)]:
   size===1?data.readUInt8(pos):size===2?data.readUInt16LE(pos):data.readUInt32LE(pos);
 };
}
const minus=(a,b)=>a.map((n,i)=>n-b[i]);
const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=x=>{const l=Math.hypot(...x);if(l<1e-8||!Number.isFinite(l))throw Error("Degenerate glTF tangent");return x.map(t=>t/l);};
function textureImage(doc,data,index){
 const tex=doc.textures?.[index],img=tex&&doc.images?.[tex.source];
 const v=img&&doc.bufferViews?.[img.bufferView];
 if(!img||!v||v.buffer!==0||img.uri||!["image/png","image/jpeg"].includes(img.mimeType))
  throw Error("Missing genuine embedded CC0 texture image");
 const start=v.byteOffset??0,end=start+v.byteLength;
 if(end>data.length||end-start<100)throw Error("Invalid embedded texture range");
 return {encoded:Buffer.from(data.subarray(start,end)),mime:img.mimeType,source:tex.source};
}
function rgbaFromImage(img,role,tmp,maxEdge){
 const original=join(tmp,role+(img.mime==="image/png"?".png":".jpg"));
 writeFileSync(original,img.encoded);
 const probe=spawnSync("ffprobe",["-v","error","-select_streams","v:0","-show_entries","stream=width,height","-of","json",original],{encoding:"utf8",timeout:30000});
 if(probe.status!==0)throw Error("Original source image cannot be decoded: "+role);
 const dims=JSON.parse(probe.stdout).streams?.[0];
 if(!dims||dims.width<8||dims.height<8||dims.width>8192||dims.height>8192)throw Error("Source image dimensions invalid");
 const scale=Math.min(1,maxEdge/Math.max(dims.width,dims.height));
 const w=Math.round(dims.width*scale),h=Math.round(dims.height*scale),dest=join(tmp,role+".raw");
 const proc=spawnSync("ffmpeg",["-nostdin","-v","error","-y","-i",original,"-vf","scale="+w+":"+h+":flags=lanczos","-frames:v","1","-f","rawvideo","-pix_fmt","rgba",dest],{encoding:"utf8",timeout:120000});
 if(proc.status!==0)throw Error("Unable to decode source glTF "+role+": "+proc.stderr?.slice(-500));
 const bytes=readFileSync(dest);
 if(bytes.length!==w*h*4)throw Error("Source image was not RGBA8");
 return {raw:bytes,receipt:{imageIndex:img.source,originalSha256:sha(img.encoded),
  pixelSha256:sha(bytes),originalSize:[dims.width,dims.height],uploadSize:[w,h],
  rawByteLength:bytes.length,mime:img.mime,sourceColorSpace:role==="base"||role==="emissive"?"sRGB":"linear"}};
}
export function sourceTexturedMesh(original,doc,data){
 const roots=doc.scenes[doc.scene??0]?.nodes;
 if(roots?.length!==1)throw Error("UV importer must not guess multi-root GLB order");
 const n=doc.nodes[roots[0]],mesh=doc.meshes[n?.mesh];
 if(!mesh||mesh.primitives.length!==1||n.children?.length)throw Error("Multi-primitive asset needs separate importer");
 const p=mesh.primitives[0];
 if(p.attributes?.TEXCOORD_0===undefined||p.attributes?.COLOR_0!==undefined)
  throw Error("Missing source UV0/unsupported source vertex colors");
 const uv=numbers(doc,data,p.attributes.TEXCOORD_0,"uv");
 const indices=p.indices===undefined?null:numbers(doc,data,p.indices,"index");
 const src=original.data,vertexCount=src.length/48;
 if(!Number.isInteger(vertexCount)||vertexCount%3||vertexCount<300)
  throw Error("Bad authentic source vertex count");
 const expanded=Buffer.alloc(vertexCount*72);
 const get=(i,offset)=>[0,4,8].map(k=>src.readFloatLE(i*48+offset+k));
 let min=[Infinity,Infinity],max=[-Infinity,-Infinity];
 for(let i=0;i<vertexCount;i+=3){
  const points=Array.from({length:3},(_,k)=>get(i+k,0));
  const coords=Array.from({length:3},(_,k)=>uv(indices?indices(i+k):i+k));
  const d1=minus(coords[1],coords[0]),d2=minus(coords[2],coords[0]),det=d1[0]*d2[1]-d1[1]*d2[0];
  if(Math.abs(det)<1e-8)throw Error("Original UV triangle degenerate");
  const e1=minus(points[1],points[0]),e2=minus(points[2],points[0]);
  const t=e1.map((x,j)=>(x*d2[1]-e2[j]*d1[1])/det),b=e1.map((x,j)=>(e2[j]*d1[0]-x*d2[0])/det);
  for(let k=0;k<3;k++){
   const ix=i+k,nrm=unit(get(ix,12));
   const tangent=unit(t.map((v,j)=>v-nrm[j]*dot(nrm,t)));
   const sign=dot(cross(nrm,tangent),b)<0?-1:1;
   coords[k].forEach((v,j)=>{min[j]=Math.min(min[j],v);max[j]=Math.max(max[j],v);});
   src.copy(expanded,ix*72,ix*48,ix*48+48);
   [...coords[k],...tangent,sign].forEach((v,j)=>expanded.writeFloatLE(v,ix*72+48+j*4));
  }
 }
 return {bytes:expanded,bounds:{min,max},stride:72,vertexCount,triangleCount:vertexCount/3};
}
export function importRealGLTFTextures(source,destination,{maxEdge=1024}={}){
 const glb=Buffer.from(source);
 if(sha(glb)!==SOURCE_SHA256)throw Error("Not the pinned Khronos CC0 source asset");
 if(maxEdge<128||maxEdge>2048)throw Error("Invalid real texture size budget");
 const {doc,data}=parse(glb);
 if(doc.materials?.length!==1)throw Error("Multiple materials unverified for this strict importer");
 const material=doc.materials[0],pbr=material.pbrMetallicRoughness??{};
 const ids={base:pbr.baseColorTexture,orm:pbr.metallicRoughnessTexture,
  normal:material.normalTexture,emissive:material.emissiveTexture};
 for(const [role,tex] of Object.entries(ids)){
  if(!tex||tex.texCoord&&tex.texCoord!==0)throw Error("Missing original map or unsupported UV set: "+role);
 }
 if(material.occlusionTexture?.index!==ids.orm.index)throw Error("Separate AO is not safely mapped");
 const original=packGLB(glb),mesh=sourceTexturedMesh(original,doc,data);
 const out=resolve(destination),tmp=mkdtempSync(join(tmpdir(),"rive-glb-textures-"));
 mkdirSync(out,{recursive:true});
 try{
  const receipts={};
  for(const role of ROLES){
   const img=textureImage(doc,data,ids[role].index);
   const tex=rgbaFromImage(img,role,tmp,maxEdge);
   writeFileSync(join(out,names[role]+".bin"),tex.raw);
   receipts[role]=tex.receipt;
  }
  writeFileSync(join(out,"WaterBottleTexturedMesh.bin"),mesh.bytes);
  const result={schema:"v6-real-glb-four-texture-upload/v1",
   sourceSha256:sha(glb),source:SOURCE,meshHash:sha(mesh.bytes),vertexCount:mesh.vertexCount,
   triangleCount:mesh.triangleCount,vertexStride:72,uvBounds:mesh.bounds,
   originalMaterial:{baseColorFactor:pbr.baseColorFactor??[1,1,1,1],
    metallicFactor:pbr.metallicFactor??1,roughnessFactor:pbr.roughnessFactor??1,
    normalScale:material.normalTexture.scale??1,occlusionStrength:material.occlusionTexture.strength??1,
    emissiveFactor:material.emissiveFactor??[0,0,0]},
   images:receipts,rights:"Four authentic CC0 images embedded in the original pinned Khronos WaterBottle GLB",
   noProceduralMaterialImages:true,
   sourceTextureStatus:"DECODED_AND_EXTRACTED_NOT_YET_RENDERED",
   imageReduction:"LANCZOS spatial downsample to max dimension "+maxEdge,
   visualResult:"NOT_EVALUATED"};
  writeFileSync(join(out,"texture-provenance.json"),JSON.stringify(result,null,2)+"\n");
  console.log(JSON.stringify({triangles:mesh.triangleCount,UV:mesh.bounds,maps:Object.fromEntries(ROLES.map(r=>[r,receipts[r].uploadSize]))}));
  return result;
 }finally{rmSync(tmp,{force:true,recursive:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 importRealGLTFTextures(readFileSync(resolve(process.argv[2])),resolve(process.argv[3]));

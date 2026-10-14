// Genuine third-party CC0 glTF 2.0 mesh -> Rive-native script blob compiler.
// Strictly extracts real POSITION/NORMAL/TRIANGLES/material factors from the GLB,
// never invents a bottle-shaped illustration, and rejects unsupported mesh features.
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
const SHA=b=>createHash("sha256").update(b).digest("hex");
export const SOURCE=Object.freeze({
 repo:"KhronosGroup/glTF-Sample-Assets",
 commit:"edc7c9e67c639d230715049ee31f9a96a6babbbe",
 path:"Models/WaterBottle/glTF-Binary/WaterBottle.glb",
 license:"CC0-1.0",
 author:"Microsoft, 2017 (per Khronos glTF Sample Assets metadata)",
 licenseSource:"https://github.com/KhronosGroup/glTF-Sample-Assets/blob/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/WaterBottle/LICENSE.md",
 originalFormat:"glTF Binary 2.0",
 rightsScope:"Original GLB model/texture files CC0; trademarks and source repo metadata excluded"
});
const ID=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1];
const mult=(a,b)=>{
 const out=Array(16).fill(0);
 for(let col=0;col<4;col++)for(let row=0;row<4;row++)
  for(let k=0;k<4;k++)out[col*4+row]+=a[k*4+row]*b[col*4+k];
 return out;
};
function nodeMatrix(n){
 if(n.matrix){if(n.matrix.length!==16)throw Error("Invalid glTF transform");return n.matrix;}
 const [x,y,z,w]=n.rotation??[0,0,0,1];
 const [sx,sy,sz]=n.scale??[1,1,1];
 const [tx,ty,tz]=n.translation??[0,0,0];
 const q=[1-2*(y*y+z*z),2*(x*y+z*w),2*(x*z-y*w),0,
 2*(x*y-z*w),1-2*(x*x+z*z),2*(y*z+x*w),0,
 2*(x*z+y*w),2*(y*z-x*w),1-2*(x*x+y*y),0,
 tx,ty,tz,1];
 for(let c=0;c<3;c++)for(let r=0;r<3;r++)q[c*4+r]*=[sx,sy,sz][c];
 return q;
}
function apply(m,v,p){
 const x=v[0],y=v[1],z=v[2];
 if(p)return [m[0]*x+m[4]*y+m[8]*z+m[12],m[1]*x+m[5]*y+m[9]*z+m[13],m[2]*x+m[6]*y+m[10]*z+m[14]];
 return [m[0]*x+m[4]*y+m[8]*z,m[1]*x+m[5]*y+m[9]*z,m[2]*x+m[6]*y+m[10]*z];
}
const norm=v=>{const l=Math.hypot(...v)||1;return v.map(x=>x/l);};
function parseGLB(bytes){
 if(bytes.length<32||bytes.toString("ascii",0,4)!=="glTF"||
  bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)
  throw Error("Invalid real glTF 2.0 binary header");
 let offset=12,json=null,data=null;
 while(offset+8<=bytes.length){
  const len=bytes.readUInt32LE(offset),kind=bytes.readUInt32LE(offset+4);
  const end=offset+8+len;
  if(end>bytes.length)throw Error("Bad GLB chunk bounds");
  const chunk=bytes.subarray(offset+8,end);
  if(kind===0x4e4f534a)json=JSON.parse(chunk.toString("utf8").trim());
  if(kind===0x004e4942)data=chunk;
  offset=end;
 }
 if(!json||!data||json.asset?.version!=="2.0")throw Error("Missing GLB binary or glTF JSON");
 return {doc:json,data};
}
function reader(doc,data,accessorIndex){
 const a=doc.accessors[accessorIndex],v=doc.bufferViews[a.bufferView];
 if(!a||!v||a.sparse||v.buffer!==0)throw Error("Unsupported GLB accessor");
 const comps={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];
 const bytesPer={5121:1,5123:2,5125:4,5126:4}[a.componentType];
 if(!comps||!bytesPer)throw Error("Unsupported glTF component type");
 const stride=v.byteStride??comps*bytesPer;
 const start=(v.byteOffset??0)+(a.byteOffset??0);
 if(start+(a.count-1)*stride+comps*bytesPer>data.length)throw Error("GLB vertex bounds");
 const d=new DataView(data.buffer,data.byteOffset,data.byteLength);
 return index=>{
  if(index<0||index>=a.count||!Number.isInteger(index))throw Error("Invalid index");
  const o=start+stride*index;
  return Array.from({length:comps},(_,j)=>{
   const at=o+j*bytesPer;
   if(a.componentType===5126)return d.getFloat32(at,true);
   if(a.componentType===5125)return d.getUint32(at,true);
   if(a.componentType===5123)return d.getUint16(at,true);
   return d.getUint8(at);
  });
 };
}
export function packGLB(glbBytes){
 const bytes=Buffer.from(glbBytes);
 const {doc,data}=parseGLB(bytes);
 if(doc.extensionsRequired?.length)throw Error("GLB extension-required importer is unverified");
 const raw=[],materials=[],nodes=[];
 const seen=new Set(),root=doc.scenes[doc.scene??0];
 if(!root)throw Error("Missing default glTF scene");
 const visit=(nodeId,parent)=>{
  if(seen.has(nodeId))throw Error("Shared/cyclic GLB node unsupported");
  seen.add(nodeId);
  const n=doc.nodes[nodeId];if(!n)throw Error("Missing glTF node");
  const transform=mult(parent,nodeMatrix(n));
  if(n.mesh!==undefined){
   const mesh=doc.meshes[n.mesh];
   if(!mesh)throw Error("Missing referenced real GLB mesh");
   for(const [pi,p] of mesh.primitives.entries()){
    if(p.mode!==undefined&&p.mode!==4)throw Error("Not a triangle primitive");
    if(p.targets||p.extensions||p.attributes?.JOINTS_0!==undefined)
     throw Error("Unsupported skinned/morph/extended GLB mesh");
    if(p.attributes?.POSITION===undefined||p.attributes?.NORMAL===undefined)
     throw Error("Cannot invent missing normals/positions");
    const pos=reader(doc,data,p.attributes.POSITION),normal=reader(doc,data,p.attributes.NORMAL);
    const index=p.indices!==undefined?reader(doc,data,p.indices):null;
    const count=p.indices!==undefined?doc.accessors[p.indices].count:doc.accessors[p.attributes.POSITION].count;
    if(count%3||count<=0)throw Error("Incomplete triangle mesh");
    const mat=doc.materials?.[p.material??0]??{};
    const pbr=mat.pbrMetallicRoughness??{};
    const rgba=pbr.baseColorFactor??[1,1,1,1];
    const metallic=pbr.metallicFactor??1,roughness=pbr.roughnessFactor??1;
    if(![...rgba,metallic,roughness].every(Number.isFinite))throw Error("Invalid source PBR factor");
    materials.push({name:mat.name??"source-material-"+materials.length,rgba,metallic,roughness,
     originalBaseColorTexture:pbr.baseColorTexture?.index??null,
     originalNormalTexture:mat.normalTexture?.index??null,
     originalMetallicRoughnessTexture:pbr.metallicRoughnessTexture?.index??null});
    // Every triangle vertex is an actual glTF vertex; no procedural silhouette.
    for(let j=0;j<count;j++){
     const ix=index?index(j)[0]:j;
     const p3=apply(transform,pos(ix),true),n3=norm(apply(transform,normal(ix),false));
     if(![...p3,...n3].every(Number.isFinite))throw Error("Nonfinite source GLB mesh");
     raw.push({position:p3,normal:n3,base:rgba,metallic,roughness});
    }
    nodes.push({node:n.name??String(nodeId),mesh:mesh.name??String(n.mesh),
     primitive:pi,triangles:count/3,material:materials.length-1});
   }
  }
  for(const child of n.children??[])visit(child,transform);
 };
 for(const n of root.nodes??[])visit(n,ID);
 if(raw.length<300||raw.length>240000)throw Error("Actual GLB mesh count unreasonable "+raw.length);
 const lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
 for(const x of raw)for(let i=0;i<3;i++){
  lo[i]=Math.min(lo[i],x.position[i]);hi[i]=Math.max(hi[i],x.position[i]);
 }
 const size=hi.map((v,i)=>v-lo[i]),center=lo.map((v,i)=>(v+hi[i])/2);
 const scale=2.9/Math.max(...size);
 // 12 f32: pos xyz, normal xyz, original base rgb, metallic, roughness, pad
 const packed=Buffer.alloc(raw.length*48);
 for(const [i,v] of raw.entries()){
  const attribs=[...v.position.map((x,j)=>(x-center[j])*scale),
   ...v.normal,...v.base.slice(0,3),v.metallic,v.roughness,0];
  attribs.forEach((x,j)=>packed.writeFloatLE(x,i*48+j*4));
 }
 return {data:packed,manifest:{
  schema:"rights-cleared-glb-to-native-rive-gpu/v1",source:SOURCE,
  glbSha256:SHA(bytes),packedSha256:SHA(packed),
  sourceAssetName:doc.asset.generator??"unknown",
  originalGLBBytes:bytes.length,triangleCount:raw.length/3,vertexCount:raw.length,
  strideBytes:48,bboxSource:[lo,hi],center,unitScale:scale,materialEntries:materials,
  originalTexturesPresent:materials.some(x=>x.originalBaseColorTexture!==null||x.originalNormalTexture!==null),
  textureReproduction:"NOT_IMPLEMENTED: source GLB texture maps are not yet bound to the shader",
  materialFactorTransfer:"Base RGB/metallic/roughness factors preserved per face",
  transforms:"actual node TRS applied and centered, no synthetic replacement geometry",
  topology:"original triangles expanded to vertex stream without remeshing or decimation",
  rights:"Model content CC0; original legal metadata is CC BY, not copied; logo/trademarks excluded",
  beauty:"NOT_EVALUATED"}};
}
export function packGLBFile(glbPath,destDir){
 const result=packGLB(readFileSync(resolve(glbPath)));
 const path=resolve(destDir);mkdirSync(path,{recursive:true});
 writeFileSync(join(path,"water-bottle-gpu.bin"),result.data);
 writeFileSync(join(path,"mesh-manifest.json"),JSON.stringify(result.manifest,null,2)+"\n");
 console.log(JSON.stringify({triangles:result.manifest.triangleCount,
  originalMeshSha256:result.manifest.glbSha256,vertexBytes:result.data.length}));
 return result.manifest;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 packGLBFile(process.argv[2],process.argv[3]);
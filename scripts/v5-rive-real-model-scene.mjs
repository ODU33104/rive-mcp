// Real GLB geometry rendered by Rive's original GPUCanvas mesh pipeline.
// Three camera/light/color art-direction variants. No image-backed 2D impostor.
// Asset source and texture omissions are recorded in strict provenance.
import {writeFileSync,mkdirSync,readFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {pathToFileURL} from "node:url";
const SHA=b=>createHash("sha256").update(b).digest("hex");
export const DIRECTIONS=Object.freeze({
 midnight:{label:"MIDNIGHT / sculptural shadow",clear:[.009,.014,.024],ink:[.82,.68,.46],accent:[.38,.78,.91],yaw:.58,pitch:-.08,key:.66,exposure:.67,pan:.48,title:"SILHOUETTE",eyebrow:"OBJECT STUDY  /  001",copy:"Volume rendered in light."},
 glacier:{label:"GLACIER / cold optics",clear:[.025,.045,.068],ink:[.52,.78,.83],accent:[.85,.98,.99],yaw:-.41,pitch:.14,key:.78,exposure:.77,pan:.47,title:"GLACIER",eyebrow:"MATERIAL STUDY  /  002",copy:"Clarity has a surface."},
 museum:{label:"MUSEUM / warm gallery",clear:[.063,.049,.043],ink:[.92,.77,.66],accent:[.89,.72,.48],yaw:.24,pitch:.03,key:.65,exposure:.75,pan:-.43,title:"STILL LIFE",eyebrow:"MUSEUM EDITION  /  003",copy:"An object. A new angle."}
});
const shader=String.raw`// Original GPU material authored for real Khronos WaterBottle glTF PBR geometry.
// Mesh attributes preserve source positions, normals, baseColor/metallic/roughness.
// Source textures (normal/occlusion/emissive) are NOT reproduced in this first renderer.
struct Camera {
 angle:f32,
 pitch:f32,
 key:f32,
 exposure:f32,
};
@group(0) @binding(0) var<uniform> camera: Camera;
struct VertexOut {
 @builtin(position) clip: vec4<f32>,
 @location(0) normal: vec3<f32>,
 @location(1) world: vec3<f32>,
 @location(2) base: vec3<f32>,
 @location(3) metal: f32,
 @location(4) rough: f32,
};
@vertex fn vs_main(
 @location(0) position:vec3<f32>,
 @location(1) normal:vec3<f32>,
 @location(2) base:vec3<f32>,
 @location(3) metallic:f32,
 @location(4) roughness:f32
)->VertexOut {
 let c=cos(camera.angle);
 let s=sin(camera.angle);
 let cp=cos(camera.pitch);
 let sp=sin(camera.pitch);
 let rot=vec3<f32>(position.x*c+position.z*s,position.y,position.z*c-position.x*s);
 let w=vec3<f32>(rot.x,rot.y*cp-rot.z*sp,rot.y*sp+rot.z*cp);
 let nr=vec3<f32>(normal.x*c+normal.z*s,normal.y,normal.z*c-normal.x*s);
 let nw=normalize(vec3<f32>(nr.x,nr.y*cp-nr.z*sp,nr.y*sp+nr.z*cp));
 let distance=4.45-w.z;
 let perspective=1.0/max(distance,0.2);
 var o:VertexOut;
 o.clip=vec4<f32>(w.x*2.30*perspective + SCENE_PAN_X,w.y*2.30*perspective,distance/9.0,1.0);
 o.normal=nw;
 o.world=w;
 o.base=base;
 o.metal=metallic;
 o.rough=roughness;
 return o;
}
@fragment fn fs_main(v:VertexOut)->@location(0) vec4<f32> {
 let n=normalize(v.normal);
 let l=normalize(vec3<f32>(-0.65,0.76,0.93));
 let eye=normalize(vec3<f32>(0.0,0.0,1.0));
 let h=normalize(l+eye);
 let nDotL=max(dot(n,l),0.0);
 let nDotH=max(dot(n,h),0.0);
 let fresnel=pow(1.0-max(dot(n,eye),0.0),5.0);
 let gloss=pow(nDotH,mix(8.0,120.0,1.0-v.rough));
 let shadow=.16+.84*nDotL;
 let tints=vec3<f32>(MATERIAL_TINT_R,MATERIAL_TINT_G,MATERIAL_TINT_B);
 let diff=v.base*tints*shadow*(1.0-v.metal*.45);
 let spec=vec3<f32>(LIGHT_TINT_R,LIGHT_TINT_G,LIGHT_TINT_B)*(gloss*(.42+v.metal*.77)+fresnel*(.10+v.metal*.60));
 let bounce=vec3<f32>(.13,.26,.33)*max(dot(n,vec3<f32>(.42,-.30,.61)),0.0)*.27;
 let shaded=(diff+spec*camera.key+bounce)*camera.exposure;
 return vec4<f32>(clamp(shaded,vec3<f32>(0.0),vec3<f32>(1.0)),1.0);
}
`;
const lua=String.raw`-- Real Rive GPUCanvas source mesh renderer. No fake triangles.
-- Actual mesh is a .bin BLOB extracted from rights-cleared CC0 WaterBottle GLB.
type ModelStage = {
 canvas: GPUCanvas?,
 depth: GPUTexture?,
 mesh: GPUBuffer?,
 camera: GPUBuffer?,
 bindings: GPUBindGroup?,
 pipeline: GPUPipeline?,
 size: Vector,
 time: number,
 points: number,
 title: Text?,
 kicker: Text?,
 description: Text?,
}
function init(self:ModelStage, context:Context):boolean
 self.canvas=context:gpuCanvas({width=960,height=600})
 local shader=context:shader("RealModel")
 local blob=context:blob("WaterBottleMesh")
 if not (shader and self.canvas and blob) then
  error("Actual shader/GPUCanvas/CC0 asset missing")
 end
 self.points=math.floor(blob.size/48)
 if self.points < 300 or self.points*48 ~= blob.size or self.points%3~=0 then
  error("Actual GLB packed triangles missing or corrupt")
 end
 self.mesh=GPUBuffer.new({size=blob.size,usage="vertex",data=blob.data})
 local u=buffer.create(16)
 local cameraBuffer=GPUBuffer.new({size=16,usage="uniform",data=u})
 self.camera=cameraBuffer
 self.depth=GPUTexture.new({width=960,height=600,format="depth32float",renderTarget=true})
 self.pipeline=GPUPipeline.new({
  vertex=shader,fragment=shader,
  vertexLayout={{stride=48,stepMode="vertex",attributes={
   {slot=0,format="float32x3",offset=0},
   {slot=1,format="float32x3",offset=12},
   {slot=2,format="float32x3",offset=24},
   {slot=3,format="float32",offset=36},
   {slot=4,format="float32",offset=40},
  }}},
  topology="triangle-list",
  depthStencil={format="depth32float",compare="less",write=true},
  colorTargets={{format=self.canvas.format}},
 })
 if not self.pipeline then
  error("Actual CC0 mesh pipeline failed to compile")
 end
 local layout=self.pipeline:getBindGroupLayout(0)
 self.bindings=GPUBindGroup.new({layout=layout,ubos={{slot=0,buffer=cameraBuffer}}})
 local font=context:font("Inter")
 if not font then error("Editorial text requires source-licensed Inter font") end
 local title=Text.new()
 title:append(TITLE_STRING,{font=font,size=61,paint=Paint.with({color=Color.rgb(239,239,227)})})
 self.title=title
 local kicker=Text.new()
 kicker:append(EYEBROW_STRING,{font=font,size=13,letterSpacing=2.2,paint=Paint.with({color=Color.rgb(166,182,181)})})
 self.kicker=kicker
 local description=Text.new()
 description:append(DESCRIPTION_STRING,{font=font,size=21,paint=Paint.with({color=Color.rgb(205,206,193)})})
 self.description=description
 print("REAL_CC0_GLB_GPU_TRIANGLES",self.points/3)
 return true
end
function resize(self:ModelStage,size:Vector)
 self.size=size
 if self.canvas and self.depth and size.x>0 and size.y>0 then
  local width=math.max(1,math.floor(size.x))
  local height=math.max(1,math.floor(size.y))
  self.canvas:resize(width,height)
  self.depth=GPUTexture.new({width=width,height=height,format="depth32float",renderTarget=true})
 end
end
function advance(self:ModelStage,seconds:number):boolean
 self.time+=seconds
 return true
end
function draw(self:ModelStage,renderer:Renderer)
 if not (self.canvas and self.depth and self.mesh and self.camera and self.pipeline and self.bindings) then
  return
 end
 local bytes=buffer.create(16)
 buffer.writef32(bytes,0,BASE_YAW + math.sin(self.time*.56)*.37)
 buffer.writef32(bytes,4,BASE_PITCH+math.sin(self.time*.38)*.08)
 buffer.writef32(bytes,8,LIGHT_INTENSITY)
 buffer.writef32(bytes,12,EXPOSURE)
 self.camera:write(bytes)
 local pass=self.canvas:beginRenderPass({
  color={{loadOp="clear",storeOp="store",clearColor={CLEAR_R,CLEAR_G,CLEAR_B,1}}},
  depthStencil={view=self.depth:view(),depthLoadOp="clear",depthStoreOp="discard",depthClearValue=1}
 })
 pass:setPipeline(self.pipeline)
 pass:setBindGroup(0,self.bindings)
 pass:setVertexBuffer(0,self.mesh)
 pass:draw(self.points)
 pass:finish()
 local sampler=ImageSampler("clamp","clamp","bilinear")
 renderer:drawImage(self.canvas.image,sampler,"srcOver",1)
 if self.title and self.kicker and self.description then
  renderer:save()
  renderer:transform(Mat2D.withTranslation(TEXT_ORIGIN_X,151))
  self.kicker:draw(renderer)
  renderer:restore()
  renderer:save()
  renderer:transform(Mat2D.withTranslation(TEXT_ORIGIN_X,202))
  self.title:draw(renderer)
  renderer:restore()
  renderer:save()
  renderer:transform(Mat2D.withTranslation(TEXT_ORIGIN_X,297))
  self.description:draw(renderer)
  renderer:restore()
 end
end
return function(context:Context):Layout<ModelStage>
 return {canvas=nil,depth=nil,mesh=nil,camera=nil,bindings=nil,pipeline=nil,
  size=Vector.xy(960,600),time=0,points=0,title=nil,kicker=nil,description=nil,
  init=init,resize=resize,advance=advance,draw=draw}
end
`;
export function makeRealModelDirection(id, packed,manifest){
 if(!Object.hasOwn(DIRECTIONS,id))throw Error("Unsupported art direction");
 const c=DIRECTIONS[id];
 if(!Buffer.isBuffer(packed)||SHA(packed)!==manifest.packedSha256||
  packed.length!==manifest.vertexCount*48||manifest.source.license!=="CC0-1.0")
  throw Error("No verified rights-cleared actual GLB mesh");
 const substitutions={
  BASE_YAW:c.yaw,BASE_PITCH:c.pitch,LIGHT_INTENSITY:c.key,EXPOSURE:c.exposure,
  CLEAR_R:c.clear[0],CLEAR_G:c.clear[1],CLEAR_B:c.clear[2],
  TEXT_ORIGIN_X:c.pan>0?76:570
 };
 let script=lua;
 for(const [tag,num] of Object.entries(substitutions))
  script=script.replaceAll(tag,String(num));
 for(const [tag,value] of Object.entries({TITLE_STRING:c.title,EYEBROW_STRING:c.eyebrow,DESCRIPTION_STRING:c.copy}))
  script=script.replaceAll(tag,JSON.stringify(value));
 const directionShader=shader.replaceAll("SCENE_PAN_X",c.pan<0?"(0.0 - "+Math.abs(c.pan)+")":String(c.pan))
  .replaceAll("MATERIAL_TINT_R",String(c.ink[0])).replaceAll("MATERIAL_TINT_G",String(c.ink[1])).replaceAll("MATERIAL_TINT_B",String(c.ink[2]))
  .replaceAll("LIGHT_TINT_R",String(c.accent[0])).replaceAll("LIGHT_TINT_G",String(c.accent[1])).replaceAll("LIGHT_TINT_B",String(c.accent[2]));
 const yaml="name: real_waterbottle_"+id+"\nmain: main\nartboards:\n  main:\n    width: 960\n    height: 600\n    background: \"#111922\"\noutput:\n  dir: build\nlogs:\n  problems: build/problems.log\n";
 const receipt={schema:"v5-real-cc0-glb-rive-gpu-direction/v1",variant:id,
  artDirection:c.label,source:manifest.source,modelGLBSha256:manifest.glbSha256,
  geometryShaderVaryings:"normal, position, source base color, metallic, roughness",
  textureMapsCopied:false,sourceMeshTriangles:manifest.triangleCount,
  renderedView:"NATIVE_CLI_PENDING",publishedScript:"NOT_SIGNED",
  humanAestheticReview:"NOT_EVALUATED",
  sourceImportedNotReconstructed:true};
 return {yaml,script,shader:directionShader,mesh:packed,receipt};
}
export function materializeRealModel(id,sourceDir,destination){
 const manifest=JSON.parse(readFileSync(join(resolve(sourceDir),"mesh-manifest.json"),"utf8"));
 const packed=readFileSync(join(resolve(sourceDir),"water-bottle-gpu.bin"));
 const o=makeRealModelDirection(id,packed,manifest),out=resolve(destination,id);
 mkdirSync(out,{recursive:true});
 writeFileSync(join(out,"rive.yaml"),o.yaml);
 writeFileSync(join(out,"main.luau"),o.script);
 writeFileSync(join(out,"RealModel.wgsl"),o.shader);
 writeFileSync(join(out,"WaterBottleMesh.bin"),o.mesh);
 writeFileSync(join(out,"source-licence.json"),JSON.stringify(o.receipt,null,2)+"\n");
 return {dir:out,receipt:o.receipt};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const r=materializeRealModel(process.argv[2],process.argv[3],process.argv[4]);
 console.log(JSON.stringify(r));
}
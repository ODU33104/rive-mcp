// First-party Rive Luau/WGSL authoring from source — real GPUCanvas, not a 2D glow imitation.
// Unlike the WebGL2 smoke, this project MUST contain a compiled shader asset.
// No browser/web production claim until published/signed script .riv runs in web runtime.
import {mkdirSync,writeFileSync} from "node:fs";
import {resolve,join} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath,pathToFileURL} from "node:url";
const WGSL=String.raw`// Generated original optical-field shader. Positions in clip space.
struct Vertex {
 @builtin(position) position: vec4<f32>,
 @location(0) uv: vec2<f32>,
};
@vertex fn vs_main(@builtin(vertex_index) index: u32) -> Vertex {
 var vertices=array<vec2<f32>, 3>(
  vec2<f32>(-1.0,-1.0),
  vec2<f32>(3.0,-1.0),
  vec2<f32>(-1.0,3.0));
 let p=vertices[index];
 var output: Vertex;
 output.position=vec4<f32>(p,0.0,1.0);
 output.uv=p*0.5+vec2<f32>(0.5,0.5);
 return output;
}
@fragment fn fs_main(input: Vertex)->@location(0) vec4<f32> {
 let uv=input.uv;
 let p=(uv-vec2<f32>(0.58,0.47))*vec2<f32>(1.22,1.0);
 let r=length(p);
 let base=mix(vec3<f32>(0.027,0.05,0.09),vec3<f32>(0.052,0.21,0.28),clamp(uv.y,0.,1.));
 let scan=(uv.x - 0.61)*7.5 + sin(uv.y*8.0)*0.73;
 let band=exp(0.0-scan*scan)*0.28;
 let glow=exp(-r*r*14.5)*0.52;
 let prism=0.028+0.031*sin((uv.y-uv.x)*23.0);
 let rgb=base+vec3<f32>(glow*0.26+band*0.85,glow*0.63+band*0.70,glow*0.62+prism);
 return vec4<f32>(clamp(rgb,vec3<f32>(0.),vec3<f32>(1.)),1.);
}
`;
const LUA=String.raw`-- A true Rive GPUCanvas pipeline drawing the compiled PrismMaterial.wgsl.
-- Rive official scripting API: context:gpuCanvas, shader, GPUPipeline.new,
-- beginRenderPass, draw and drawImage. Signature as in WGSL shaders docs.
type Optical = {
 canvas: GPUCanvas?,
 pipeline: GPUPipeline?,
 size: Vector,
 elapsed: number,
 path: Path,
 paint: Paint,
}
function init(self: Optical, context: Context): boolean
 self.canvas=context:gpuCanvas({width=640,height=480})
 local shader=context:shader("PrismMaterial")
 if not (self.canvas and shader) then
  error("Shader or GPUCanvas missing from Rive context")
 end
 self.pipeline=GPUPipeline.new({
  vertex=shader,
  fragment=shader,
  vertexLayout={},
  colorTargets={{format=self.canvas.format}},
 })
 if not self.pipeline then
  error("WGSL GPUPipeline creation failed")
 end
 print("PRISM_GPU_PIPELINE_READY")
 return true
end
function resize(self: Optical, size: Vector)
 self.size=size
 if self.canvas and size.x>0 and size.y>0 then
  self.canvas:resize(math.max(1,math.floor(size.x)), math.max(1,math.floor(size.y)))
 end
end
function advance(self: Optical, seconds: number): boolean
 self.elapsed+=seconds
 return true
end
function draw(self: Optical, renderer: Renderer)
 if self.canvas and self.pipeline then
  local pass=self.canvas:beginRenderPass({
   color={{loadOp="clear",storeOp="store",clearColor={0,0,0,1}}}
  })
  pass:setPipeline(self.pipeline)
  pass:draw(3)
  pass:finish()
  local sampler=ImageSampler("clamp","clamp","bilinear")
  renderer:drawImage(self.canvas.image,sampler,"srcOver",1)
 end
 -- Secondary physical diagnostic motion in native vectors, not faked GPU time.
 local w=self.size.x
 local h=self.size.y
 if w>20 and h>20 then
  self.path:reset()
  local x=w*0.53+math.sin(self.elapsed*1.25)*w*.12
  self.path:moveTo(Vector.xy(x,h*.12))
  self.path:lineTo(Vector.xy(x+w*.05,h*.88))
  renderer:drawPath(self.path,self.paint)
 end
end
return function(context:Context): Layout<Optical>
 return {canvas=nil,pipeline=nil,size=Vector.xy(640,480),elapsed=0,
  path=Path.new(),paint=Paint.with({color=Color.rgba(184,229,224,100)}),
  init=init,resize=resize,advance=advance,draw=draw}
end
`;
const YAML="name: gpu_prism_study\nmain: main\nartboards:\n  main:\n    width: 640\n    height: 480\n    background: \"#090F18\"\noutput:\n  dir: build\nlogs:\n  problems: build/problems.log\n";
const hash=x=>createHash("sha256").update(x).digest("hex");
export function gpuSourceFixture(){
 if(!WGSL.includes("@vertex")||!WGSL.includes("@fragment")||!LUA.includes("GPUPipeline.new")||
    !LUA.includes("beginRenderPass")||!LUA.includes("context:gpuCanvas"))
  throw Error("Not actually authoring full GPU Canvas source");
 return {yaml:YAML,wgsl:WGSL,luau:LUA,receipt:{
  schema:"native-cli-gpucanvas-source/v1",mode:"Rive CLI Luau/WGSL",
  actualAuthoredGPUCanvas:true,actualCompiledShader:"REQUIRES_CLI_EVIDENCE",
  trueWebRuntimeShaderPlayback:"REQUIRES_SIGNED_PUBLISH",
  rights:"original WGSL+Luau program derived from documented Rive GPU API patterns; no third-party art",
  shaderHash:hash(WGSL),scriptHash:hash(LUA),
  sourceIllustration:"procedural shader/animated vector overlay",aesthetic:"NOT_EVALUATED"}};
}
export function writeGPUFixture(root){
 const dir=resolve(root);mkdirSync(dir,{recursive:true});
 const out=gpuSourceFixture();
 writeFileSync(join(dir,"rive.yaml"),out.yaml);
 writeFileSync(join(dir,"PrismMaterial.wgsl"),out.wgsl);
 writeFileSync(join(dir,"main.luau"),out.luau);
 writeFileSync(join(dir,"source-proof.json"),JSON.stringify(out.receipt,null,2)+"\n");
 return {path:dir,...out};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const r=writeGPUFixture(process.argv[2]??"test/tmp/rml-wgsl-gpu");
 console.log(JSON.stringify({path:r.path,shader:r.receipt.shaderHash,script:r.receipt.scriptHash}));
}
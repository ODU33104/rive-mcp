// Authored source glTF 2.0 maps: baseColor(sRGB), ORM(linear), normal(linear), emissive(sRGB).
// Same real mesh and camera as V5; normal mapping uses UV-derived tangent TBN.
// This is direct GGX, NOT complete IBL/HDR PBR.
struct Camera { angle:f32, pitch:f32, key:f32, exposure:f32, };
@group(0) @binding(0) var<uniform> camera:Camera;
@group(0) @binding(1) var baseMap:texture_2d<f32>;
@group(0) @binding(2) var texSampler:sampler;
@group(0) @binding(3) var ormMap:texture_2d<f32>;
@group(0) @binding(4) var normalMap:texture_2d<f32>;
@group(0) @binding(5) var emissiveMap:texture_2d<f32>;
struct VertexOut {
 @builtin(position) clip:vec4<f32>,
 @location(0) normal:vec3<f32>,
 @location(1) world:vec3<f32>,
 @location(2) base:vec3<f32>,
 @location(3) metal:f32,
 @location(4) rough:f32,
 @location(5) uv:vec2<f32>,
 @location(6) tangent:vec4<f32>,
};
@vertex fn vs_main(
 @location(0) position:vec3<f32>,
 @location(1) normal:vec3<f32>,
 @location(2) base:vec3<f32>,
 @location(3) metallic:f32,
 @location(4) roughness:f32,
 @location(5) uv:vec2<f32>,
 @location(6) tangent:vec4<f32>)->VertexOut{
 let c=cos(camera.angle);
 let s=sin(camera.angle);
 let cp=cos(camera.pitch);
 let sp=sin(camera.pitch);
 let p=vec3<f32>(position.x*c+position.z*s,position.y,position.z*c-position.x*s);
 let w=vec3<f32>(p.x,p.y*cp-p.z*sp,p.y*sp+p.z*cp);
 let nr=vec3<f32>(normal.x*c+normal.z*s,normal.y,normal.z*c-normal.x*s);
 let tn=vec3<f32>(tangent.x*c+tangent.z*s,tangent.y,tangent.z*c-tangent.x*s);
 let distance=4.45-w.z;
 var o:VertexOut;
 o.clip=vec4<f32>(w.x*2.30/max(distance,0.2)+SCENE_PAN_X,w.y*2.30/max(distance,0.2),distance/9.0,1.0);
 o.normal=normalize(vec3<f32>(nr.x,nr.y*cp-nr.z*sp,nr.y*sp+nr.z*cp));
 o.world=w;o.base=base;o.metal=metallic;o.rough=roughness;o.uv=uv;
 o.tangent=vec4<f32>(normalize(vec3<f32>(tn.x,tn.y*cp-tn.z*sp,tn.y*sp+tn.z*cp)),tangent.w);
 return o;
}
fn toLinear(color:vec3<f32>)->vec3<f32>{
 return pow(max(color,vec3<f32>(0.0001)),vec3<f32>(2.2));
}
@fragment fn fs_main(v:VertexOut)->@location(0) vec4<f32>{
 let sourceColor=textureSample(baseMap,texSampler,v.uv);
 let orm=textureSample(ormMap,texSampler,v.uv);
 let tn=textureSample(normalMap,texSampler,v.uv).rgb*2.0 - vec3<f32>(1.0);
 let emission=toLinear(textureSample(emissiveMap,texSampler,v.uv).rgb);
 let base=toLinear(sourceColor.rgb)*v.base;
 let metal=clamp(v.metal*orm.b,0.0,1.0);
 let rough=clamp(v.rough*orm.g,0.09,1.0);
 let ao=mix(1.0,orm.r,AO_STRENGTH);
 let n0=normalize(v.normal);
 let tangent=normalize(v.tangent.xyz-n0*dot(n0,v.tangent.xyz));
 let bitangent=cross(n0,tangent)*v.tangent.w;
 let n=normalize(tangent*tn.x*NORMAL_SCALE+bitangent*tn.y*NORMAL_SCALE+n0*tn.z);
 let light=normalize(vec3<f32>(-0.62,0.84,1.0));
 let eye=normalize(vec3<f32>(0.0,0.0,1.0));
 let h=normalize(light+eye);
 let nl=max(dot(n,light),0.0);
 let nv=max(dot(n,eye),0.001);
 let nh=max(dot(n,h),0.0);
 let vh=max(dot(eye,h),0.0);
 let f0=mix(vec3<f32>(0.04),base,metal);
 let F=f0+(vec3<f32>(1.0)-f0)*pow(1.0-vh,5.0);
 let alpha=rough*rough;
 let a2=alpha*alpha;
 let d=nh*nh*(a2 - 1.0)+1.0;
 let D=a2/(3.14159*d*d+0.00001);
 let k=(rough+1.0)*(rough+1.0)/8.0;
 let gV=nv/(nv*(1.0-k)+k);
 let gL=nl/(nl*(1.0-k)+k);
 let spec=F*D*gV*gL/max(4.0*nv*nl,0.001);
 let diffuse=(vec3<f32>(1.0)-F)*(1.0-metal)*base/3.14159;
 let ambient=base*(1.0-metal)*0.22*ao+f0*0.06*ao;
 let fill=base*vec3<f32>(0.12,0.18,0.25)*max(dot(n,vec3<f32>(0.54,-0.35,0.76)),0.0)*ao;
 let keyColor=vec3<f32>(LIGHT_TINT_R,LIGHT_TINT_G,LIGHT_TINT_B);
 let exposed=((diffuse+spec)*nl*keyColor*camera.key*3.2+ambient+fill+emission*EMISSIVE_FACTOR)*camera.exposure;
 let mapped=exposed/(exposed+vec3<f32>(0.9));
 let rgb=pow(clamp(mapped,vec3<f32>(0.0),vec3<f32>(1.0)),vec3<f32>(0.454545));
 return vec4<f32>(rgb,1.0);
}

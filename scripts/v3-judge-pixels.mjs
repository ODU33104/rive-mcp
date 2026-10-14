// Minimal PNG RGBA/RGB 8-bit decoder for exact *pixel* tamper checks.
// Deliberately rejects unsupported interlace/bit depth instead of byte-hash false positives.
import {inflateSync} from "node:zlib";
const signature="89504e470d0a1a0a";
export function decodePng(buffer){
  if(buffer.subarray(0,8).toString("hex")!==signature)throw Error("not PNG");
  let pos=8,width=0,height=0,depth=0,color=0,interlace=0;
  const idat=[];let hasIHDR=false,hasIEND=false;
  while(pos+12<=buffer.length){
    const length=buffer.readUInt32BE(pos),type=buffer.toString("ascii",pos+4,pos+8);
    const data=buffer.subarray(pos+8,pos+8+length);pos+=12+length;
    if(pos>buffer.length)throw Error("truncated PNG chunk");
    if(type==="IHDR"){
      width=data.readUInt32BE(0);height=data.readUInt32BE(4);
      depth=data[8];color=data[9];interlace=data[12];hasIHDR=true;
    }else if(type==="IDAT")idat.push(data);
    else if(type==="IEND"){hasIEND=true;break;}
  }
  if(!hasIHDR||!hasIEND||!width||!height||depth!==8||![2,6].includes(color)||interlace!==0)
    throw Error("unsupported PNG format (require non-interlaced RGB/RGBA 8-bit)");
  const bpp=color===6?4:3,stride=width*bpp,raw=inflateSync(Buffer.concat(idat));
  if(raw.length!==height*(stride+1))throw Error("unexpected PNG scanline size");
  const pixels=Buffer.allocUnsafe(height*stride);let src=0;
  for(let y=0;y<height;y++){
    const filter=raw[src++];
    if(filter>4)throw Error("unknown PNG filter");
    for(let x=0;x<stride;x++){
      const p=y*stride+x,left=x>=bpp?pixels[p-bpp]:0;
      const up=y>0?pixels[p-stride]:0,corner=y>0&&x>=bpp?pixels[p-stride-bpp]:0;
      let predictor=0;
      if(filter===1)predictor=left;
      if(filter===2)predictor=up;
      if(filter===3)predictor=Math.floor((left+up)/2);
      if(filter===4){
        const q=left+up-corner,dl=Math.abs(q-left),du=Math.abs(q-up),dc=Math.abs(q-corner);
        predictor=dl<=du&&dl<=dc?left:du<=dc?up:corner;
      }
      pixels[p]=(raw[src++]+predictor)&255;
    }
  }
  return {width,height,bpp,pixels};
}
export function compareVisiblePixels(a,b,epsilon=0){
  const x=decodePng(a),y=decodePng(b);
  if(x.width!==y.width||x.height!==y.height||x.bpp!==y.bpp)
    throw Error("not comparable PNG dimensions/channels");
  let changedPixels=0,maxChannelDelta=0,sumChannelDelta=0;
  for(let p=0;p<x.pixels.length;p+=x.bpp){
    let changed=false;
    for(let c=0;c<x.bpp;c++){
      const delta=Math.abs(x.pixels[p+c]-y.pixels[p+c]);
      if(delta>epsilon)changed=true;
      maxChannelDelta=Math.max(maxChannelDelta,delta);
      sumChannelDelta+=delta;
    }
    if(changed)changedPixels++;
  }
  return {changedPixels,totalPixels:x.width*x.height,
    changedFraction:changedPixels/(x.width*x.height),
    maxChannelDelta,meanChannelDelta:sumChannelDelta/x.pixels.length};
}

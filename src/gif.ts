// RGBA フレーム列を GIF に合成する
import gifenc from "gifenc";
const { GIFEncoder, quantize, applyPalette } = gifenc;

export function encodeGif(
  frames: Buffer[],
  width: number,
  height: number,
  fps: number
): Buffer {
  const gif = GIFEncoder();
  const delay = Math.round(1000 / fps);
  for (const frame of frames) {
    const rgba = new Uint8ClampedArray(frame.buffer, frame.byteOffset, frame.byteLength);
    const palette = quantize(rgba, 256);
    const index = applyPalette(rgba, palette);
    gif.writeFrame(index, width, height, { palette, delay });
  }
  gif.finish();
  return Buffer.from(gif.bytes());
}

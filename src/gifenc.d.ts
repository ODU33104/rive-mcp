declare module "gifenc" {
  interface Encoder {
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts: { palette: number[][]; delay?: number; transparent?: boolean }
    ): void;
    finish(): void;
    bytes(): Uint8Array;
  }
  const gifenc: {
    GIFEncoder(): Encoder;
    quantize(rgba: Uint8ClampedArray | Uint8Array, maxColors: number): number[][];
    applyPalette(rgba: Uint8ClampedArray | Uint8Array, palette: number[][]): Uint8Array;
  };
  export default gifenc;
}

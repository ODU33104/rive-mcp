# V7 — Original CC0 Poly Haven Studio HDRI in Rive GPU

This is a source-based, controllable material experiment rather than another 2D decorative glow. It imports an actual high-dynamic-range environment panorama and samples reflections on the original Khronos WaterBottle glTF surface. Do not mistake it for final production art.

## External original source

- Poly Haven [Studio Small 03](https://polyhaven.com/a/studio_small_03), author Greg Zaal; work-specific [Poly Haven CC0 license](https://polyhaven.com/license).
- The source file is requested through the [official files API](https://api.polyhaven.com/files/studio_small_03), with strict host/path allowlisting; source SHA256 and original metadata are saved in the receipts.
- Display **Powered by Poly Haven** with asset/source references in evidence materials. The API's separate terms apply to API access.
- The underlying WaterBottle geometry/four maps are the previously pinned Khronos CC0 asset. Its logos/trademarks are not cleared: technical prototype only, not public commercial art.

## Genuine Rive GPU integration

- Native Rive CLI scripts decode Radiance HDR to float32 GBR via FFmpeg, then store 512x256 RGBA16float without LDR tone mapping, preserving source highlights above 1.0.
- Rive Luau allocates a GPUTexture in rgba16float, uploads the CC0 environment blob and binds it as a fifth texture next to the original glTF four PBR texture maps.
- WGSL calculates reflection direction from the actual transformed normal map, samples the Poly Haven equirectangular environment, and applies a reflection component based on the source metalness, roughness and Fresnel coefficient.
- For each of MIDNIGHT, GLACIER and MUSEUM the exact same source, material shader, camera and timeline are rendered with either original HDR radiance or a flat 0.20 linear-intensity control. Official CLI screenshot pixel comparisons and real 31-frame PNG/GIF capture fail if actual HDR material differences disappear.

## Limitations and release gate

- Not a full physically correct IBL implementation: no prefiltered roughness mips, diffuse irradiance convolution, BRDF LUT, cast shadows, transmission or ray-traced reflections.
- The original WaterBottle's logo-like decal is NOT cleared under a trademark permission. Set release gate QUARANTINED_MODEL_LOGO; do not market this as a cleared unbranded product.
- Script-bearing native Rive outputs are unsigned. Web playback needs authenticated official Rive publication/signing; not attempted in CI.
- A changed pixel is evidence of original HDR source actually affecting native Rive, NOT evidence of artistic beauty; human scores remain NOT_EVALUATED.

## Repro

Run npm ci and npm run build, install first-party Rive CLI with GPU libraries, download the Poly Haven studio_small_03 1K HDR through official API, and run the executable workflow .github/workflows/v7-studio-hdri.yml. Keep output on feature branches until both rights and actual image quality reviews pass.

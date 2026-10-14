# V5: actual rights-cleared GLB geometry in Rive GPUCanvas

## User goal
The previous Rive results looked like flat illustrations with generic FX. We must **not** count a WGSL gradient or 100 external links as a high-end 3D product. This line is the first technical transition from project-original low-complexity vector silhouettes to a genuine artist-created third-party 3D model, processed into native Rive GPU buffers with actual vertex positions, normals and primitive PBR parameters.

## Original external source (inspect before using)
- Khronos glTF Sample Assets: [WaterBottle](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/WaterBottle/README.md).
- Pinned immutable repository commit `edc7c9e67c639d230715049ee31f9a96a6babbbe`, model `Models/WaterBottle/glTF-Binary/WaterBottle.glb`.
- Work-specific [LICENSE.md](https://github.com/KhronosGroup/glTF-Sample-Assets/blob/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/WaterBottle/LICENSE.md) states that **the model files (GLB and texture content) are CC0-1.0**; metadocumentation is CC-BY-4.0, trademarks/logos excluded. Metadata credits Microsoft, 2017, public-domain dedication. Rights verified using immutable remote source in CI, not inferred from the repository root.
- **The repository does not claim license transfer for any extra unrelated third-party assets.** The source GLB is downloaded and checked during CI. The file is not copied to git. The generated native .riv retains model-derived geometric content; receipt includes source SHA256 and compiled SHA256.

## Actual geometry/model implementation
- `scripts/v5-real-glb-mesh.mjs`: validates GLB 2.0 magic, chunks, glTF default scene, node transforms, primitives, indices, real position/normal accessors and bounds; rejects unsupported required extensions, skinning, morphs, missing normals and malformed data. Traverses node hierarchy, expands actual source triangle indices losslessly (no retopology or procedural lookalike), creates 48-byte per-vertex float layout. Stores real source PBR baseColor factors, metallic/roughness per face, normalized model positions. Saves a source/rights SHA-linked receipt.
- `scripts/v5-rive-real-model-scene.mjs`: three real scripted Rive projects loading `WaterBottleMesh.bin` through `context:blob`, `GPUBuffer.new` for vertex/uniform data, actual depth attachment, WebGPU-style WGSL vertex transforms and fragment lighting, a real `GPUPipeline` and `GPUCanvas`. Yaw animation and key light direction generated in Luau script; compiles to a native .riv with first-party CLI.
- Three non-identical art-direction variants: `midnight` (dark sculpted product), `glacier` (bright cold optics), `museum` (warm gallery). Vary camera yaw/pitch, key illumination/exposure and background. **These are technical look-development candidates, not validated premium commercial art.**
- `scripts/v5-real-gpu-audit.mjs`: validates native RIVE binary, rights/manifests, source mesh bytes, genuine 960x600 first-party framebuffer with spatial contrast and animation between 0.6s/2.8s. Rejects blank/faked/static output. GitHub Actions matrix renders all three independently using official Rive CLI.

## Limitations and quality gate
- Original GLB's **texture maps, occlusion and normal maps are NOT YET REPRODUCED**; shader uses the source geometric normals and material baseColor/metallic/roughness factors in a bespoke *approximate* analytic BRDF. It is incorrect to claim full glTF PBR or physically accurate refraction. No HDRI environment yet.
- GPU Canvas rendering is via first-party **local CLI native runtime**, not a signed public web runtime. The compiled script-bearing `.riv` must be signed with `rive --publish` for web use; that requires the user's own authorized Rive account. Never bypass this.
- Artifact release status is research. Human stylistic preference and the "surprise" metric are **NOT_EVALUATED**. We must inspect the visual frames and reject if material lighting is implausible, silhouette wrong, clipped or visually weak. Do not merge to the production feature branch solely because 3 CI jobs pass.
- Rive Editor `.rev` export needs Rive authentication. Mesh data remains editable in the project's source GLB, shader and RML/Luau. Do not mislabel triangles as editable ordinary Rive 2D paths.
- The parser does not yet support Draco/Meshopt, skinning, animation from GLB, arbitrary sRGB textures or all glTF extensions; it refuses incompatible source GLB.
- The 3 art-directions share a model and are not three independent genres. Distinct genre composition is subsequent work.

## Repro
```bash
npm ci && npm run build
curl -L --fail https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/edc7c9e67c639d230715049ee31f9a96a6babbbe/Models/WaterBottle/glTF-Binary/WaterBottle.glb -o test/tmp/v5-source/WaterBottle.glb
node scripts/v5-real-glb-mesh.mjs test/tmp/v5-source/WaterBottle.glb test/tmp/v5-packed
node test/v5RealModel.mjs test/tmp/v5-source/WaterBottle.glb test/tmp/v5-packed test/tmp/v5-projects
rive test/tmp/v5-projects/midnight --verify
rive test/tmp/v5-projects/midnight --once
rive test/tmp/v5-projects/midnight --screenshot=test/tmp/v5-output/midnight/early.png --viewport=960x600 --advance=0.6s
```

This is part of the motion-recipe-atlas **feature branch**, not main. Before any main merge, check original rights attribution, source model shader appearance and browser runtime distribution.

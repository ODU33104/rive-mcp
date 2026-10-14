# V6 — restore the *actual* original glTF PBR texture maps in Rive

## Why this changes the visual ceiling

The V5 CC0 WaterBottle had genuine 4510-triangle geometry and normals, but discarded the *source* model's **baseColor, ORM (occlusion / roughness / metallic), normal and emissive image maps**. Its matte gray appearance was partly self-inflicted; adding more generic SVG glints cannot reproduce the actual model material. According to the [Khronos glTF PBR specification](https://www.khronos.org/gltf/pbr) and [official WaterBottle material breakdown](https://github.com/KhronosGroup/glTF-Tutorials/blob/main/gltfTutorial/gltfTutorial_014_AdvancedMaterial.md), this exact model deliberately contains these four complementary texture maps. Its roughness changes between body and cap; metallic map differentiates parts, normal map provides surface relief and emissive map supplies local markings.

## Actual implementation

- **Pinned real source and rights**: exact Khronos repository commit `edc7c9e67c639d230715049ee31f9a96a6babbbe`, original GLB SHA256 `b337e526fd6a162013c2984aeec163f5fbb4f717252724dfc3f3458bd51df94b`. CI downloads original GLB, exact per-model CC0 license and legal metadata; no unrelated assets.
- `scripts/v6-real-gltf-textures.mjs` extracts all four **real binary image bufferViews** embedded in the GLB, verifies image MIME and compressed hashes, decodes through ffmpeg at original aspect ratio (1024px max edge, with Lanczos if a resize is needed), stores raw RGBA8 GPU upload blobs and per-map dimensions, hashes and color-space labels. Also preserves actual glTF `TEXCOORD_0` and derives tangent/bitangent handedness from the original transformed triangle positions and UVs (each GLB vertex retained). Strictly refuses unsupported topology, multi-material assumptions, missing original textures and source hash mismatches.
- `scripts/v6-authentic-4map.wgsl` samples real original source images in Rive GPU. Base color + emissive map decoded from sRGB, ORM R=AO G=roughness B=metal, actual tangent-space normal samples applied to the model's normal basis. Analytic GGX direct-light material with source per-vertex baseColor, metallic/roughness factors. Source geometry, keyed camera path, brand-independent original typography and shader projection inherited from V5.
- `scripts/v6-textured-rive-project.mjs` makes one native Rive project with **actual textures and one with neutral constant maps** (identical shader, geometry, camera and timeline). Four GPUTexture uploads and one GPUBindGroup with shader-bound textures and sampler; source image blobs embedded in the native `.riv`. Neutral maps have the same dimensions as source maps, but white/neutral-normal/black-emissive pixels.
- `scripts/v6-original-pbr-ablation.mjs` measures actual official Rive CLI pixel differences against the neutral-map version at exactly matching times and canvas dimensions, requiring meaningful visible effect. This is a controlled *causal* map-use test, not only a comparison between different material shaders. Also creates 31 genuine original Rive time-indexed PNG frames / GIF per direction.
- Original 3 color/camera/typography directions: MIDNIGHT, GLACIER, MUSEUM. Their source art still may be aesthetically unremarkable; no beauty awards from CI.

## Material fidelity boundaries (very important)

- **Actually restored:** UV0, tangent basis, source baseColor, metallicRoughness, normal, emissive image pixels; occlusion only because this WaterBottle's occlusionTexture index **shares** the ORM map. Maps maintain original source SHA links.
- **Not full reference glTF PBR:** no physically correct environment-map image-based lighting, HDRI environment, transmission/clearcoat, full glTF texture transform/alternate UV sets, sophisticated tangent smoothing at UV seams, perfect sRGB transfer curve (shader uses gamma ≈2.2 rather than exact piecewise), no multiple material imports. Texture resolution may be reduced to 1024px, documented in receipts.
- **Not authorized for public web runtime yet:** Local native `rive --once` creates a script-bearing unsigned `.riv`. Rive web deployment requires authorization and official `--publish` signing; none is attempted in this CI. Editor revision `.rev` editing also remains separate from source-script/GLB editability.
- **Not evidence of “WOW”:** A/B pixel difference proves texture pixels affect the real rendering, not that a person prefers the result. Source material maps may reveal new defects, which need art-direction correction. Maintain PR as draft until images manually reviewed.

## Commands

```bash
npm ci && npm run build
# Install Rive CLI from official releases.rive.app; ffmpeg/ffprobe on PATH
node scripts/v5-real-glb-mesh.mjs test/tmp/v6-source/WaterBottle.glb test/tmp/v6-legacy
node test/v6OriginalPBR.mjs test/tmp/v6-source/WaterBottle.glb test/tmp/v6-legacy test/tmp/v6-textures test/tmp/v6-scenes
cp assets/inter.ttf test/tmp/v6-scenes/midnight-textured/InterFont.bin
rive test/tmp/v6-scenes/midnight-textured --verify
rive test/tmp/v6-scenes/midnight-textured --once
rive test/tmp/v6-scenes/midnight-textured --screenshot=test/tmp/v6-output/midnight/textured-early.png --viewport=960x600 --advance=0.6s
```

CI is the executable proof: [V6 Actions](https://github.com/ODU33104/rive-mcp/actions/workflows/v6-glb-textures.yml). This branch adds a material route to V5 rather than replacing existing authoring methods. No main merge.

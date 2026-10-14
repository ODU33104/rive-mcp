# First-party WGSL GPUCanvas source — real compilation/rendering gate

The old independent WebGL2 opt-in probe (PR #87) tests GPU Canvas runtime prerequisites but **has no authored shader**. This branch deliberately creates a real, original `PrismMaterial.wgsl` and `main.luau` Rive GPU pipeline using the official [Rive shader authoring docs](https://github.com/rive-app/rive-docs/blob/main/scripting/wgsl-shaders.mdx) and the Rive CLI-supplied `hello_rive` sample's layout-script contract.

## Actual architecture

- **Shader source**: independently authored WGSL vertex shader using a fullscreen triangle, and a fragment shader computing material light gradients and a curved optical light band. No borrowed artwork.
- **Rive Luau source**: a Layout script obtains `context:gpuCanvas`, `context:shader("PrismMaterial")`, constructs a `GPUPipeline`, calls `beginRenderPass`, `pass:draw(3)`, and composites the actual GPU Canvas image via Rive `Renderer:drawImage`. Also animates a thin native vector line as a diagnostic independent timeline.
- **CLI project**: `rive.yaml` sets a 640×480 script artboard. `.luau` and `.wgsl` are bundled automatically by official CLI, no pseudo-JSON-to-Rive writer. `--verify`, `--once`, `inspect --summary`, and 0.4/1.8s screenshots are required.
- **Strict audit**: source exact hashes, real native RIVE binary, actual GPU screenshot gradient spatial color variation, and between-time vector pixel differences; stage must fail if shader absent/flat or runtime returns a fallback.
- **Licensing**: original script/shader authored for this repo. No copied 3D/HDR/third-party asset in this proof.

## Publication constraint (CRITICAL)

`rive --once` creates an unsigned local `.riv`. Rive's docs explicitly state **files containing scripts intended for web runtime require `--publish` and a logged-in, signing Rive account**. The current GitHub CI must not silently attempt bypassing this. Successful local CLI screenshots only establish that the **official CLI compiler and its native renderer** can actually execute WGSL GPUCanvas. It is *not* automatically a web-distributable script file.

For web deployment, the next step needs explicit authorization/connection to a permitted Rive workspace to publish and sign, verify watermark/plan terms and test `@rive-app/webgl2` with `enableGPUCanvas:true`, `useOffscreenRenderer:false`. The independent Rive WebGL2 proof PR #87 separately established the latter runtime's technical readiness on a 2D test file.

## Quality limitations

A working WGSL program does not prove a professional-level glass bottle, 3D shadows, GLB/PBR or motion design quality. The material in this proof is deliberately abstract/procedural. For production, apply it to a carefully constructed product scene with a rights-cleared CC0 GLB/HDRI and controlled styleframes, compare with current vector reference, and obtain actual human feedback. **No aesthetic superiority is claimed.**

## Reproduce

```bash
npm ci && npm run build
node test/nativeGpuShader.mjs test/tmp/rml-wgsl-gpu
# Install official CLI as documented, including libEGL/libGLESv2/libX11 on Linux
rive test/tmp/rml-wgsl-gpu --verify
rive test/tmp/rml-wgsl-gpu --once
rive test/tmp/rml-wgsl-gpu --screenshot=test/tmp/rml-wgsl-render/gpu-early.png --advance=0.4s --viewport=640x480
node scripts/native-gpu-shader-audit.mjs test/tmp/rml-wgsl-gpu test/tmp/rml-wgsl-render
```

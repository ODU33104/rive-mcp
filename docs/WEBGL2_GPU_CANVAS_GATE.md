# WebGL2 / GPU Canvas renderer evidence gate

Rive official docs:
- https://github.com/rive-app/rive-docs/blob/main/runtimes/web/gpu-canvas.mdx
- https://github.com/rive-app/rive-docs/blob/main/runtimes/web/canvas-vs-webgl.mdx
- https://github.com/rive-app/rive-wasm/releases/tag/2.42.0

Rive GPU Canvas requires `@rive-app/webgl2` >=2.42.0, with `enableGPUCanvas: true`, `useOffscreenRenderer:false`. This opt-in is experimental. The existing project used `@rive-app/canvas-advanced`, which can silently omit WebGL2-only features including GPU Canvas and vector feathering. These should not be certified using the Canvas runtime.

## Implemented here

- Standalone Playwright/Chromium WebGL2 renderer with an explicitly opted-in Rive instance and unique canvas/context.
- Native Solstice benchmark `.riv` from current original source builder; not a fabricated image.
- Pinned `@rive-app/webgl2@2.44.2` in isolated CI install, four actual composited browser screenshots of the same native animation and Rive Renderer load/animation checks.
- Strict API policy gate denies Canvas, disabled GPU flag and conflicting `useOffscreenRenderer:true`.
- Source hashes, browser capability and evidence saved in `webgl2-probe.json`.

## Crucial distinction

**This source Rive file has no authored GPUCanvas element, GLSL/WGSL shader, 3D model or vector feather!** Thus this first probe tests the WebGL2 compatible runtime with the GPU Canvas opt-in; it does **not** prove a shader ran or GLB materials are working. The evidence deliberately calls this `RENDERER_READY_ONLY`, not `GPU_SHADER_PASS`. Rendering a pretty old 2D watch via WebGL2 says nothing about visual improvement. Future stage must acquire a Rive file containing actual licensed GPU Canvas content, use first-party RML `.wgsl` + `.luau` or source-owned `.rev`, and verify actual shader pixels against disabled mode. Do not insert a fake bloom circle to pretend this passed.

## CI

`node test/webgl2GpuProbe.mjs`

`node scripts/webgl2-gpu-probe.mjs test/tmp/gpu-webgl2-probe` (after `npm run build` and installing `@rive-app/webgl2@2.44.2`, pinned Playwright chromium).

The future visual acceptance should use the same artboard, source, assets and animation timeline across Canvas and WebGL2 for fairness. Require source license/asset hashes, material parameters, framebuffer readback, browser driver and WebGL2 extension support; prevent promotion when GPUCanvas file contains no shader objects. Measure startup/render cost and use WebGL context limit budgets.

## Design direction

Styleframe candidates and polished 3D materials are a **separate creative lane**. The GPU runtime does not make crude shapes beautiful by itself. Take a rights-verified CC0 GLB + HDRI from Poly Haven (asset license independent of its API use terms), actually adapt and license-check, then build the corresponding RML + GPU Canvas scene. That asset acquisition/authoring has not been performed in this smoke PR.

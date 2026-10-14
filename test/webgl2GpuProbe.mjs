import assert from "node:assert/strict";
import {checkGPUCanvasUse} from "../scripts/webgl2-gpu-probe.mjs";
assert.deepEqual(checkGPUCanvasUse("canvas",{enableGPUCanvas:true,useOffscreenRenderer:false}).status,"UNSUPPORTED");
assert.equal(checkGPUCanvasUse("webgl2",{enableGPUCanvas:false,useOffscreenRenderer:false}).status,"DISABLED");
assert.equal(checkGPUCanvasUse("webgl2",{enableGPUCanvas:true,useOffscreenRenderer:true}).status,"INVALID_SHARED_CONTEXT");
assert.equal(checkGPUCanvasUse("webgl2",{enableGPUCanvas:true,useOffscreenRenderer:false}).status,"RENDERER_READY_ONLY");
assert.equal(checkGPUCanvasUse("webgl2",{enableGPUCanvas:true,useOffscreenRenderer:false},true).status,"SHADER_TEST_ELIGIBLE");
console.log("PASS: GPU canvas requires WebGL2 and no shared offscreen renderer; smoke does not fake actual shader support");

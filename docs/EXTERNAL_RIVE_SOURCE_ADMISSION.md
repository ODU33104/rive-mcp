# Actually acquired Rive source and source model — Kabi, CC BY 4.0

**This imports externally authored Rive art, not a hand-drawn substitute.** Upstream work by Bryl Lim: https://github.com/bryllim/kabi-mascot. Source commit `7dee2abc2320fcc72f08c7064214ba9df84687f5`. The repository explicitly licenses its artwork, generated RIVE binary, and code under CC BY 4.0. Attribution: *Kabi mascot by Bryl Lim, licensed CC BY 4.0*.

CI legally downloads actual `dist/kabi.riv`, `dist/kabi.model.json`, and `LICENSE` from pinned upstream commit. No binaries are silently checked into our code. The editable model contains 107 source shapes, 81 rig nodes, 65 animations, one state machine, and 29 documented poses. It is editable through the upstream model editor; the compiled `.riv` is a **runtime asset, not a Rive Editor project**.

## Real runtime proof

After verifying native `RIVE` magic, source format, original geometry, attribution and LICENSE, our existing official Rive Canvas runtime inspects the artboard and native state machine inputs. It captures four real poses: idle, celebrate, thinking, boxing. Each applies actual `pose`, `mood`, `color` inputs to the original native state machine and captures 23 PNG frames, exports the real GIF via ffmpeg, writes source byte hashes and attribution metadata. If state machine/animation compatibility fails, CI FAILS; no fake images are substituted.

## Separate rights gate

The creator's repository says the art was traced from `reference.jpeg`. **Until the provenance and reuse rights of that reference image are independently checked, do not promote the source to freely redistributable production assets.** The CI artifact is an attributed technical research output. The work-level CC BY permission does not override embedded rights. Do not claim Kabi is directly transplantable into arbitrary `.riv` scenes; it demonstrates a much richer existing character rig and renderer comparison than the simplistic original Luma mascot.

## Commands

    npm ci && npm run build
    node test/externalKabiAdmission.mjs
    # CI downloads source into test/tmp/external-kabi/source
    node test/externalKabiAdmission.mjs test/tmp/external-kabi/source
    RIVE_MCP_CHROME=/path/to/Chrome node scripts/external-kabi-admission.mjs test/tmp/external-kabi/source test/tmp/external-kabi/output

**A code-verified source and a native runtime render do not mean the app can already combine this character with arbitrary Rive scenes.** Native editable scene merging and in-app authoring remain separate engineering work.

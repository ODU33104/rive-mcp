---
name: rive-setup
description: Use when configuring rive-mcp in a new client or project, checking tool availability, or installing the bundled skills.
---

# Rive MCP setup

Use this for environment setup, not normal authoring.

## Checklist

1. Confirm the MCP server is connected and `tools/list` exposes the expected Rive tools.
2. Run `riv_setup` when the client supports local skills. The tool copies all bundled Rive skills into the selected project or user skill directory.
3. Confirm `rive-author`, `rive-refine`, `rive-qa` and `rive-design-guidelines` are discoverable after installation.
4. For clients without skill support, use the `rive-design-guidelines` MCP prompt as the craft reference.
5. Keep project-specific paths, tokens and credentials outside the skill files.

Do not use setup work as a substitute for testing the actual MCP workflow.

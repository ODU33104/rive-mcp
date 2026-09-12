import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

export type ToolCategory =
  | "inspect"
  | "render"
  | "author"
  | "review"
  | "integration"
  | "studio"
  | "setup";

export type ToolStability = "stable" | "experimental";

export interface ToolManifestEntry {
  name: string;
  title: string;
  description: string;
  category: ToolCategory;
  stability: ToolStability;
}

const CATEGORY_BY_NAME: Record<string, ToolCategory> = {
  riv_list: "inspect",
  riv_inspect: "inspect",
  riv_dump: "inspect",
  riv_decompile: "inspect",
  riv_diff: "inspect",
  riv_render_frame: "render",
  riv_render_gif: "render",
  riv_render_apng: "render",
  riv_render_video: "render",
  riv_render_sprites: "render",
  riv_batch_render: "render",
  riv_visual_diff: "render",
  riv_ab_compare: "render",
  riv_create: "author",
  riv_edit: "author",
  riv_optimize: "author",
  riv_rig_character: "author",
  riv_design_tokens: "author",
  riv_lint: "review",
  riv_critique: "review",
  riv_finalize: "review",
  riv_import_svg: "integration",
  riv_asset_search: "integration",
  riv_lottie_import: "integration",
  riv_extract_assets: "integration",
  riv_generate_code: "integration",
  riv_play_state_machine: "integration",
  riv_slice_image: "integration",
  riv_ui_detect: "integration",
  riv_ui_prototype: "integration",
  riv_studio: "studio",
  riv_studio_notes: "studio",
  riv_setup: "setup",
};

const EXPERIMENTAL = new Set<string>([
  "riv_ui_detect",
  "riv_ui_prototype",
]);

export class ToolRegistry {
  private readonly entries: ToolManifestEntry[] = [];
  private readonly names = new Set<string>();

  constructor(private readonly server: McpServer) {}

  register(...args: any[]): any {
    const name = args[0] as string;
    const config = (args[1] ?? {}) as { title?: string; description?: string };
    if (this.names.has(name)) throw new Error("Duplicate tool registration: " + name);
    const category = CATEGORY_BY_NAME[name];
    if (!category) throw new Error("Tool category missing for: " + name);
    this.names.add(name);
    this.entries.push({
      name,
      title: config.title ?? name,
      description: config.description ?? "",
      category,
      stability: EXPERIMENTAL.has(name) ? "experimental" : "stable",
    });
    return (this.server.registerTool as any)(...args);
  }

  manifest(): readonly ToolManifestEntry[] {
    return this.entries.map((entry) => ({ ...entry }));
  }

  count(): number {
    return this.entries.length;
  }
}

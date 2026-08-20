// 検出済みの UI 要素 + 役割から、動くプロトタイプのシーン仕様を組み立てる。

export type Role =
  | "background" | "nav" | "header" | "card" | "panel" | "button"
  | "text" | "icon" | "image" | "chart" | "list-item" | "badge"
  | "divider" | "avatar" | "input" | "fab";

export interface RoleMotion {
  entrance: string;
  idle?: string;
  hover?: "lift" | "grow" | "tint" | "spin";
  press?: boolean;
}

/**
 * entrance / idle には motionPresets.ts の PRESET_NAMES に実在する名前だけを書く。
 * 存在しない名前は展開時に黙って無視され、「動かない .riv」ができる。
 * 例外は "chart-grow"（Task 6 でこのファイルが自前で組む合成モーション）。
 *
 * idle は常時ループする「待機中の動き」の枠なので、AMBIENT_PRESETS に
 * 属する名前だけを書く。heartbeat/attention 等のワンショット強調系を
 * 書くと一度動いて止まり、それ以降は静止したプロトタイプになる。
 */
export const ROLE_MOTION: Record<Role, RoleMotion> = {
  background:  { entrance: "fade-in" },
  nav:         { entrance: "slide-in" },
  header:      { entrance: "slide-in" },
  card:        { entrance: "pop-cascade", idle: "float", hover: "lift" },
  panel:       { entrance: "stagger-in", idle: "float" },
  button:      { entrance: "swoop-in", hover: "grow", press: true },
  fab:         { entrance: "swoop-in", idle: "breathing", hover: "grow", press: true },
  text:        { entrance: "fade-in" },
  icon:        { entrance: "pop-cascade", hover: "spin" },
  image:       { entrance: "fade-in" },
  chart:       { entrance: "chart-grow" },
  "list-item": { entrance: "stagger-in", hover: "tint" },
  badge:       { entrance: "pop-cascade", idle: "glow-pulse" },
  divider:     { entrance: "fade-in" },
  avatar:      { entrance: "pop-cascade", hover: "spin" },
  input:       { entrance: "fade-in", hover: "tint" },
};

export function motionFor(role: string): RoleMotion {
  return ROLE_MOTION[role as Role] ?? ROLE_MOTION.panel;
}

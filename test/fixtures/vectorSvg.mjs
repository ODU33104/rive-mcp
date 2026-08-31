// ベクター入力（SVG）経路のフィクスチャ。
// 実際の Figma / Illustrator エクスポートで出てくる形を狙って書いてある:
//   - フレーム＝<g>、レイヤー名は id か data-name
//   - <svg fill="none"> の継承、defs のグラデーション参照
//   - グループへの transform（translate / scale / rotate）
//   - 矩形がパスで書き出されることがある（"Divider"）
//   - ラベルは <text>（M3 まで取り込めないので警告になる）か、アウトライン化されたパス
// リポジトリに入れるのは自分で書いた SVG だけ。他人の著作物は置かない。

/** 角丸・グラデーション・アイコンパス・ボタン。<text> を含まないので画素比較に使える */
export const DASHBOARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420" viewBox="0 0 640 420">
  <defs>
    <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#7C5CFF"/>
      <stop offset="1" stop-color="#2AC3B0"/>
    </linearGradient>
  </defs>
  <rect id="Background" width="640" height="420" fill="#F4F6FA"/>
  <g id="NavBar">
    <rect x="0" y="0" width="640" height="56" fill="#12203A"/>
    <path id="LogoIcon" d="M20 28 L28 16 L36 28 L28 40 Z" fill="#7C5CFF"/>
  </g>
  <g id="StatsCard">
    <rect x="24" y="80" width="280" height="180" rx="12" fill="#FFFFFF"/>
    <rect id="ChartArea" x="44" y="120" width="240" height="100" rx="6" fill="url(#chartGrad)"/>
  </g>
  <g id="PrimaryButton">
    <rect x="24" y="292" width="160" height="44" rx="22" fill="#7C5CFF"/>
    <path id="Label" d="M52 308 h12 v4 h-12 z M70 308 h20 v4 h-20 z" fill="#FFFFFF"/>
  </g>
  <g id="AvatarBadge">
    <circle cx="596" cy="28" r="16" fill="#2AC3B0"/>
  </g>
</svg>`;

/** Figma 寄り: data-name・入れ子の transform・radialGradient・パスで書かれた矩形・<text> */
export const HERO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300" fill="none">
  <defs>
    <radialGradient id="glow" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#FFD166"/>
      <stop offset="1" stop-color="#EF476F"/>
    </radialGradient>
  </defs>
  <rect width="400" height="300" fill="#101322"/>
  <g data-name="Hero Card" transform="translate(40 30)">
    <rect width="320" height="160" rx="16" fill="#1B2138"/>
    <g data-name="Icon Group" transform="translate(24 24) scale(2)">
      <path d="M0 0 C6 0 12 6 12 12 C12 18 6 24 0 24 C-6 24 -12 18 -12 12 C-12 6 -6 0 0 0 Z" fill="url(#glow)"/>
    </g>
    <path data-name="Divider" d="M24 120 L296 120 L296 122 L24 122 Z" fill="#2C3350"/>
  </g>
  <g data-name="Cta Button" transform="translate(40 220)">
    <rect width="140" height="48" rx="24" fill="#06D6A0"/>
    <text x="30" y="30" font-size="16" fill="#101322">Start</text>
  </g>
</svg>`;

/** ストロークだけの開いたパス・回転した矩形・不透明度付きの楕円。
 *  「矩形に見えるが矩形として扱ってはいけないもの」の見張り */
export const ICONS_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="120" viewBox="0 0 240 120">
  <rect width="240" height="120" fill="#FFFFFF"/>
  <g id="Icons">
    <path id="Check" d="M20 60 L40 80 L80 30" stroke="#06D6A0" stroke-width="8" fill="none" stroke-linecap="round"/>
    <rect id="Tilted" x="120" y="30" width="60" height="60" rx="8" fill="#EF476F" transform="rotate(20 150 60)"/>
    <ellipse id="Ghost" cx="210" cy="60" rx="20" ry="30" fill="#118AB2" opacity="0.5"/>
  </g>
</svg>`;

export const VECTOR_FIXTURES = [
  { name: "dashboard", svg: DASHBOARD_SVG, hasText: false },
  { name: "hero", svg: HERO_SVG, hasText: true },
  { name: "icons", svg: ICONS_SVG, hasText: false },
];

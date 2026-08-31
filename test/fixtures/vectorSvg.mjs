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

/** 16x16 PNG（左半分 #EF476F・右半分 #06D6A0）。自分で生成したものなので再配布の問題が無い */
export const TINY_PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAHklEQVR4nGN4" +
  "757/Hx9mu7YAL2YYNWDUgFEDhosBAFLcj58LMxCxAAAAAElFTkSuQmCC";

/** テキストの取り込み専用。text-anchor 3 種・<tspan> の複数行・letter-spacing・
 *  font-weight・埋め込み <image>・http(s) の <image>（取りに行かないことの見張り）。 */
export const TEXT_CARD_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="360" height="240" viewBox="0 0 360 240">
  <rect id="Background" width="360" height="240" fill="#FFFFFF"/>
  <g id="Card" font-family="Inter">
    <rect x="20" y="20" width="320" height="140" rx="12" fill="#F2F4F8"/>
    <text id="Title" x="40" y="60" font-size="24" font-weight="700" fill="#12203A">Monthly report</text>
    <text id="Body" x="40" y="92" font-size="14" fill="#48506B"><tspan x="40" y="92">Revenue is up</tspan><tspan x="40" y="112">across every region</tspan></text>
    <text id="Centered" x="180" y="140" font-size="14" text-anchor="middle" fill="#7C5CFF">centered</text>
    <text id="Trailing" x="320" y="140" font-size="14" text-anchor="end" letter-spacing="2" fill="#2AC3B0">right</text>
  </g>
  <g id="Thumbnail">
    <image x="20" y="180" width="48" height="48" href="${TINY_PNG_DATA_URI}"/>
  </g>
  <image id="Remote" x="300" y="180" width="40" height="40" href="https://example.invalid/logo.png"/>
</svg>`;

/** 同梱 Inter に無い文字（日本語）。**豆腐を焼き込まずにラスタへ降格する**ことの見張り。 */
export const CJK_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="120" viewBox="0 0 300 120">
  <rect width="300" height="120" fill="#101322"/>
  <text id="Heading" x="24" y="60" font-size="28" fill="#FFFFFF" font-family="Noto Sans JP">売上レポート</text>
  <text id="Sub" x="24" y="92" font-size="14" fill="#8892B0">Latin stays editable</text>
</svg>`;

/** 深い入れ子（4 段の <g> + それぞれの transform）とグラデーション多用。
 *  Figma のフレーム→グループ→コンポーネント→レイヤーの形を模してある。 */
export const NESTED_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320" viewBox="0 0 320 320">
  <defs>
    <linearGradient id="g1" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#7C5CFF"/><stop offset="1" stop-color="#EF476F"/>
    </linearGradient>
    <linearGradient id="g2" href="#g1" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="320"/>
    <radialGradient id="g3" cx="0.3" cy="0.3" r="0.7">
      <stop offset="0" stop-color="#FFD166" stop-opacity="0.9"/><stop offset="1" stop-color="#06D6A0"/>
    </radialGradient>
  </defs>
  <rect id="Page" width="320" height="320" fill="url(#g2)"/>
  <g id="Frame" transform="translate(20 20)">
    <g id="Group" transform="translate(10 10)">
      <g id="ChartCard" transform="scale(1.5)">
        <rect width="160" height="100" rx="8" fill="url(#g1)"/>
        <g id="Bars" transform="translate(12 12)">
          <rect x="0" y="40" width="16" height="40" fill="url(#g3)"/>
          <rect x="24" y="20" width="16" height="60" fill="url(#g3)"/>
          <rect x="48" y="4" width="16" height="76" fill="url(#g3)"/>
        </g>
      </g>
    </g>
  </g>
  <g id="Footer" transform="translate(20 260)">
    <rect width="280" height="40" rx="20" fill="#FFFFFF" fill-opacity="0.85"/>
  </g>
</svg>`;

// minEditable: そのフィクスチャで編集可能に**なるはず**の下限。cjk だけ低いのは
// 意図した降格（同梱 Inter に日本語のグリフが無い）で、そこを 0.8 にすると
// 「豆腐を埋め込めば通る」テストになってしまう。
export const VECTOR_FIXTURES = [
  { name: "dashboard", svg: DASHBOARD_SVG, hasText: false, minEditable: 0.8 },
  { name: "hero", svg: HERO_SVG, hasText: true, minEditable: 0.8 },
  { name: "icons", svg: ICONS_SVG, hasText: false, minEditable: 0.8 },
  { name: "text-card", svg: TEXT_CARD_SVG, hasText: true, minEditable: 0.8 },
  { name: "cjk", svg: CJK_SVG, hasText: true, minEditable: 0.66 },
  // pixelExact=false: objectBoundingBox の斜め/放射 gradient は Rive では原理的に
  // 一致しない（svgImport が警告を出す）。画素一致ではなく退行検知だけに使う
  { name: "nested", svg: NESTED_SVG, hasText: false, minEditable: 0.8, pixelExact: false },
];

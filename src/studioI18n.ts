// Studio UI の文言の束ね。言語を足すときは studioI18n/<言語コード>.ts を作り、下の I18N に 1 行足す。
import { dict as ja } from "./studioI18n/ja.js";
import { dict as en } from "./studioI18n/en.js";

// 言語コード → 辞書。辞書の無い言語は切替ボタンに出ない
export const I18N: Record<string, Record<string, string>> = { ja, en };

// 切替の並び順（辞書が無いものはブラウザ側で飛ばす）
export const LANG_ORDER: string[] = ["ja", "en", "zh-CN", "ko", "es", "fr", "de", "pt-BR"];

// 切替ボタンに出す各言語の名前（自国語表記）
export const LANG_NAMES: Record<string, string> = {
  ja: "日本語", en: "EN", "zh-CN": "简体中文", ko: "한국어", es: "Español", fr: "Français", de: "Deutsch", "pt-BR": "Português",
};

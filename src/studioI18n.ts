// Studio UI の文言の束ね。言語を足すときは studioI18n/<言語コード>.ts を作り、下の I18N に 1 行足す。
import { dict as ja } from "./studioI18n/ja.js";
import { dict as en } from "./studioI18n/en.js";
import { dict as zhCN } from "./studioI18n/zh-CN.js";
import { dict as ko } from "./studioI18n/ko.js";
import { dict as es } from "./studioI18n/es.js";
import { dict as fr } from "./studioI18n/fr.js";
import { dict as de } from "./studioI18n/de.js";
import { dict as ptBR } from "./studioI18n/pt-BR.js";

// 言語コード → 辞書。辞書の無い言語は切替ボタンに出ない
export const I18N: Record<string, Record<string, string>> = { ja, en, "zh-CN": zhCN, ko, es, fr, de, "pt-BR": ptBR };

// 切替の並び順（辞書が無いものはブラウザ側で飛ばす）
export const LANG_ORDER: string[] = ["ja", "en", "zh-CN", "ko", "es", "fr", "de", "pt-BR"];

// 切替ボタンに出す各言語の名前（自国語表記）
export const LANG_NAMES: Record<string, string> = {
  ja: "日本語", en: "English", "zh-CN": "简体中文", ko: "한국어", es: "Español", fr: "Français", de: "Deutsch", "pt-BR": "Português",
};

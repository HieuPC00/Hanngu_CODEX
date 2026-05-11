import { normalizeChineseText } from "@/lib/text-quality";
import type { ItemType } from "@/lib/types";

export function inferItemType(hanzi: string, fallback: ItemType = "sentence", pinyin?: string | null): ItemType {
  const lines = hanzi
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (fallback === "dialogue" || lines.length > 1 || /(^|\n)\s*[A-Za-z]\s*[:：]/.test(hanzi)) {
    return "dialogue";
  }

  if (fallback === "word") return "word";

  const compact = normalizeChineseText(hanzi);
  const chineseCharCount = (compact.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
  const hasSentenceMarker = /[？?！!，,；;：:]/.test(hanzi);
  const pinyinSyllables = String(pinyin || "")
    .replace(/[.,!?;:，。！？；：]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (chineseCharCount > 0 && chineseCharCount <= 4 && !hasSentenceMarker && pinyinSyllables.length <= 1) {
    return "word";
  }

  return "sentence";
}

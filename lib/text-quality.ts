export function hasChineseText(text: string | null | undefined) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(text || "");
}

export function hasChineseInPinyin(text: string | null | undefined) {
  return hasChineseText(text);
}

export function normalizeChineseText(text: string | null | undefined) {
  return String(text || "")
    .replace(/\s+/g, "")
    .replace(/[，。！？、；：「」『』（）《》,.!?;:'"()[\]{}<>]/g, "")
    .trim();
}

export function cleanMeaning(text: string | null | undefined) {
  return String(text || "")
    .replace(/[\u3400-\u9fff\uf900-\ufaff]+/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

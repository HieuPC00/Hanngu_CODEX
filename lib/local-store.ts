import type { ExtractedItem, StudyItem } from "@/lib/types";

const itemsKey = "hanngu-local-items";
const logsKey = "hanngu-local-study-logs";

type LocalLog = {
  id: string;
  item_id: string;
  result: "thuoc" | "chua_thuoc";
  studied_at: string;
};

export function getLocalItems(): StudyItem[] {
  try {
    const raw = localStorage.getItem(itemsKey);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.map(normalizeItem).filter(isStudyItem) : [];
  } catch {
    return [];
  }
}

export function addLocalItems(items: ExtractedItem[]): StudyItem[] {
  const now = new Date().toISOString();
  const current = getLocalItems();
  const nextItems = items
    .filter((item) => item.hanzi.trim())
    .map((item): StudyItem => ({
      id: `local-${crypto.randomUUID()}`,
      user_id: "local",
      document_id: null,
      type: item.type,
      hanzi: item.hanzi.trim(),
      pinyin: item.pinyin?.trim() || null,
      meaning: item.meaning?.trim() || null,
      mastery: 1,
      shown_count: 0,
      last_shown_at: null,
      last_studied_at: null,
      created_at: now
    }));

  saveLocalItems([...nextItems, ...current]);
  return nextItems;
}

export function pickLocalItem(): StudyItem | null {
  const items = getLocalItems();
  if (!items.length) return null;

  const sorted = [...items].sort((a, b) => {
    if (a.shown_count !== b.shown_count) return a.shown_count - b.shown_count;
    const aTime = a.last_shown_at ? Date.parse(a.last_shown_at) : 0;
    const bTime = b.last_shown_at ? Date.parse(b.last_shown_at) : 0;
    if (aTime !== bTime) return aTime - bTime;
    return Math.random() - 0.5;
  });

  const picked = sorted[0];
  const now = new Date().toISOString();
  const updated = { ...picked, shown_count: picked.shown_count + 1, last_shown_at: now };

  saveLocalItems(items.map((item) => (item.id === picked.id ? updated : item)));
  return updated;
}

export function rateLocalItem(itemId: string, result: "thuoc" | "chua_thuoc") {
  const items = getLocalItems();
  const now = new Date().toISOString();
  const delta = result === "thuoc" ? 1 : -1;

  saveLocalItems(
    items.map((item) =>
      item.id === itemId
        ? {
            ...item,
            mastery: Math.min(5, Math.max(1, item.mastery + delta)),
            last_studied_at: now
          }
        : item
    )
  );

  addLocalLog({ id: `log-${crypto.randomUUID()}`, item_id: itemId, result, studied_at: now });
}

function saveLocalItems(items: StudyItem[]) {
  localStorage.setItem(itemsKey, JSON.stringify(items));
}

function addLocalLog(log: LocalLog) {
  try {
    const raw = localStorage.getItem(logsKey);
    const current = raw ? JSON.parse(raw) : [];
    localStorage.setItem(logsKey, JSON.stringify(Array.isArray(current) ? [log, ...current] : [log]));
  } catch {
    localStorage.setItem(logsKey, JSON.stringify([log]));
  }
}

function normalizeItem(item: Partial<StudyItem> | null): StudyItem | null {
  if (!item?.id || !item.hanzi) return null;

  return {
    id: String(item.id),
    user_id: String(item.user_id || "local"),
    document_id: item.document_id ? String(item.document_id) : null,
    type: item.type === "word" || item.type === "dialogue" ? item.type : "sentence",
    hanzi: String(item.hanzi),
    pinyin: item.pinyin ? String(item.pinyin) : null,
    meaning: item.meaning ? String(item.meaning) : null,
    mastery: clampNumber(item.mastery, 1, 5, 1),
    shown_count: clampNumber(item.shown_count, 0, Number.MAX_SAFE_INTEGER, 0),
    last_shown_at: item.last_shown_at ? String(item.last_shown_at) : null,
    last_studied_at: item.last_studied_at ? String(item.last_studied_at) : null,
    created_at: item.created_at ? String(item.created_at) : new Date().toISOString()
  };
}

function isStudyItem(item: StudyItem | null): item is StudyItem {
  return item !== null;
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) return fallback;
  return Math.min(max, Math.max(min, numberValue));
}

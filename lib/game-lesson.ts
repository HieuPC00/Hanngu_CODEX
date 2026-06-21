import type { StudyItem } from "@/lib/types";

export const GAME_LESSON_STORAGE_KEY = "hanngu-game-lesson-items";

export function serializeGameLessonItems(items: StudyItem[]) {
  return JSON.stringify(
    items.map((item) => ({
      id: item.id,
      user_id: item.user_id,
      document_id: item.document_id,
      lesson_no: item.lesson_no,
      type: item.type,
      difficulty: item.difficulty,
      hanzi: item.hanzi,
      pinyin: item.pinyin,
      meaning: item.meaning,
      mastery: item.mastery,
      shown_count: item.shown_count,
      last_shown_at: item.last_shown_at,
      last_studied_at: item.last_studied_at,
      created_at: item.created_at
    }))
  );
}

export function parseGameLessonItems(value: string | null): StudyItem[] {
  if (!value) return [];

  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed.filter((item) => item?.id && item?.hanzi) as StudyItem[]) : [];
  } catch {
    return [];
  }
}

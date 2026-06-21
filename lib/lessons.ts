import type { ItemType } from "@/lib/types";

export const itemsPerLessonBucket = 10;

export type LessonRow = {
  lesson_no?: number | null;
  type: ItemType;
};

export function lessonNumbersFromRows(rows: LessonRow[]) {
  return Array.from(
    new Set(rows.map((row) => normalizeLessonNumber(row.lesson_no)).filter((value): value is number => value !== null))
  ).sort((left, right) => left - right);
}

export function nextLessonNumber(rows: LessonRow[]) {
  const lessonNumbers = lessonNumbersFromRows(rows);
  return (lessonNumbers.at(-1) || 0) + 1;
}

export function assignAutomaticLessons<T extends LessonRow>(items: T[], existingRows: LessonRow[]) {
  const counts = new Map<number, { word: number; content: number }>();
  let highestLesson = 0;

  for (const row of existingRows) {
    const lessonNo = normalizeLessonNumber(row.lesson_no);
    if (!lessonNo) continue;
    highestLesson = Math.max(highestLesson, lessonNo);
    incrementBucket(counts, lessonNo, row.type);
  }

  return items.map((item) => {
    const explicitLesson = normalizeLessonNumber(item.lesson_no);
    if (explicitLesson) {
      highestLesson = Math.max(highestLesson, explicitLesson);
      incrementBucket(counts, explicitLesson, item.type);
      return { ...item, lesson_no: explicitLesson };
    }

    const bucket = item.type === "word" ? "word" : "content";
    let lessonNo = Array.from({ length: Math.max(highestLesson, 1) }, (_, index) => index + 1).find(
      (candidate) => (counts.get(candidate)?.[bucket] || 0) < itemsPerLessonBucket
    );

    if (!lessonNo) {
      highestLesson += 1;
      lessonNo = highestLesson;
    }

    incrementBucket(counts, lessonNo, item.type);
    return { ...item, lesson_no: lessonNo };
  });
}

export function normalizeLessonNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

function incrementBucket(counts: Map<number, { word: number; content: number }>, lessonNo: number, type: ItemType) {
  const current = counts.get(lessonNo) || { word: 0, content: 0 };
  if (type === "word") current.word += 1;
  else current.content += 1;
  counts.set(lessonNo, current);
}

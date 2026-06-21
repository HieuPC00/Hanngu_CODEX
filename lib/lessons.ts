import type { ItemType } from "@/lib/types";

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

export function normalizeLessonNumber(value: unknown) {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numberValue) && numberValue > 0 ? numberValue : null;
}

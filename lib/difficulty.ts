import type { ItemDifficulty, ItemType } from "@/lib/types";

export const difficultyOptions: Array<{ value: ItemDifficulty; label: string }> = [
  { value: "easy", label: "Dễ" },
  { value: "hard", label: "Khó" }
];

export function normalizeDifficulty(value: unknown, fallback: ItemDifficulty = "easy"): ItemDifficulty {
  return value === "hard" || value === "easy" ? value : fallback;
}

export function labelDifficulty(difficulty: ItemDifficulty) {
  return difficulty === "hard" ? "Khó" : "Dễ";
}

export function inferDifficulty(hanzi: string, type: ItemType): ItemDifficulty {
  const chineseCount = Array.from(hanzi).filter(isChineseChar).length;
  const lineCount = hanzi.split("\n").filter((line) => line.trim()).length;

  if (type === "dialogue" || lineCount > 1 || chineseCount > 18) return "hard";
  return "easy";
}

function isChineseChar(char: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(char);
}

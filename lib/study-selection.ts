import { normalizeChineseText } from "@/lib/text-quality";
import type { ItemType, StudyItem } from "@/lib/types";

const itemTypes: ItemType[] = ["word", "sentence", "dialogue"];

export function uniqueStudyItems(items: StudyItem[]) {
  const bestByHanzi = new Map<string, StudyItem>();

  for (const item of items) {
    const key = normalizeChineseText(item.hanzi);
    if (!key) continue;

    const current = bestByHanzi.get(key);
    if (!current || compareStudyPriority(item, current) < 0) {
      bestByHanzi.set(key, item);
    }
  }

  return [...bestByHanzi.values()];
}

export function selectStudyItems(items: StudyItem[], size: number, options?: { balanceTypes?: boolean }) {
  const candidates = uniqueStudyItems(items);
  const targetSize = Math.min(size, candidates.length);
  if (!targetSize) return [];

  if (!options?.balanceTypes) {
    return selectByPriority(candidates, targetSize);
  }

  const grouped = new Map<ItemType, StudyItem[]>(
    itemTypes.map((type) => [type, candidates.filter((item) => item.type === type)])
  );
  const quotas = proportionalQuotas(grouped, targetSize);

  return shuffleItems(
    itemTypes.flatMap((type) => selectByPriority(grouped.get(type) || [], quotas.get(type) || 0))
  );
}

export function compareStudyPriority(left: StudyItem, right: StudyItem) {
  return left.shown_count - right.shown_count || compareLastShownAt(left, right);
}

function selectByPriority(items: StudyItem[], size: number) {
  const remaining = [...items].sort(compareStudyPriority);
  const selected: StudyItem[] = [];

  while (remaining.length && selected.length < size) {
    const bestShownCount = remaining[0].shown_count;
    const bestLastShownAt = timeValue(remaining[0].last_shown_at);
    const tied = remaining.filter(
      (candidate) => candidate.shown_count === bestShownCount && timeValue(candidate.last_shown_at) === bestLastShownAt
    );
    const needed = size - selected.length;
    const picked = shuffleItems(tied).slice(0, needed);
    const pickedIds = new Set(picked.map((candidate) => candidate.id));

    selected.push(...picked);
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (pickedIds.has(remaining[index].id)) remaining.splice(index, 1);
    }
  }

  return selected;
}

function proportionalQuotas(grouped: Map<ItemType, StudyItem[]>, size: number) {
  const total = itemTypes.reduce((sum, type) => sum + (grouped.get(type)?.length || 0), 0);
  const quotas = new Map<ItemType, number>();
  const remainders: Array<{ type: ItemType; remainder: number }> = [];
  let assigned = 0;

  for (const type of itemTypes) {
    const count = grouped.get(type)?.length || 0;
    const exact = total ? (count / total) * size : 0;
    const base = Math.min(count, Math.floor(exact));
    quotas.set(type, base);
    remainders.push({ type, remainder: exact - base });
    assigned += base;
  }

  remainders.sort((left, right) => right.remainder - left.remainder);
  while (assigned < size) {
    let added = false;

    for (const { type } of remainders) {
      const capacity = grouped.get(type)?.length || 0;
      const quota = quotas.get(type) || 0;
      if (quota >= capacity) continue;

      quotas.set(type, quota + 1);
      assigned += 1;
      added = true;
      if (assigned === size) break;
    }

    if (!added) break;
  }

  return quotas;
}

function compareLastShownAt(left: StudyItem, right: StudyItem) {
  return timeValue(left.last_shown_at) - timeValue(right.last_shown_at);
}

function timeValue(value: string | null) {
  return value ? new Date(value).getTime() : 0;
}

function shuffleItems<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

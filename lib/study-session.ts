import { createClient } from "@/lib/supabase-browser";
import type { StudyItem } from "@/lib/types";

export async function startStudySession(selectedItems: StudyItem[], ownerId: string) {
  if (!selectedItems.length) return [];

  const selectedIds = selectedItems.map((item) => item.id);
  const supabase = createClient();
  const { data, error } = await supabase.rpc("start_study_session", {
    p_user_id: ownerId,
    p_item_ids: selectedIds
  });

  if (error) throw error;

  const updatedItems = (Array.isArray(data) ? data : []) as StudyItem[];
  const itemsById = new Map(updatedItems.map((item) => [item.id, item]));
  const orderedItems = selectedIds.flatMap((id) => {
    const item = itemsById.get(id);
    return item ? [item] : [];
  });

  if (orderedItems.length !== selectedIds.length) {
    throw new Error("Supabase không cập nhật đủ dữ liệu của bài học.");
  }

  return orderedItems;
}

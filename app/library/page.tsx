import AppFrame from "@/components/AppFrame";
import { createClient } from "@/lib/supabase-server";
import type { StudyItem } from "@/lib/types";
import "./library.css";

export default async function LibraryPage() {
  const supabase = await createClient();
  const { data } = await supabase
    .from("items")
    .select("id,user_id,document_id,type,hanzi,pinyin,meaning,mastery,shown_count,last_shown_at,last_studied_at,created_at")
    .order("created_at", { ascending: false })
    .range(0, 199);

  const items = (data || []) as StudyItem[];

  return (
    <AppFrame>
      <section>
        <h1 className="page-title">Thư viện</h1>
        <p className="page-subtitle">Danh sách tối đa 200 mục mới nhất. Search/filter/sửa/xóa sẽ ở Phase 2.</p>
        <div className="library-stack">
          {items.length ? (
            items.map((item) => (
              <article className="card library-card" key={item.id}>
                <div className="library-meta">
                  {labelType(item.type)} · Mức {item.mastery}/5 · Đã hiện {item.shown_count}×
                </div>
                <div className="library-hanzi">{item.hanzi}</div>
                <div className="library-pinyin">{item.pinyin}</div>
                <div className="library-meaning">{item.meaning}</div>
              </article>
            ))
          ) : (
            <div className="empty-state">
              <div>
                <div className="empty-icon">📚</div>
                <h2>Thư viện trống</h2>
                <p className="muted">Upload ảnh để tạo mục học đầu tiên.</p>
              </div>
            </div>
          )}
        </div>
      </section>
    </AppFrame>
  );
}

function labelType(type: StudyItem["type"]) {
  if (type === "dialogue") return "Hội thoại";
  if (type === "word") return "Từ vựng";
  return "Câu";
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { getLocalItems, pickLocalItem, rateLocalItem } from "@/lib/local-store";
import type { StudyItem } from "@/lib/types";
import "./study.css";

type VisibleParts = {
  hanzi: boolean;
  pinyin: boolean;
  meaning: boolean;
};

const defaultVisible: VisibleParts = { hanzi: true, pinyin: false, meaning: false };

export default function StudyHome() {
  const [count, setCount] = useState<number | null>(null);
  const [item, setItem] = useState<StudyItem | null>(null);
  const [visible, setVisible] = useState<VisibleParts>(defaultVisible);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("hanngu-visible-parts");
    if (saved) setVisible(JSON.parse(saved));
    refreshCount();
  }, []);

  async function refreshCount() {
    const supabase = createClient();
    const { count: itemCount, error } = await supabase.from("items").select("id", { count: "exact", head: true });

    if (error) {
      setCount(getLocalItems().length);
      return;
    }

    setCount((itemCount || 0) + getLocalItems().length);
  }

  function setPart(part: keyof VisibleParts) {
    const next = { ...visible, [part]: !visible[part] };
    setVisible(next);
    localStorage.setItem("hanngu-visible-parts", JSON.stringify(next));
  }

  async function pickNext() {
    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("pick_next_item", {
      p_document_id: null,
      p_max_mastery: 5
    });
    setLoading(false);
    if (error) {
      setItem(pickLocalItem());
      return;
    }
    const next = Array.isArray(data) ? data[0] : data;
    setItem(next || pickLocalItem());
  }

  async function rate(result: "thuoc" | "chua_thuoc") {
    if (!item) return;
    const supabase = createClient();
    const delta = result === "thuoc" ? 1 : -1;
    const nextMastery = Math.min(5, Math.max(1, item.mastery + delta));

    if (item.id.startsWith("local-")) {
      rateLocalItem(item.id, result);
    } else {
      const { error } = await supabase.from("items").update({ mastery: nextMastery, last_studied_at: new Date().toISOString() }).eq("id", item.id);
      if (error) {
        rateLocalItem(item.id, result);
      } else {
        await supabase.from("study_logs").insert({ item_id: item.id, result });
      }
    }

    await pickNext();
    await refreshCount();
  }

  function speak() {
    if (!item || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(item.hanzi);
    utterance.lang = "zh-CN";
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  }

  if (count === 0) {
    return (
      <section className="empty-state">
        <div>
          <div className="empty-icon">📚</div>
          <h1>Chưa có gì để học</h1>
          <p className="muted">Upload ảnh để AI trích xuất câu, hội thoại và từ vựng.</p>
          <Link className="button full-width" href="/upload">
            Upload ảnh
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="study-stack">
      {!item ? (
        <div className="ready-card card">
          <div className="learn-mark">学</div>
          <h1>Sẵn sàng học?</h1>
          <button className="button full-width" type="button" onClick={pickNext} disabled={loading}>
            {loading ? "Đang tạo..." : "Tạo"}
          </button>
        </div>
      ) : (
        <>
          <article className="flashcard card">
            <header className="flashcard-head">
              <span>
                {labelType(item.type)} · Đã hiện {item.shown_count}× · Mức {item.mastery}/5
              </span>
              <button className="speaker" type="button" onClick={speak} aria-label="Phát âm">
                🔊
              </button>
            </header>
            <FlashPart className="hanzi-part" hidden={!visible.hanzi}>
              {item.hanzi}
            </FlashPart>
            <FlashPart className="pinyin-part" hidden={!visible.pinyin}>
              {item.pinyin}
            </FlashPart>
            <FlashPart className="meaning-part" hidden={!visible.meaning}>
              {item.meaning}
            </FlashPart>
          </article>

          <div className="toggle-grid">
            <button className={visible.hanzi ? "toggle active" : "toggle"} type="button" onClick={() => setPart("hanzi")}>
              {visible.hanzi ? "Ẩn Hán" : "Hiện Hán"}
            </button>
            <button className={visible.pinyin ? "toggle active" : "toggle"} type="button" onClick={() => setPart("pinyin")}>
              {visible.pinyin ? "Ẩn Pinyin" : "Hiện Pinyin"}
            </button>
            <button className={visible.meaning ? "toggle active" : "toggle"} type="button" onClick={() => setPart("meaning")}>
              {visible.meaning ? "Ẩn Nghĩa" : "Hiện Nghĩa"}
            </button>
          </div>

          <div className="rating-grid">
            <button className="ghost-button" type="button" onClick={() => rate("chua_thuoc")}>
              Chưa thuộc
            </button>
            <button className="success-button" type="button" onClick={() => rate("thuoc")}>
              Đã thuộc
            </button>
          </div>

          <button className="ghost-button full-width" type="button" onClick={pickNext}>
            Tạo câu khác
          </button>
        </>
      )}

      <details className="settings-collapse">
        <summary>Cài đặt mặc định ẩn/hiện</summary>
        <label>
          <input type="checkbox" checked={visible.hanzi} onChange={() => setPart("hanzi")} /> Hán
        </label>
        <label>
          <input type="checkbox" checked={visible.pinyin} onChange={() => setPart("pinyin")} /> Pinyin
        </label>
        <label>
          <input type="checkbox" checked={visible.meaning} onChange={() => setPart("meaning")} /> Nghĩa
        </label>
      </details>
    </section>
  );
}

function FlashPart({ children, hidden, className }: { children: React.ReactNode; hidden: boolean; className: string }) {
  return <div className={`${className} flash-part ${hidden ? "blurred" : ""}`}>{children}</div>;
}

function labelType(type: StudyItem["type"]) {
  if (type === "dialogue") return "Hội thoại";
  if (type === "word") return "Từ vựng";
  return "Câu";
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { getLocalItems, pickLocalItem } from "@/lib/local-store";
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
    if (window.location.hash.includes("error=")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    const saved = localStorage.getItem("hanngu-visible-parts");
    if (saved) setVisible(JSON.parse(saved));
    refreshCount();
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.getVoices();
    window.speechSynthesis.onvoiceschanged = () => window.speechSynthesis.getVoices();

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
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

  function speak() {
    if (!item) return;
    if (!("speechSynthesis" in window)) {
      alert("Trình duyệt này không hỗ trợ đọc phát âm.");
      return;
    }

    const text = item.hanzi.trim();
    if (!text) return;

    const synth = window.speechSynthesis;
    const utterance = new SpeechSynthesisUtterance(item.hanzi);
    const voice = findChineseVoice(synth.getVoices());

    if (voice) {
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "zh-CN";
    }

    utterance.rate = 0.85;
    utterance.pitch = 1;
    utterance.onerror = (event) => {
      if (event.error !== "interrupted" && event.error !== "canceled") {
        alert("Điện thoại không tìm thấy giọng đọc tiếng Trung. Hãy thử mở bằng Safari/Chrome mới hoặc bật giọng tiếng Trung trong cài đặt máy.");
      }
    };

    synth.cancel();
    synth.resume();
    synth.speak(utterance);
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
                {labelType(item.type)} · Đã hiện {item.shown_count}×
              </span>
              <button className="speaker" type="button" onClick={speak} aria-label="Phát âm">
                🔊
              </button>
            </header>
            <FlashPart className={`hanzi-part ${hanziSizeClass(item.hanzi)}`} hidden={!visible.hanzi}>
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

          <button className="ghost-button full-width" type="button" onClick={pickNext}>
            Tạo câu khác
          </button>
        </>
      )}
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

function hanziSizeClass(text: string) {
  const compactLength = text.replace(/\s/g, "").length;
  const lineCount = text.split("\n").length;

  if (lineCount > 1 || compactLength > 18) return "hanzi-compact";
  if (compactLength > 8) return "hanzi-medium";
  return "hanzi-short";
}

function findChineseVoice(voices: SpeechSynthesisVoice[]) {
  return (
    voices.find((voice) => /^zh[-_]?CN/i.test(voice.lang)) ||
    voices.find((voice) => /^zh/i.test(voice.lang)) ||
    voices.find((voice) => /chinese|mandarin|普通话|國語|中文/i.test(voice.name))
  );
}

"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { difficultyOptions, labelDifficulty } from "@/lib/difficulty";
import { getBrowserOwnerId } from "@/lib/shared-access";
import type { ItemDifficulty, StudyItem } from "@/lib/types";
import "./study.css";

type VisibleParts = {
  hanzi: boolean;
  pinyin: boolean;
  meaning: boolean;
};

type CheckState = "idle" | "correct" | "wrong";
type DifficultyFilter = "all" | ItemDifficulty;

const defaultVisible: VisibleParts = { hanzi: false, pinyin: false, meaning: true };
const itemColumns = "id,user_id,document_id,type,difficulty,hanzi,pinyin,meaning,mastery,shown_count,last_shown_at,last_studied_at,created_at";
const correctMessages = [
  "Đúng rồi, tiếp tục tiến độ này nhé.",
  "Chuẩn luôn, nhớ bài tốt nha.",
  "Tốt lắm, qua câu tiếp theo thôi.",
  'Hay, "ngấm" vào đầu rồi nha.',
  "Đúng rồi, phản xạ bắt đầu nhanh hơn rồi á.",
  "Chuẩn, câu này coi như nằm lòng rồi hen.",
  "Chính xác! Thêm câu nữa cho nóng.",
  "Đều tay thế này thì kiểu gì cũng giỏi.",
  "Ngon lành, cứ đi hướng này là chuẩn bài.",
  "Ngon lành, củng cố thêm câu nữa đi."
];
const wrongMessages = [
  "Chưa chuẩn rồi, nhìn kỹ lại mặt chữ một chút nhé.",
  "Sai chút thôi, sửa lại phát là nhớ ngay.",
  "Hình như chưa khớp lắm, bình tĩnh coi lại xem sao.",
  'Đang đoạn "nạp" kiến thức nên nhầm tí không sao, thử lại nào.',
  "Lỗi này mới giúp mình nhớ lâu, làm lại nhé.",
  "Suýt soát rồi! Kiểm tra lại thứ tự chữ một tẹo thôi.",
  "Chưa chuẩn lắm, đọc kỹ rồi gõ chậm lại chút xem.",
  "Sai là chuyện bình thường, sửa xong là tiến bộ thôi.",
  'Câu này hơi "khoai", thử lại lượt nữa cho chắc tay nào.',
  "Chưa đúng roài, tập trung và làm lại nha."
];
const preferredVoiceKey = "hanngu-preferred-chinese-voice";

export default function StudyHome() {
  const [count, setCount] = useState<number | null>(null);
  const [item, setItem] = useState<StudyItem | null>(null);
  const [visible, setVisible] = useState<VisibleParts>(defaultVisible);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [feedbackText, setFeedbackText] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("all");

  useEffect(() => {
    if (window.location.hash.includes("error=")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    localStorage.removeItem("hanngu-visible-parts");
    refreshCount();
  }, []);

  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const synth = window.speechSynthesis;
    const primeVoices = () => cacheBestChineseVoice(synth.getVoices());

    primeVoices();
    synth.addEventListener("voiceschanged", primeVoices);
    synth.getVoices();

    return () => {
      synth.removeEventListener("voiceschanged", primeVoices);
    };
  }, []);

  async function refreshCount() {
    const supabase = createClient();
    const ownerId = getBrowserOwnerId();
    const { count: itemCount, error } = await supabase
      .from("items")
      .select("id", { count: "exact", head: true })
      .eq("user_id", ownerId);

    if (error) {
      setCount(0);
      return;
    }

    setCount(itemCount || 0);
  }

  function setPart(part: keyof VisibleParts) {
    const next = { ...visible, [part]: !visible[part] };
    setVisible(next);
  }

  function changeDifficultyFilter(nextFilter: DifficultyFilter) {
    setDifficultyFilter(nextFilter);
    setItem(null);
    resetPractice();
  }

  async function pickNext(options?: { countCreateClick?: boolean }) {
    setLoading(true);
    const supabase = createClient();
    const ownerId = getBrowserOwnerId();

    if (options?.countCreateClick) {
      await incrementCreateCount(ownerId);
    }

    let query = supabase
      .from("items")
      .select(itemColumns)
      .eq("user_id", ownerId)
      .lte("mastery", 5)
      .order("shown_count", { ascending: true })
      .order("last_shown_at", { ascending: true, nullsFirst: true })
      .limit(1);

    if (difficultyFilter !== "all") {
      query = query.eq("difficulty", difficultyFilter);
    }

    const { data, error } = await query;

    setLoading(false);
    if (error) {
      alert("Không lấy được dữ liệu học từ Supabase. Hãy thử tải lại trang.");
      return;
    }

    const next = Array.isArray(data) ? (data[0] as StudyItem | undefined) : undefined;
    if (!next) {
      setItem(null);
      resetPractice();
      alert(difficultyFilter === "all" ? "Chưa có mục học phù hợp." : `Chưa có mục ${labelDifficulty(difficultyFilter)} để học.`);
      return;
    }

    const now = new Date().toISOString();
    const fallbackItem: StudyItem = {
      ...next,
      shown_count: next.shown_count + 1,
      last_shown_at: now
    };
    const { data: updated, error: updateError } = await supabase
      .from("items")
      .update({
        shown_count: next.shown_count + 1,
        last_shown_at: now
      })
      .eq("id", next.id)
      .eq("user_id", ownerId)
      .select(itemColumns)
      .single();

    if (updateError) {
      setItem(fallbackItem);
      resetPractice();
      return;
    }

    setItem((updated as StudyItem) || fallbackItem);
    resetPractice();
    refreshCount();
  }

  async function incrementCreateCount(ownerId: string) {
    const supabase = createClient();
    await supabase.rpc("increment_create_count", { p_user_id: ownerId });
  }

  function resetPractice() {
    setVisible(defaultVisible);
    setAnswer("");
    setCheckState("idle");
    setFeedbackText("");
  }

  function updateAnswer(nextAnswer: string) {
    setAnswer(nextAnswer);
    if (checkState !== "idle") {
      setCheckState("idle");
      setFeedbackText("");
    }
  }

  function checkAnswer() {
    if (!item) return;

    const result = compareChineseAnswer(item.hanzi, answer);

    if (result.correct) {
      setVisible((current) => ({ ...current, hanzi: true, pinyin: true }));
      setCheckState("correct");
      setFeedbackText(pickRandomMessage(correctMessages));
      return;
    }

    setVisible((current) => ({ ...current, hanzi: true, pinyin: true }));
    setCheckState("wrong");
    setFeedbackText(pickRandomMessage(wrongMessages));
  }

  async function speak() {
    if (!item) return;
    if (!("speechSynthesis" in window)) {
      alert("Trình duyệt này không hỗ trợ đọc phát âm.");
      return;
    }

    const text = item.hanzi.trim();
    if (!text) return;

    const synth = window.speechSynthesis;
    const speechText = prepareSpeechText(text);
    const utterance = new SpeechSynthesisUtterance(speechText);
    const voices = await getAvailableVoices(synth);
    const voice = findBestChineseVoice(voices);

    if (voice) {
      cachePreferredVoice(voice);
      utterance.voice = voice;
      utterance.lang = voice.lang;
    } else {
      utterance.lang = "zh-CN";
    }

    utterance.rate = speechRateForText(speechText, item.type);
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

  const comparison = item ? compareChineseAnswer(item.hanzi, answer) : null;
  const shouldHighlight = checkState === "wrong" && comparison;

  return (
    <section className="study-stack">
      <DifficultyFilterControl value={difficultyFilter} onChange={changeDifficultyFilter} />

      {!item ? (
        <div className="ready-card card">
          <div className="learn-mark">学</div>
          <h1>Sẵn sàng học?</h1>
          <button className="button full-width" type="button" onClick={() => pickNext({ countCreateClick: true })} disabled={loading}>
            {loading ? "Đang tạo..." : "Tạo"}
          </button>
        </div>
      ) : (
        <>
          <article className="flashcard card">
            <header className="flashcard-head">
              <span>
                {labelType(item.type)} · Đã hiện {item.shown_count}×
                {" · "}
                {labelDifficulty(item.difficulty)}
              </span>
              <button className="speaker" type="button" onClick={speak} aria-label="Phát âm">
                🔊
              </button>
            </header>
            <FlashPart className={`hanzi-part ${hanziSizeClass(item.hanzi)}`} hidden={!visible.hanzi}>
              {shouldHighlight ? renderHighlightedText(item.hanzi, comparison.sampleWrongIndices) : item.hanzi}
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

          <section className="practice-card card">
            <label className="practice-label" htmlFor="hanzi-answer">
              Nhập Hán tự
            </label>
            <textarea
              id="hanzi-answer"
              className={`textarea answer-input ${checkState === "correct" ? "correct" : ""} ${checkState === "wrong" ? "wrong" : ""}`}
              value={answer}
              onChange={(event) => updateAnswer(event.target.value)}
              placeholder="Gõ Hán tự theo nghĩa tiếng Việt..."
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
            />

            {checkState !== "idle" ? (
              <div className={`check-result ${checkState}`} aria-live="polite">
                {feedbackText}
              </div>
            ) : null}

            {checkState === "wrong" && answer.trim() ? (
              <div className="answer-review" aria-label="Phần nhập đã kiểm tra">
                {comparison ? renderHighlightedText(answer, comparison.inputWrongIndices) : answer}
              </div>
            ) : null}

            <button className="button full-width" type="button" onClick={checkAnswer}>
              Kiểm tra
            </button>
          </section>

          <button className="ghost-button full-width" type="button" onClick={() => pickNext({ countCreateClick: true })}>
            Tạo câu khác
          </button>
        </>
      )}
    </section>
  );
}

function DifficultyFilterControl({ value, onChange }: { value: DifficultyFilter; onChange: (value: DifficultyFilter) => void }) {
  return (
    <div className="difficulty-filter" aria-label="Bộ lọc độ khó">
      <button className={value === "all" ? "difficulty-filter-button active" : "difficulty-filter-button"} type="button" onClick={() => onChange("all")}>
        Tất cả
      </button>
      {difficultyOptions.map((option) => (
        <button
          className={value === option.value ? "difficulty-filter-button active" : "difficulty-filter-button"}
          type="button"
          key={option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
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

function pickRandomMessage(messages: string[]) {
  return messages[Math.floor(Math.random() * messages.length)] || "";
}

function hanziSizeClass(text: string) {
  const compactLength = text.replace(/\s/g, "").length;
  const lineCount = text.split("\n").length;

  if (lineCount > 1 || compactLength > 18) return "hanzi-compact";
  if (compactLength > 8) return "hanzi-medium";
  return "hanzi-short";
}

function prepareSpeechText(text: string) {
  return text
    .split("\n")
    .map((line) => line.replace(/^[A-Z]:\s*/i, "").trim())
    .filter(Boolean)
    .join("\n");
}

function speechRateForText(text: string, type: StudyItem["type"]) {
  const chineseLength = collectChineseUnits(text).length;
  if (type === "word" || chineseLength <= 4) return 0.76;
  if (type === "dialogue" || chineseLength > 40) return 0.9;
  if (chineseLength > 16) return 0.86;
  return 0.82;
}

function getAvailableVoices(synth: SpeechSynthesis): Promise<SpeechSynthesisVoice[]> {
  const voices = synth.getVoices();
  if (voices.length > 0) return Promise.resolve(voices);

  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(synth.getVoices());
    }, 800);

    function handleVoicesChanged() {
      window.clearTimeout(timeout);
      synth.removeEventListener("voiceschanged", handleVoicesChanged);
      resolve(synth.getVoices());
    }

    synth.addEventListener("voiceschanged", handleVoicesChanged);
    synth.getVoices();
  });
}

function cacheBestChineseVoice(voices: SpeechSynthesisVoice[]) {
  const voice = findBestChineseVoice(voices);
  if (voice) cachePreferredVoice(voice);
}

function cachePreferredVoice(voice: SpeechSynthesisVoice) {
  try {
    localStorage.setItem(preferredVoiceKey, voice.voiceURI || voice.name);
  } catch {
    // localStorage can be unavailable in strict private browsing modes.
  }
}

function readPreferredVoiceId() {
  try {
    return localStorage.getItem(preferredVoiceKey);
  } catch {
    return null;
  }
}

function findBestChineseVoice(voices: SpeechSynthesisVoice[]) {
  const candidates = voices
    .map((voice) => ({ voice, score: scoreChineseVoice(voice, readPreferredVoiceId()) }))
    .filter((candidate) => candidate.score > 0)
    .sort((left, right) => right.score - left.score);

  return candidates[0]?.voice;
}

function scoreChineseVoice(voice: SpeechSynthesisVoice, preferredId: string | null) {
  const lang = voice.lang.toLowerCase();
  const name = voice.name.toLowerCase();
  const id = voice.voiceURI || voice.name;
  let score = 0;

  if (/^zh[-_]?cn/.test(lang) || /hans|china|mainland|普通话|中国|大陆/.test(name)) score += 80;
  else if (/^zh[-_]?sg/.test(lang)) score += 66;
  else if (/^zh[-_]?tw/.test(lang) || /taiwan|國語|台湾/.test(name)) score += 56;
  else if (/^zh[-_]?hk/.test(lang) || /hong kong|香港/.test(name)) score += 36;
  else if (/^zh/.test(lang)) score += 30;
  else if (/chinese|mandarin|中文|普通话|國語/.test(name)) score += 28;

  if (score === 0) return 0;

  if (preferredId && id === preferredId) score += 8;
  if (voice.localService) score += 6;
  if (/natural|neural|premium|enhanced|siri|google|microsoft|xiaoxiao|xiaoyi|xiaobei|xiaohan|yunxi|tingting|mei-?jia|li-?mu|mandarin|普通话/.test(name)) {
    score += 14;
  }
  if (/compact|eloquence|robot|cantonese|粤|粵/.test(name)) score -= 20;

  return score;
}

type ChineseUnit = {
  char: string;
  textIndex: number;
};

function compareChineseAnswer(sampleText: string, inputText: string) {
  const sampleUnits = collectChineseUnits(sampleText);
  const inputUnits = collectChineseUnits(inputText);
  const matched = findMatchedChineseUnits(sampleUnits, inputUnits);
  const matchedSample = new Set(matched.map((pair) => pair.sampleIndex));
  const matchedInput = new Set(matched.map((pair) => pair.inputIndex));
  const sampleWrongIndices = new Set<number>();
  const inputWrongIndices = new Set<number>();

  sampleUnits.forEach((unit, index) => {
    if (!matchedSample.has(index)) sampleWrongIndices.add(unit.textIndex);
  });
  inputUnits.forEach((unit, index) => {
    if (!matchedInput.has(index)) inputWrongIndices.add(unit.textIndex);
  });

  return {
    correct: sampleUnits.length > 0 && sampleUnits.length === inputUnits.length && sampleWrongIndices.size === 0 && inputWrongIndices.size === 0,
    sampleWrongIndices,
    inputWrongIndices
  };
}

function collectChineseUnits(text: string): ChineseUnit[] {
  return Array.from(text).flatMap((char, index) => (isChineseChar(char) ? [{ char, textIndex: index }] : []));
}

function isChineseChar(char: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(char);
}

function findMatchedChineseUnits(sampleUnits: ChineseUnit[], inputUnits: ChineseUnit[]) {
  const rows = sampleUnits.length;
  const cols = inputUnits.length;
  const table = Array.from({ length: rows + 1 }, () => Array<number>(cols + 1).fill(0));

  for (let row = rows - 1; row >= 0; row -= 1) {
    for (let col = cols - 1; col >= 0; col -= 1) {
      table[row][col] =
        sampleUnits[row].char === inputUnits[col].char
          ? table[row + 1][col + 1] + 1
          : Math.max(table[row + 1][col], table[row][col + 1]);
    }
  }

  const matched: Array<{ sampleIndex: number; inputIndex: number }> = [];
  let row = 0;
  let col = 0;

  while (row < rows && col < cols) {
    if (sampleUnits[row].char === inputUnits[col].char) {
      matched.push({ sampleIndex: row, inputIndex: col });
      row += 1;
      col += 1;
    } else if (table[row + 1][col] >= table[row][col + 1]) {
      row += 1;
    } else {
      col += 1;
    }
  }

  return matched;
}

function renderHighlightedText(text: string, wrongIndices: Set<number>) {
  return Array.from(text).map((char, index) => (
    <span className={wrongIndices.has(index) ? "wrong-char" : undefined} key={`${char}-${index}`}>
      {char}
    </span>
  ));
}

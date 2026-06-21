"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase-browser";
import { difficultyOptions, labelDifficulty } from "@/lib/difficulty";
import { GAME_LESSON_STORAGE_KEY, parseGameLessonItems } from "@/lib/game-lesson";
import { correctMessages, pickRandomMessage, wrongMessages } from "@/lib/motivation";
import { getBrowserOwnerId } from "@/lib/shared-access";
import { lessonNumbersFromRows } from "@/lib/lessons";
import { selectStudyItems } from "@/lib/study-selection";
import type { ItemDifficulty, ItemType, StudyItem } from "@/lib/types";
import "./study.css";

type VisibleParts = {
  hanzi: boolean;
  pinyin: boolean;
  meaning: boolean;
};

type CheckState = "idle" | "correct" | "wrong";
type DifficultyFilter = "all" | ItemDifficulty;
type TypeFilter = "all" | ItemType;
type LessonFilter = "all" | number;
type LessonMode = "study" | "review";

const defaultVisible: VisibleParts = { hanzi: false, pinyin: false, meaning: true };
const itemColumns = "id,user_id,document_id,lesson_no,type,difficulty,hanzi,pinyin,meaning,mastery,shown_count,last_shown_at,last_studied_at,created_at";
const lessonSize = 10;
const candidatePageSize = 1000;
const preferredVoiceKey = "hanngu-preferred-chinese-voice";

export default function StudyHome() {
  const [count, setCount] = useState<number | null>(null);
  const [lessonItems, setLessonItems] = useState<StudyItem[]>([]);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [lessonMode, setLessonMode] = useState<LessonMode>("study");
  const [visible, setVisible] = useState<VisibleParts>(defaultVisible);
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState("");
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [feedbackText, setFeedbackText] = useState("");
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [lessonFilter, setLessonFilter] = useState<LessonFilter>("all");
  const [lessonOptions, setLessonOptions] = useState<number[]>([]);
  const lessonComplete = lessonItems.length > 0 && lessonIndex >= lessonItems.length;
  const item = lessonComplete ? null : lessonItems[lessonIndex] || null;

  useEffect(() => {
    if (window.location.hash.includes("error=")) {
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    }

    localStorage.removeItem("hanngu-visible-parts");
    refreshCount();
    refreshLessonOptions();
    createPendingGameLesson();
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

  async function refreshLessonOptions() {
    const ownerId = getBrowserOwnerId();
    try {
      setLessonOptions(await fetchLessonNumbers(ownerId));
    } catch {
      setLessonOptions([]);
    }
  }

  function setPart(part: keyof VisibleParts) {
    const next = { ...visible, [part]: !visible[part] };
    setVisible(next);
  }

  function changeStudyFilters(next: { lesson?: LessonFilter; difficulty?: DifficultyFilter; type?: TypeFilter }) {
    if (next.lesson !== undefined) setLessonFilter(next.lesson);
    if (next.difficulty !== undefined) setDifficultyFilter(next.difficulty);
    if (next.type !== undefined) setTypeFilter(next.type);
    resetLesson();
  }

  async function createLesson() {
    setLoading(true);
    const ownerId = getBrowserOwnerId();

    let candidates: StudyItem[] = [];
    try {
      candidates = await fetchLessonCandidates(ownerId, lessonFilter, difficultyFilter, typeFilter);
    } catch {
      setLoading(false);
      alert("Không lấy được dữ liệu học từ Supabase. Hãy thử tải lại trang.");
      return;
    }

    const selectedItems = selectStudyItems(candidates, lessonSize, { balanceTypes: typeFilter === "all" });
    if (!selectedItems.length) {
      setLoading(false);
      resetLesson();
      resetPractice();
      alert("Chưa có dữ liệu phù hợp với các bộ lọc đang chọn.");
      return;
    }

    const updatedItems = await createLessonFromItems(selectedItems, ownerId);
    if (!updatedItems.length) {
      setLoading(false);
      alert("Không tạo được bài học. Hãy thử lại.");
      return;
    }

    setLessonIndex(0);
    setLessonMode("study");
    setLoading(false);
    resetPractice();
    refreshCount();
  }

  async function createPendingGameLesson() {
    const pendingItems = parseGameLessonItems(sessionStorage.getItem(GAME_LESSON_STORAGE_KEY));
    if (!pendingItems.length) return;

    sessionStorage.removeItem(GAME_LESSON_STORAGE_KEY);
    setLoading(true);

    const ownerId = getBrowserOwnerId();
    const supabase = createClient();
    const ids = pendingItems.map((pendingItem) => pendingItem.id);
    const { data, error } = await supabase.from("items").select(itemColumns).eq("user_id", ownerId).in("id", ids);

    if (error) {
      setLoading(false);
      alert("Không tạo được bài học từ game. Hãy thử lại.");
      return;
    }

    const itemsById = new Map(((data || []) as StudyItem[]).map((studyItem) => [studyItem.id, studyItem]));
    const orderedItems = ids.flatMap((id) => {
      const found = itemsById.get(id);
      return found ? [found] : [];
    });
    const updatedItems = await createLessonFromItems(orderedItems, ownerId);

    setLessonItems(updatedItems);
    setLessonIndex(0);
    setLessonMode("study");
    setLoading(false);
    resetPractice();
    refreshCount();
  }

  async function createLessonFromItems(selectedItems: StudyItem[], ownerId: string) {
    if (!selectedItems.length) return [];

    const supabase = createClient();
    const now = new Date().toISOString();
    const updatedItems = await Promise.all(
      selectedItems.map(async (selectedItem) => {
        const fallbackItem: StudyItem = {
          ...selectedItem,
          shown_count: selectedItem.shown_count + 1,
          last_shown_at: now
        };
        const { data: updated } = await supabase
          .from("items")
          .update({
            shown_count: selectedItem.shown_count + 1,
            last_shown_at: now
          })
          .eq("id", selectedItem.id)
          .eq("user_id", ownerId)
          .select(itemColumns)
          .single();

        return (updated as StudyItem) || fallbackItem;
      })
    );

    await incrementCreateCount(ownerId);
    setLessonItems(updatedItems);
    return updatedItems;
  }

  function nextLessonItem() {
    if (!lessonItems.length) return;
    setLessonIndex((current) => Math.min(current + 1, lessonItems.length));
    resetPractice();
  }

  function reviewLesson() {
    if (!lessonItems.length) return;
    setLessonMode("review");
    setLessonIndex(0);
    resetPractice();
  }

  function resetLesson() {
    setLessonItems([]);
    setLessonIndex(0);
    setLessonMode("study");
    resetPractice();
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
    if (checkState === "correct") return;

    setAnswer(nextAnswer);
    if (item && compareChineseAnswer(item.hanzi, nextAnswer).correct) {
      markAnswerCorrect();
      return;
    }

    if (checkState !== "idle") {
      setCheckState("idle");
      setFeedbackText("");
    }
  }

  function checkAnswer() {
    if (!item) return;

    const result = compareChineseAnswer(item.hanzi, answer);

    if (result.correct) {
      markAnswerCorrect();
      return;
    }

    setVisible((current) => ({ ...current, hanzi: true, pinyin: true }));
    setCheckState("wrong");
    setFeedbackText(pickRandomMessage(wrongMessages));
  }

  function markAnswerCorrect() {
    setVisible((current) => ({ ...current, hanzi: true, pinyin: true }));
    setCheckState("correct");
    setFeedbackText(pickRandomMessage(correctMessages));
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
      <StudyFilters
        lesson={lessonFilter}
        difficulty={difficultyFilter}
        type={typeFilter}
        lessonOptions={lessonOptions}
        onChange={changeStudyFilters}
      />

      {!item ? (
        lessonComplete ? (
          <div className="lesson-complete card">
            <div className="learn-mark">学</div>
            <h1>Đã xong bài học</h1>
            <p className="muted">
              Bạn vừa học {lessonItems.length} mục. Có thể ôn lại bài này hoặc tạo bài học mới.
            </p>
            <button className="button full-width" type="button" onClick={reviewLesson}>
              Ôn lại {lessonItems.length} mục vừa học
            </button>
            <button className="ghost-button full-width" type="button" onClick={createLesson} disabled={loading}>
              {loading ? "Đang tạo..." : "Tạo bài học mới"}
            </button>
          </div>
        ) : (
          <div className="ready-card card">
            <div className="learn-mark">学</div>
            <h1>Sẵn sàng học?</h1>
            <p className="muted">Tạo 1 bài học gồm 10 mục theo bộ lọc đang chọn.</p>
            <button className="button full-width" type="button" onClick={createLesson} disabled={loading}>
              {loading ? "Đang tạo..." : "Tạo bài học"}
            </button>
          </div>
        )
      ) : (
        <>
          <article className="flashcard card">
            <header className="flashcard-head">
              <span>
                {lessonMode === "review" ? "Ôn lại" : "Bài học"} {lessonIndex + 1}/{lessonItems.length}
                {" · "}
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
              readOnly={checkState === "correct"}
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

          <button className="ghost-button full-width" type="button" onClick={nextLessonItem}>
            {lessonIndex + 1 >= lessonItems.length ? "Hoàn thành bài học" : "Mục tiếp theo"}
          </button>
        </>
      )}
    </section>
  );
}

function StudyFilters({
  lesson,
  difficulty,
  type,
  lessonOptions,
  onChange
}: {
  lesson: LessonFilter;
  difficulty: DifficultyFilter;
  type: TypeFilter;
  lessonOptions: number[];
  onChange: (next: { lesson?: LessonFilter; difficulty?: DifficultyFilter; type?: TypeFilter }) => void;
}) {
  return (
    <div className="study-filters" aria-label="Bộ lọc bài học">
      <label className="study-filter-field">
        <span>Bài</span>
        <select value={lesson} onChange={(event) => onChange({ lesson: event.target.value === "all" ? "all" : Number(event.target.value) })}>
          <option value="all">Tất cả</option>
          {lessonOptions.map((lessonNo) => (
            <option value={lessonNo} key={lessonNo}>Bài {lessonNo}</option>
          ))}
        </select>
      </label>
      <label className="study-filter-field">
        <span>Độ khó</span>
        <select value={difficulty} onChange={(event) => onChange({ difficulty: event.target.value as DifficultyFilter })}>
          <option value="all">Tất cả</option>
          {difficultyOptions.map((option) => (
            <option value={option.value} key={option.value}>{option.label}</option>
          ))}
        </select>
      </label>
      <label className="study-filter-field">
        <span>Loại</span>
        <select value={type} onChange={(event) => onChange({ type: event.target.value as TypeFilter })}>
          <option value="all">Tất cả</option>
          <option value="word">Từ</option>
          <option value="sentence">Câu</option>
          <option value="dialogue">Hội thoại</option>
        </select>
      </label>
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

async function fetchLessonCandidates(ownerId: string, lessonFilter: LessonFilter, difficultyFilter: DifficultyFilter, typeFilter: TypeFilter) {
  const supabase = createClient();
  const candidates: StudyItem[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("items")
      .select(itemColumns)
      .eq("user_id", ownerId)
      .lte("mastery", 5)
      .order("shown_count", { ascending: true })
      .order("last_shown_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(offset, offset + candidatePageSize - 1);

    if (difficultyFilter !== "all") {
      query = query.eq("difficulty", difficultyFilter);
    }
    if (lessonFilter !== "all") {
      query = query.eq("lesson_no", lessonFilter);
    }
    if (typeFilter !== "all") {
      query = query.eq("type", typeFilter);
    }

    const { data, error } = await query;
    if (error) throw error;

    const page = Array.isArray(data) ? (data as StudyItem[]) : [];
    candidates.push(...page);

    if (page.length < candidatePageSize) break;
    offset += candidatePageSize;
  }

  return candidates;
}

async function fetchLessonNumbers(ownerId: string) {
  const supabase = createClient();
  const rows: Array<{ lesson_no: number | null; type: ItemType }> = [];

  for (let offset = 0; ; offset += candidatePageSize) {
    const { data, error } = await supabase
      .from("items")
      .select("lesson_no,type")
      .eq("user_id", ownerId)
      .order("lesson_no", { ascending: true })
      .range(offset, offset + candidatePageSize - 1);

    if (error) throw error;
    const page = (data || []) as Array<{ lesson_no: number | null; type: ItemType }>;
    rows.push(...page);
    if (page.length < candidatePageSize) break;
  }

  return lessonNumbersFromRows(rows).reverse();
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

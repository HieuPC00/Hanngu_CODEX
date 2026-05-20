"use client";

import { useState } from "react";
import { difficultyOptions, labelDifficulty } from "@/lib/difficulty";
import { correctMessages, pickRandomMessage, wrongMessages } from "@/lib/motivation";
import { getBrowserOwnerId } from "@/lib/shared-access";
import { createClient } from "@/lib/supabase-browser";
import type { ItemDifficulty, StudyItem } from "@/lib/types";
import "./game.css";

type DifficultyFilter = "all" | ItemDifficulty;
type GameStatus = "setup" | "playing" | "finished";

type GameOption = {
  id: string;
  itemId: string;
  pinyin: string;
  meaning: string;
};

type GameQuestion = {
  item: StudyItem;
  options: GameOption[];
  selectedOptionId?: string;
  wasCorrect?: boolean;
  feedback?: string;
};

const gameSize = 10;
const candidateLimit = 120;
const itemColumns = "id,user_id,document_id,type,difficulty,hanzi,pinyin,meaning,mastery,shown_count,last_shown_at,last_studied_at,created_at";

export default function GameClient() {
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("all");
  const [status, setStatus] = useState<GameStatus>("setup");
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);

  const currentQuestion = status === "playing" ? questions[questionIndex] || null : null;
  const correctCount = questions.filter((question) => question.wasCorrect === true).length;
  const wrongCount = questions.filter((question) => question.wasCorrect === false).length;
  const finalScore = questions.length ? Math.round((correctCount / questions.length) * 10) : 0;

  async function startGame() {
    setLoading(true);

    try {
      const supabase = createClient();
      const ownerId = getBrowserOwnerId();
      let query = supabase
        .from("items")
        .select(itemColumns)
        .eq("user_id", ownerId)
        .eq("type", "word")
        .lte("mastery", 5)
        .order("shown_count", { ascending: true })
        .order("last_shown_at", { ascending: true, nullsFirst: true })
        .limit(candidateLimit);

      if (difficultyFilter !== "all") {
        query = query.eq("difficulty", difficultyFilter);
      }

      const { data, error } = await query;
      if (error) throw error;

      const candidates = Array.isArray(data) ? (data as StudyItem[]) : [];
      const selectedItems = selectGameItems(candidates, Math.min(gameSize, candidates.length));

      if (!selectedItems.length) {
        alert(difficultyFilter === "all" ? "Chưa có từ vựng để chơi game." : `Chưa có từ vựng mức ${labelDifficulty(difficultyFilter)} để chơi game.`);
        setQuestions([]);
        setStatus("setup");
        return;
      }

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

      await supabase.rpc("increment_create_count", { p_user_id: ownerId });
      setQuestions(buildGameQuestions(updatedItems, mergeUniqueItems([...updatedItems, ...candidates])));
      setQuestionIndex(0);
      setStatus("playing");
    } catch (error) {
      alert(error instanceof Error ? `Không tạo được game: ${error.message}` : "Không tạo được game.");
    } finally {
      setLoading(false);
    }
  }

  function chooseOption(option: GameOption) {
    if (!currentQuestion || currentQuestion.selectedOptionId) return;

    const isCorrect = option.itemId === currentQuestion.item.id;
    setQuestions((current) =>
      current.map((question, index) =>
        index === questionIndex
          ? {
              ...question,
              selectedOptionId: option.id,
              wasCorrect: isCorrect,
              feedback: pickRandomMessage(isCorrect ? correctMessages : wrongMessages)
            }
          : question
      )
    );
  }

  function goNext() {
    if (questionIndex + 1 >= questions.length) {
      setStatus("finished");
      return;
    }

    setQuestionIndex((current) => current + 1);
  }

  function resetToSetup() {
    setStatus("setup");
    setQuestions([]);
    setQuestionIndex(0);
  }

  if (status === "finished") {
    return (
      <section className="game-stack">
        <div className="game-finish card">
          <div className="game-score">{finalScore}/10</div>
          <h1>Kết quả game</h1>
          <div className="game-result-grid">
            <ResultStat label="Đúng" value={correctCount} tone="good" />
            <ResultStat label="Sai" value={wrongCount} tone="bad" />
            <ResultStat label="Tổng" value={questions.length} />
          </div>
          <button className="button full-width" type="button" onClick={startGame} disabled={loading}>
            {loading ? "Đang tạo..." : "Chơi lại"}
          </button>
          <button className="ghost-button full-width" type="button" onClick={resetToSetup}>
            Về chọn game
          </button>
        </div>
      </section>
    );
  }

  if (status === "playing" && currentQuestion) {
    const answered = Boolean(currentQuestion.selectedOptionId);
    const selectedOption = currentQuestion.options.find((option) => option.id === currentQuestion.selectedOptionId) || null;
    const correctOption = currentQuestion.options.find((option) => option.itemId === currentQuestion.item.id) || null;

    return (
      <section className="game-stack">
        <header className="game-play-head">
          <div>
            <h1>Game</h1>
            <p>
              Câu {questionIndex + 1}/{questions.length} · Đúng {correctCount} · Sai {wrongCount}
            </p>
          </div>
          <span>{labelDifficulty(currentQuestion.item.difficulty)}</span>
        </header>

        <article className={`game-card card ${answered ? (currentQuestion.wasCorrect ? "is-correct" : "is-wrong") : ""}`}>
          <div className="game-card-label">Nhìn Hán tự, chọn đúng cặp pinyin + nghĩa</div>
          <div className="game-hanzi">{currentQuestion.item.hanzi}</div>
        </article>

        <div className="game-options">
          {currentQuestion.options.map((option) => {
            const isSelected = option.id === currentQuestion.selectedOptionId;
            const isCorrect = option.itemId === currentQuestion.item.id;
            const className = [
              "game-option",
              answered && isCorrect ? "correct" : "",
              answered && isSelected && !isCorrect ? "wrong" : ""
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <button className={className} type="button" key={option.id} onClick={() => chooseOption(option)} disabled={answered}>
                <strong>{option.pinyin}</strong>
                <span>{option.meaning}</span>
              </button>
            );
          })}
        </div>

        {answered ? (
          <div className={`game-feedback card ${currentQuestion.wasCorrect ? "correct" : "wrong"}`} aria-live="polite">
            <strong>{currentQuestion.feedback}</strong>
            {!currentQuestion.wasCorrect && selectedOption && correctOption ? (
              <div className="game-correction">
                <p>
                  Bạn chọn: <span>{selectedOption.pinyin}</span> · {selectedOption.meaning}
                </p>
                <p>
                  Đáp án đúng: <span>{correctOption.pinyin}</span> · {correctOption.meaning}
                </p>
              </div>
            ) : null}
          </div>
        ) : null}

        <button className="button full-width" type="button" onClick={goNext} disabled={!answered}>
          {questionIndex + 1 >= questions.length ? "Xem kết quả" : "Câu tiếp theo"}
        </button>
      </section>
    );
  }

  return (
    <section className="game-stack">
      <header className="game-page-head">
        <h1>Game</h1>
        <p>Chơi tương tác để nhớ mặt Hán tự. Chế độ này chỉ lấy dữ liệu loại Từ vựng.</p>
      </header>

      <section className="game-setup card">
        <div className="game-section">
          <h2>Loại game</h2>
          <button className="game-mode active" type="button">
            <strong>Nhìn Chữ Đoán Nghĩa</strong>
            <span>Hiện Hán tự, chọn đúng cặp pinyin + nghĩa.</span>
          </button>
        </div>

        <div className="game-section">
          <h2>Mức độ</h2>
          <DifficultyFilterControl value={difficultyFilter} onChange={setDifficultyFilter} />
        </div>

        <button className="button full-width" type="button" onClick={startGame} disabled={loading}>
          {loading ? "Đang tạo..." : "Bắt đầu game 10 từ"}
        </button>
      </section>
    </section>
  );
}

function DifficultyFilterControl({ value, onChange }: { value: DifficultyFilter; onChange: (value: DifficultyFilter) => void }) {
  return (
    <div className="game-difficulty-filter" aria-label="Bộ lọc độ khó">
      <button className={value === "all" ? "active" : ""} type="button" onClick={() => onChange("all")}>
        Tất cả
      </button>
      {difficultyOptions.map((option) => (
        <button className={value === option.value ? "active" : ""} type="button" key={option.value} onClick={() => onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

function ResultStat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className={`game-result-stat ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function selectGameItems(candidates: StudyItem[], size: number) {
  const remaining = [...candidates].sort(compareStudyPriority);
  const selected: StudyItem[] = [];

  while (remaining.length && selected.length < size) {
    const bestShownCount = remaining[0].shown_count;
    const sameShown = remaining.filter((candidate) => candidate.shown_count === bestShownCount).sort(compareLastShownAt);
    const needed = size - selected.length;
    const poolSize = Math.min(sameShown.length, Math.max(needed, needed * 3));
    const picked = shuffleItems(sameShown.slice(0, poolSize)).slice(0, needed);
    const pickedIds = new Set(picked.map((candidate) => candidate.id));

    selected.push(...picked);

    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (pickedIds.has(remaining[index].id)) remaining.splice(index, 1);
    }
  }

  return selected;
}

function buildGameQuestions(items: StudyItem[], optionPool: StudyItem[]): GameQuestion[] {
  return items.map((item) => ({
    item,
    options: buildOptions(item, optionPool)
  }));
}

function buildOptions(item: StudyItem, optionPool: StudyItem[]): GameOption[] {
  const correctOption = toGameOption(item);
  const correctKey = optionKey(correctOption);
  const distractors = shuffleItems(optionPool)
    .filter((candidate) => candidate.id !== item.id)
    .map(toGameOption)
    .filter((option, index, options) => optionKey(option) !== correctKey && options.findIndex((current) => optionKey(current) === optionKey(option)) === index)
    .slice(0, 3);

  return shuffleOptions([correctOption, ...distractors]);
}

function toGameOption(item: StudyItem): GameOption {
  return {
    id: `${item.id}-${item.pinyin || ""}-${item.meaning || ""}`,
    itemId: item.id,
    pinyin: item.pinyin?.trim() || "Chưa có pinyin",
    meaning: item.meaning?.trim() || "Chưa có nghĩa"
  };
}

function optionKey(option: GameOption) {
  return `${option.pinyin.toLowerCase()}|${option.meaning.toLowerCase()}`;
}

function mergeUniqueItems(items: StudyItem[]) {
  const seen = new Set<string>();
  const result: StudyItem[] = [];

  items.forEach((item) => {
    if (seen.has(item.id)) return;
    seen.add(item.id);
    result.push(item);
  });

  return result;
}

function compareStudyPriority(left: StudyItem, right: StudyItem) {
  return left.shown_count - right.shown_count || compareLastShownAt(left, right);
}

function compareLastShownAt(left: StudyItem, right: StudyItem) {
  const leftTime = left.last_shown_at ? new Date(left.last_shown_at).getTime() : 0;
  const rightTime = right.last_shown_at ? new Date(right.last_shown_at).getTime() : 0;
  return leftTime - rightTime;
}

function shuffleItems<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

function shuffleOptions(options: GameOption[]) {
  return shuffleItems(options);
}

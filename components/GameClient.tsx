"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { difficultyOptions, labelDifficulty } from "@/lib/difficulty";
import { GAME_LESSON_STORAGE_KEY, serializeGameLessonItems } from "@/lib/game-lesson";
import { correctMessages, pickRandomMessage, wrongMessages } from "@/lib/motivation";
import { getBrowserOwnerId } from "@/lib/shared-access";
import { createClient } from "@/lib/supabase-browser";
import type { ItemDifficulty, StudyItem } from "@/lib/types";
import "./game.css";

type DifficultyFilter = "all" | ItemDifficulty;
type GameStatus = "setup" | "playing" | "finished";
type GameMode = "choice" | "write";
type WriteStatus = "idle" | "loading" | "ready" | "correct" | "wrong" | "error";

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

type HanziWriterInstance = {
  quiz: (options?: Record<string, unknown>) => Promise<unknown>;
  cancelQuiz: () => void;
  animateCharacter: () => Promise<unknown>;
};

const gameSize = 10;
const candidateLimit = 160;
const writerSize = 220;
const itemColumns = "id,user_id,document_id,type,difficulty,hanzi,pinyin,meaning,mastery,shown_count,last_shown_at,last_studied_at,created_at";

export default function GameClient() {
  const router = useRouter();
  const writerTargetRef = useRef<HTMLDivElement | null>(null);
  const writerRef = useRef<HanziWriterInstance | null>(null);
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("all");
  const [gameMode, setGameMode] = useState<GameMode>("choice");
  const [status, setStatus] = useState<GameStatus>("setup");
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [showWritePinyin, setShowWritePinyin] = useState(false);
  const [writeCharIndex, setWriteCharIndex] = useState(0);
  const [revealedCharCount, setRevealedCharCount] = useState(0);
  const [currentCharComplete, setCurrentCharComplete] = useState(false);
  const [writeHadMistake, setWriteHadMistake] = useState(false);
  const [writeStatus, setWriteStatus] = useState<WriteStatus>("idle");
  const [writeFeedback, setWriteFeedback] = useState("");
  const [flyingChar, setFlyingChar] = useState<{ char: string; key: number } | null>(null);

  const currentQuestion = status === "playing" ? questions[questionIndex] || null : null;
  const writeChars = useMemo(() => collectChineseChars(currentQuestion?.item.hanzi || ""), [currentQuestion?.item.hanzi]);
  const currentWriteChar = gameMode === "write" ? writeChars[writeCharIndex] || "" : "";
  const choiceAnswered = gameMode === "choice" && Boolean(currentQuestion?.selectedOptionId);
  const writeAnswered = gameMode === "write" && currentQuestion?.wasCorrect !== undefined;
  const answered = choiceAnswered || writeAnswered;
  const correctCount = questions.filter((question) => question.wasCorrect === true).length;
  const wrongCount = questions.filter((question) => question.wasCorrect === false).length;
  const finalScore = questions.length ? Math.round((correctCount / questions.length) * 10) : 0;

  useEffect(() => {
    if (status !== "playing" || gameMode !== "write" || !currentQuestion || !currentWriteChar || writeAnswered) return;

    let canceled = false;
    const target = writerTargetRef.current;
    if (!target) return;

    target.innerHTML = "";
    setCurrentCharComplete(false);
    setWriteStatus("loading");
    setWriteFeedback("Đang tải khung viết...");

    import("hanzi-writer")
      .then(({ default: HanziWriter }) => {
        if (canceled || !writerTargetRef.current) return;

        const writer = HanziWriter.create(writerTargetRef.current, currentWriteChar, {
          width: writerSize,
          height: writerSize,
          padding: 12,
          showCharacter: false,
          showOutline: true,
          strokeColor: "#1f2937",
          outlineColor: "#d6e3f3",
          drawingColor: "#2563eb",
          highlightColor: "#2563eb",
          highlightCompleteColor: "#16a34a",
          drawingWidth: 18,
          strokeWidth: 2,
          showHintAfterMisses: 2,
          onLoadCharDataSuccess: () => {
            if (canceled) return;
            setWriteStatus("idle");
            setWriteFeedback("");
          },
          onLoadCharDataError: () => {
            if (canceled) return;
            setWriteStatus("error");
            setWriteFeedback("Không tải được dữ liệu nét cho chữ này. Hãy kiểm tra mạng rồi thử lại.");
          }
        }) as HanziWriterInstance;

        writerRef.current = writer;
        writer.quiz({
          leniency: 1.08,
          showHintAfterMisses: 2,
          highlightOnComplete: true,
          acceptBackwardsStrokes: false,
          markStrokeCorrectAfterMisses: false,
          onMistake: () => {
            if (canceled) return;
            setWriteHadMistake(true);
            setWriteStatus("wrong");
            setWriteFeedback(pickRandomMessage(wrongMessages));
          },
          onComplete: () => {
            if (canceled) return;
            setCurrentCharComplete(true);
            setWriteStatus("ready");
            setWriteFeedback("Đã viết đủ nét. Bấm Kiểm tra để đưa chữ lên khung.");
          }
        });
      })
      .catch(() => {
        if (canceled) return;
        setWriteStatus("error");
        setWriteFeedback("Không mở được khung viết Hán tự. Hãy tải lại trang.");
      });

    return () => {
      canceled = true;
      writerRef.current?.cancelQuiz();
      writerRef.current = null;
      target.innerHTML = "";
    };
  }, [status, gameMode, currentQuestion?.item.id, currentWriteChar, writeAnswered]);

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

      const candidates = (Array.isArray(data) ? (data as StudyItem[]) : []).filter((item) => isUsableWord(item, gameMode));
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
      resetWriteProgress();
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

  function checkWrittenChar() {
    if (!currentQuestion || writeAnswered) return;

    if (writeStatus === "loading") return;
    if (writeStatus === "error") {
      setWriteFeedback("Chưa thể kiểm tra vì khung nét chưa tải được.");
      return;
    }

    if (!currentCharComplete || !currentWriteChar) {
      setWriteHadMistake(true);
      setWriteStatus("wrong");
      setWriteFeedback(pickRandomMessage(wrongMessages));
      return;
    }

    const nextCount = writeCharIndex + 1;
    const wordComplete = nextCount >= writeChars.length;
    setFlyingChar({ char: currentWriteChar, key: Date.now() });
    setWriteStatus("correct");
    setWriteFeedback(wordComplete ? "Đã viết đủ từ này." : "Đúng chữ này, sang chữ tiếp theo.");

    window.setTimeout(() => {
      setRevealedCharCount(nextCount);
      setFlyingChar(null);

      if (wordComplete) {
        const isPerfect = !writeHadMistake;
        setQuestions((current) =>
          current.map((question, index) =>
            index === questionIndex
              ? {
                  ...question,
                  wasCorrect: isPerfect,
                  feedback: pickRandomMessage(isPerfect ? correctMessages : wrongMessages)
                }
              : question
          )
        );
        setWriteStatus(isPerfect ? "correct" : "wrong");
        setWriteFeedback("");
        return;
      }

      setWriteCharIndex(nextCount);
      setCurrentCharComplete(false);
      setWriteStatus("idle");
      setWriteFeedback("");
    }, 560);
  }

  async function showStrokeHint() {
    if (!writerRef.current) return;
    try {
      await writerRef.current.animateCharacter();
      await writerRef.current.quiz({
        leniency: 1.08,
        showHintAfterMisses: 2,
        highlightOnComplete: true,
        acceptBackwardsStrokes: false,
        markStrokeCorrectAfterMisses: false,
        onMistake: () => {
          setWriteHadMistake(true);
          setWriteStatus("wrong");
          setWriteFeedback(pickRandomMessage(wrongMessages));
        },
        onComplete: () => {
          setCurrentCharComplete(true);
          setWriteStatus("ready");
          setWriteFeedback("Đã viết đủ nét. Bấm Kiểm tra để đưa chữ lên khung.");
        }
      });
    } catch {
      setWriteFeedback("Chưa hiện được gợi ý nét.");
    }
  }

  function goNext() {
    if (!answered) return;

    if (questionIndex + 1 >= questions.length) {
      setStatus("finished");
      return;
    }

    setQuestionIndex((current) => current + 1);
    resetWriteProgress();
  }

  function resetToSetup() {
    setStatus("setup");
    setQuestions([]);
    setQuestionIndex(0);
    resetWriteProgress();
  }

  function createStudyLessonFromGame() {
    const playedItems = questions.map((question) => question.item);
    if (!playedItems.length) return;

    sessionStorage.setItem(GAME_LESSON_STORAGE_KEY, serializeGameLessonItems(playedItems));
    router.push("/");
  }

  function resetWriteProgress() {
    setShowWritePinyin(false);
    setWriteCharIndex(0);
    setRevealedCharCount(0);
    setCurrentCharComplete(false);
    setWriteHadMistake(false);
    setWriteStatus("idle");
    setWriteFeedback("");
    setFlyingChar(null);
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
          <button className="ghost-button full-width" type="button" onClick={createStudyLessonFromGame}>
            Tạo bài học
          </button>
          <button className="ghost-button full-width" type="button" onClick={resetToSetup}>
            Về chọn game
          </button>
        </div>
      </section>
    );
  }

  if (status === "playing" && currentQuestion) {
    return gameMode === "write" ? renderWriteGame() : renderChoiceGame();
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
          <div className="game-mode-grid">
            <button className={gameMode === "choice" ? "game-mode active" : "game-mode"} type="button" onClick={() => setGameMode("choice")}>
              <strong>Nhìn Chữ Đoán Nghĩa</strong>
              <span>Hiện Hán tự, chọn đúng cặp pinyin + nghĩa.</span>
            </button>
            <button className={gameMode === "write" ? "game-mode active" : "game-mode"} type="button" onClick={() => setGameMode("write")}>
              <strong>Vẽ Lại Hán Tự</strong>
              <span>Nhìn nghĩa, viết từng chữ đúng nét rồi đưa lên khung.</span>
            </button>
          </div>
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

  function renderChoiceGame() {
    if (!currentQuestion) return null;

    const selectedOption = currentQuestion.options.find((option) => option.id === currentQuestion.selectedOptionId) || null;
    const correctOption = currentQuestion.options.find((option) => option.itemId === currentQuestion.item.id) || null;

    return (
      <section className="game-stack">
        <GamePlayHead
          title="Nhìn Chữ Đoán Nghĩa"
          questionIndex={questionIndex}
          questionCount={questions.length}
          correctCount={correctCount}
          wrongCount={wrongCount}
          difficulty={currentQuestion.item.difficulty}
        />

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

  function renderWriteGame() {
    if (!currentQuestion) return null;

    const finalFeedback = currentQuestion.feedback;

    return (
      <section className="game-stack">
        <GamePlayHead
          title="Vẽ Lại Hán Tự"
          questionIndex={questionIndex}
          questionCount={questions.length}
          correctCount={correctCount}
          wrongCount={wrongCount}
          difficulty={currentQuestion.item.difficulty}
        />

        <article className={`game-card write-card card ${writeAnswered ? (currentQuestion.wasCorrect ? "is-correct" : "is-wrong") : ""}`}>
          <div className="game-card-label">Nhìn nghĩa, viết đúng từng chữ Hán</div>
          <div className="write-meaning">{currentQuestion.item.meaning}</div>
          <button className={showWritePinyin ? "toggle-mini active" : "toggle-mini"} type="button" onClick={() => setShowWritePinyin((current) => !current)}>
            {showWritePinyin ? "Ẩn Pinyin" : "Hiện Pinyin"}
          </button>
          {showWritePinyin ? <div className="write-pinyin">{currentQuestion.item.pinyin}</div> : null}
          <div className="hanzi-slots" aria-label="Khung Hán tự">
            {writeChars.map((char, index) => (
              <span className={index < revealedCharCount ? "hanzi-slot filled" : index === writeCharIndex ? "hanzi-slot current" : "hanzi-slot"} key={`${char}-${index}`}>
                {index < revealedCharCount ? char : ""}
              </span>
            ))}
          </div>
        </article>

        {!writeAnswered ? (
          <section className={`writer-panel card ${writeStatus === "wrong" ? "wrong" : ""} ${writeStatus === "correct" || writeStatus === "ready" ? "correct" : ""}`}>
            {flyingChar ? (
              <div className="flying-char" key={flyingChar.key}>
                {flyingChar.char}
              </div>
            ) : null}
            <div className="writer-topline">
              <strong>
                Chữ {Math.min(writeCharIndex + 1, writeChars.length)}/{writeChars.length}
              </strong>
              <button className="ghost-button hint-button" type="button" onClick={showStrokeHint}>
                Gợi ý nét
              </button>
            </div>
            <div className="writer-target" ref={writerTargetRef} />
            {writeFeedback ? <div className={`game-feedback ${writeStatus === "wrong" || writeStatus === "error" ? "wrong" : "correct"}`}>{writeFeedback}</div> : null}
            <button className="button full-width" type="button" onClick={checkWrittenChar}>
              Kiểm tra
            </button>
          </section>
        ) : (
          <div className={`game-feedback card ${currentQuestion.wasCorrect ? "correct" : "wrong"}`} aria-live="polite">
            <strong>{finalFeedback}</strong>
            <div className="game-correction">
              <p>
                Hán tự: <span className="correction-hanzi">{currentQuestion.item.hanzi}</span>
              </p>
              <p>
                Pinyin: <span>{currentQuestion.item.pinyin}</span>
              </p>
            </div>
          </div>
        )}

        <button className="button full-width" type="button" onClick={goNext} disabled={!answered}>
          {questionIndex + 1 >= questions.length ? "Xem kết quả" : "Câu tiếp theo"}
        </button>
      </section>
    );
  }
}

function GamePlayHead({
  title,
  questionIndex,
  questionCount,
  correctCount,
  wrongCount,
  difficulty
}: {
  title: string;
  questionIndex: number;
  questionCount: number;
  correctCount: number;
  wrongCount: number;
  difficulty: ItemDifficulty;
}) {
  return (
    <header className="game-play-head">
      <div>
        <h1>{title}</h1>
        <p>
          Câu {questionIndex + 1}/{questionCount} · Đúng {correctCount} · Sai {wrongCount}
        </p>
      </div>
      <span>{labelDifficulty(difficulty)}</span>
    </header>
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
  const distractors = mergeUniqueOptions(
    optionPool
      .filter((candidate) => candidate.id !== item.id && isUsableWord(candidate, "choice"))
      .sort((left, right) => scoreDistractor(left, item) - scoreDistractor(right, item))
      .map(toGameOption)
      .filter((option) => optionKey(option) !== correctKey)
  ).slice(0, 3);

  return shuffleItems([correctOption, ...distractors]);
}

function scoreDistractor(candidate: StudyItem, target: StudyItem) {
  const targetHanziLength = countChineseChars(target.hanzi);
  const candidateHanziLength = countChineseChars(candidate.hanzi);
  const pinyinDiff = Math.abs(compactLength(candidate.pinyin) - compactLength(target.pinyin));
  const meaningDiff = Math.abs(compactLength(candidate.meaning) - compactLength(target.meaning));
  const difficultyPenalty = candidate.difficulty === target.difficulty ? 0 : 18;

  return Math.abs(candidateHanziLength - targetHanziLength) * 1000 + pinyinDiff * 4 + meaningDiff * 2 + difficultyPenalty + Math.random();
}

function toGameOption(item: StudyItem): GameOption {
  return {
    id: `${item.id}-${item.pinyin || ""}-${item.meaning || ""}`,
    itemId: item.id,
    pinyin: item.pinyin?.trim() || "Chưa có pinyin",
    meaning: item.meaning?.trim() || "Chưa có nghĩa"
  };
}

function mergeUniqueOptions(options: GameOption[]) {
  const seen = new Set<string>();
  const result: GameOption[] = [];

  options.forEach((option) => {
    const key = optionKey(option);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(option);
  });

  return result;
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

function isUsableWord(item: StudyItem, mode: GameMode) {
  if (item.type !== "word") return false;
  if (!collectChineseChars(item.hanzi).length) return false;
  if (mode === "choice") return Boolean(item.pinyin?.trim() && item.meaning?.trim());
  return Boolean(item.meaning?.trim());
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

function collectChineseChars(text: string) {
  return Array.from(text).filter((char) => isChineseChar(char));
}

function countChineseChars(text: string) {
  return collectChineseChars(text).length;
}

function compactLength(text?: string | null) {
  return (text || "").replace(/\s+/g, "").length;
}

function isChineseChar(char: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(char);
}

"use client";

import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { useRouter } from "next/navigation";
import { difficultyOptions, labelDifficulty } from "@/lib/difficulty";
import { GAME_LESSON_STORAGE_KEY, serializeGameLessonItems } from "@/lib/game-lesson";
import { correctMessages, pickRandomMessage, wrongMessages } from "@/lib/motivation";
import { getBrowserOwnerId } from "@/lib/shared-access";
import { lessonNumbersFromRows } from "@/lib/lessons";
import { selectStudyItems, uniqueStudyItems } from "@/lib/study-selection";
import { createClient } from "@/lib/supabase-browser";
import type { ItemDifficulty, StudyItem } from "@/lib/types";
import "./game.css";

type DifficultyFilter = "all" | ItemDifficulty;
type LessonFilter = "all" | number;
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
  showOutline: (options?: Record<string, unknown>) => Promise<unknown> | void;
  hideOutline: (options?: Record<string, unknown>) => Promise<unknown> | void;
  getCharacterData: () => Promise<{ strokes: Array<{ points: Point[] }> }>;
};

type Point = {
  x: number;
  y: number;
};

const gameSize = 10;
const candidatePageSize = 1000;
const writerSize = 220;
const handwritingMatchThreshold = 0.13;
const handwritingCoverageThreshold = 0.82;
const handwritingStrokeCoverageThreshold = 0.56;
const handwritingStrokeReverseCoverageThreshold = 0.32;
const handwritingPointCoverageRadius = 0.085;
const itemColumns = "id,user_id,document_id,lesson_no,type,difficulty,hanzi,pinyin,meaning,mastery,shown_count,last_shown_at,last_studied_at,created_at";

export default function GameClient() {
  const router = useRouter();
  const writerTargetRef = useRef<HTMLDivElement | null>(null);
  const writerCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const writerRef = useRef<HanziWriterInstance | null>(null);
  const showStrokeGuideRef = useRef(false);
  const writeHadMistakeRef = useRef(false);
  const advancingCharRef = useRef(false);
  const charAdvanceTimerRef = useRef<number | null>(null);
  const freehandStrokesRef = useRef<Point[][]>([]);
  const activeFreehandStrokeRef = useRef<Point[] | null>(null);
  const targetStrokePointsRef = useRef<Point[][]>([]);
  const [difficultyFilter, setDifficultyFilter] = useState<DifficultyFilter>("all");
  const [lessonFilter, setLessonFilter] = useState<LessonFilter>("all");
  const [lessonOptions, setLessonOptions] = useState<number[]>([]);
  const [gameMode, setGameMode] = useState<GameMode>("choice");
  const [status, setStatus] = useState<GameStatus>("setup");
  const [loading, setLoading] = useState(false);
  const [questions, setQuestions] = useState<GameQuestion[]>([]);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [showWritePinyin, setShowWritePinyin] = useState(false);
  const [showStrokeGuide, setShowStrokeGuide] = useState(false);
  const [writeCharIndex, setWriteCharIndex] = useState(0);
  const [revealedCharCount, setRevealedCharCount] = useState(0);
  const [writeStatus, setWriteStatus] = useState<WriteStatus>("idle");
  const [writeFeedback, setWriteFeedback] = useState("");
  const [flyingChar, setFlyingChar] = useState<{ char: string; key: number } | null>(null);
  const [hasFreehandDrawing, setHasFreehandDrawing] = useState(false);

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
    fetchGameLessonNumbers(getBrowserOwnerId()).then(setLessonOptions).catch(() => setLessonOptions([]));
  }, []);

  useEffect(() => {
    if (status !== "playing" || gameMode !== "write" || !currentQuestion || !currentWriteChar || writeAnswered) return;

    let canceled = false;
    const target = writerTargetRef.current;
    const canvas = writerCanvasRef.current;
    if (!target || !canvas) return;

    target.innerHTML = "";
    prepareFreehandCanvas(canvas);
    clearFreehandCanvas(false);
    targetStrokePointsRef.current = [];
    advancingCharRef.current = false;
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
          showOutline: showStrokeGuideRef.current,
          strokeColor: "#1f2937",
          outlineColor: "#d6e3f3",
          drawingColor: "#2563eb",
          highlightColor: "#2563eb",
          highlightCompleteColor: "#16a34a",
          drawingWidth: 5,
          strokeWidth: 2,
          showHintAfterMisses: false,
          onLoadCharDataError: () => {
            if (canceled) return;
            setWriteStatus("error");
            setWriteFeedback("Không tải được dữ liệu nét cho chữ này. Hãy kiểm tra mạng rồi thử lại.");
          }
        }) as HanziWriterInstance;

        writerRef.current = writer;
        writer.getCharacterData().then((characterData) => {
          if (canceled) return;
          targetStrokePointsRef.current = characterData.strokes.map((stroke) => stroke.points);
          setWriteStatus("idle");
          setWriteFeedback("");
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
      clearFreehandCanvas(false);
    };
  }, [status, gameMode, currentQuestion?.item.id, currentWriteChar, writeCharIndex, writeAnswered]);

  useEffect(() => {
    const canvas = writerCanvasRef.current;
    if (!canvas) return;

    const preventTouchDefault = (event: TouchEvent) => {
      event.preventDefault();
    };

    canvas.addEventListener("touchstart", preventTouchDefault, { passive: false });
    canvas.addEventListener("touchmove", preventTouchDefault, { passive: false });
    canvas.addEventListener("touchend", preventTouchDefault, { passive: false });
    canvas.addEventListener("touchcancel", preventTouchDefault, { passive: false });

    return () => {
      canvas.removeEventListener("touchstart", preventTouchDefault);
      canvas.removeEventListener("touchmove", preventTouchDefault);
      canvas.removeEventListener("touchend", preventTouchDefault);
      canvas.removeEventListener("touchcancel", preventTouchDefault);
    };
  }, [status, gameMode, currentWriteChar]);

  useEffect(() => {
    return () => {
      document.body.classList.remove("is-writing-hanzi");
    };
  }, []);

  async function startGame() {
    setLoading(true);

    try {
      const supabase = createClient();
      const ownerId = getBrowserOwnerId();
      const candidates = (await fetchGameCandidates(ownerId, lessonFilter, difficultyFilter)).filter((item) => isUsableWord(item, gameMode));
      const selectedItems = selectStudyItems(candidates, gameSize);

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

  function completeWrittenChar() {
    if (!currentQuestion || writeAnswered || !currentWriteChar || advancingCharRef.current) return;

    advancingCharRef.current = true;
    const nextCount = writeCharIndex + 1;
    const wordComplete = nextCount >= writeChars.length;
    clearFreehandCanvas(false);
    setFlyingChar({ char: currentWriteChar, key: Date.now() });
    setWriteStatus("correct");
    setWriteFeedback(wordComplete ? "Đã viết đủ từ này." : "Đúng chữ này, tự sang chữ tiếp theo.");
    setShowStrokeGuide(false);
    showStrokeGuideRef.current = false;
    Promise.resolve(writerRef.current?.hideOutline({ duration: 0 })).catch(() => undefined);

    if (charAdvanceTimerRef.current) {
      window.clearTimeout(charAdvanceTimerRef.current);
    }

    charAdvanceTimerRef.current = window.setTimeout(() => {
      charAdvanceTimerRef.current = null;
      setRevealedCharCount(nextCount);
      setFlyingChar(null);

      if (wordComplete) {
        const isPerfect = !writeHadMistakeRef.current;
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
        advancingCharRef.current = false;
        return;
      }

      setWriteCharIndex(nextCount);
      setWriteStatus("idle");
      setWriteFeedback("");
      advancingCharRef.current = false;
    }, 560);
  }

  function checkWrittenChar() {
    if (!currentQuestion || writeAnswered || !currentWriteChar || advancingCharRef.current) return;

    const strokes = freehandStrokesRef.current.filter((stroke) => stroke.length > 1);
    if (!hasFreehandDrawing || !strokes.length) {
      setWriteStatus("wrong");
      setWriteFeedback("Bạn viết thử chữ này trước rồi hãy kiểm tra.");
      return;
    }

    const result = scoreFreehandWriting(strokes, targetStrokePointsRef.current);
    if (isFreehandWritingAccepted(result)) {
      completeWrittenChar();
      return;
    }

    writeHadMistakeRef.current = true;
    setWriteStatus("wrong");
    setWriteFeedback(pickRandomMessage(wrongMessages));
  }

  function toggleStrokeGuide() {
    setShowStrokeGuide((current) => {
      const next = !current;
      showStrokeGuideRef.current = next;

      const writer = writerRef.current;
      if (writer) {
        const action = next ? writer.showOutline({ duration: 150 }) : writer.hideOutline({ duration: 150 });
        Promise.resolve(action).catch(() => {
          setWriteFeedback("Chưa đổi được trạng thái gợi ý nét.");
        });
      }

      return next;
    });
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

  function replayCurrentGame() {
    if (!questions.length) return;

    setQuestions((current) =>
      current.map((question) => ({
        item: question.item,
        options: gameMode === "choice" ? shuffleItems(question.options) : question.options
      }))
    );
    setQuestionIndex(0);
    resetWriteProgress();
    setStatus("playing");
  }

  function resetWriteProgress() {
    if (charAdvanceTimerRef.current) {
      window.clearTimeout(charAdvanceTimerRef.current);
      charAdvanceTimerRef.current = null;
    }
    setShowWritePinyin(false);
    setShowStrokeGuide(false);
    showStrokeGuideRef.current = false;
    writeHadMistakeRef.current = false;
    advancingCharRef.current = false;
    targetStrokePointsRef.current = [];
    clearFreehandCanvas(false);
    setWriteCharIndex(0);
    setRevealedCharCount(0);
    setWriteStatus("idle");
    setWriteFeedback("");
    setFlyingChar(null);
  }

  function prepareFreehandCanvas(canvas: HTMLCanvasElement) {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = writerSize * ratio;
    canvas.height = writerSize * ratio;
    canvas.style.width = `${writerSize}px`;
    canvas.style.height = `${writerSize}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, writerSize, writerSize);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = 5;
    context.strokeStyle = "#1f2937";
  }

  function clearFreehandCanvas(resetFeedback = true) {
    freehandStrokesRef.current = [];
    activeFreehandStrokeRef.current = null;
    document.body.classList.remove("is-writing-hanzi");
    setHasFreehandDrawing(false);

    const canvas = writerCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (context) {
      context.clearRect(0, 0, writerSize, writerSize);
    }

    if (resetFeedback) {
      setWriteStatus("idle");
      setWriteFeedback("");
    }
  }

  function beginFreehandStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (writeAnswered || advancingCharRef.current || writeStatus === "loading" || writeStatus === "error") return;

    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    document.body.classList.add("is-writing-hanzi");
    const point = getCanvasPoint(event);
    const stroke = [point];
    activeFreehandStrokeRef.current = stroke;
    freehandStrokesRef.current = [...freehandStrokesRef.current, stroke];
    setHasFreehandDrawing(true);
    setWriteStatus("idle");
    setWriteFeedback("");
    drawFreehandDot(point);
  }

  function moveFreehandStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    const stroke = activeFreehandStrokeRef.current;
    if (!stroke) return;

    event.preventDefault();
    const point = getCanvasPoint(event);
    const previousPoint = stroke[stroke.length - 1];
    stroke.push(point);
    drawFreehandLine(previousPoint, point);
  }

  function endFreehandStroke(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!activeFreehandStrokeRef.current) return;
    event.preventDefault();
    activeFreehandStrokeRef.current = null;
    document.body.classList.remove("is-writing-hanzi");
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function getCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: clamp(event.clientX - rect.left, 0, writerSize),
      y: clamp(event.clientY - rect.top, 0, writerSize)
    };
  }

  function drawFreehandDot(point: Point) {
    const context = writerCanvasRef.current?.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.arc(point.x, point.y, 2.5, 0, Math.PI * 2);
    context.fillStyle = "#1f2937";
    context.fill();
  }

  function drawFreehandLine(from: Point, to: Point) {
    const context = writerCanvasRef.current?.getContext("2d");
    if (!context) return;
    context.beginPath();
    context.moveTo(from.x, from.y);
    context.lineTo(to.x, to.y);
    context.stroke();
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
          <button className="button full-width" type="button" onClick={replayCurrentGame}>
            Chơi lại
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
          <h2>Bộ lọc dữ liệu</h2>
          <div className="game-filter-row">
            <label>
              <span>Bài</span>
              <select value={lessonFilter} onChange={(event) => setLessonFilter(event.target.value === "all" ? "all" : Number(event.target.value))}>
                <option value="all">Tất cả</option>
                {lessonOptions.map((lessonNo) => (
                  <option value={lessonNo} key={lessonNo}>Bài {lessonNo}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Mức độ</span>
              <select value={difficultyFilter} onChange={(event) => setDifficultyFilter(event.target.value as DifficultyFilter)}>
                <option value="all">Tất cả</option>
                {difficultyOptions.map((option) => (
                  <option value={option.value} key={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span>Loại</span>
              <select value="word" disabled aria-label="Game chỉ dùng từ vựng">
                <option value="word">Từ vựng</option>
              </select>
            </label>
          </div>
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
          <div className="write-card-head">
            <div className="game-card-label">Nhìn nghĩa, viết đúng từng chữ Hán</div>
            <button className={showWritePinyin ? "toggle-mini active" : "toggle-mini"} type="button" onClick={() => setShowWritePinyin((current) => !current)}>
              {showWritePinyin ? "Ẩn Pinyin" : "Hiện Pinyin"}
            </button>
          </div>
          <div className="write-meaning">{currentQuestion.item.meaning}</div>
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
              <button className={showStrokeGuide ? "ghost-button hint-button active" : "ghost-button hint-button"} type="button" onClick={toggleStrokeGuide}>
                {showStrokeGuide ? "Ẩn gợi ý nét" : "Hiện gợi ý nét"}
              </button>
            </div>
            <div className="writer-target">
              <div className="writer-outline" ref={writerTargetRef} />
              <canvas
                aria-label="Khung viết Hán tự"
                className="writer-canvas"
                ref={writerCanvasRef}
                onContextMenu={(event) => event.preventDefault()}
                onPointerDown={beginFreehandStroke}
                onPointerMove={moveFreehandStroke}
                onPointerUp={endFreehandStroke}
                onPointerCancel={endFreehandStroke}
                onPointerLeave={endFreehandStroke}
              />
            </div>
            <div className="writer-actions">
              <button className="ghost-button rewrite-button" type="button" onClick={() => clearFreehandCanvas()} aria-label="Xóa nét và viết lại">
                ↻
              </button>
              <button className="button writer-check-button" type="button" onClick={checkWrittenChar} disabled={writeStatus === "loading" || writeStatus === "error"}>
                Kiểm tra
              </button>
            </div>
            {writeFeedback ? <div className={`game-feedback ${writeStatus === "wrong" || writeStatus === "error" ? "wrong" : "correct"}`}>{writeFeedback}</div> : null}
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

        {writeAnswered ? (
          <button className="button full-width" type="button" onClick={goNext}>
            {questionIndex + 1 >= questions.length ? "Xem kết quả" : "Câu tiếp theo"}
          </button>
        ) : null}
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

function ResultStat({ label, value, tone }: { label: string; value: number; tone?: "good" | "bad" }) {
  return (
    <div className={`game-result-stat ${tone || ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function fetchGameCandidates(ownerId: string, lessonFilter: LessonFilter, difficultyFilter: DifficultyFilter) {
  const supabase = createClient();
  const candidates: StudyItem[] = [];
  let offset = 0;

  while (true) {
    let query = supabase
      .from("items")
      .select(itemColumns)
      .eq("user_id", ownerId)
      .eq("type", "word")
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

    const { data, error } = await query;
    if (error) throw error;

    const page = Array.isArray(data) ? (data as StudyItem[]) : [];
    candidates.push(...page);

    if (page.length < candidatePageSize) break;
    offset += candidatePageSize;
  }

  return candidates;
}

async function fetchGameLessonNumbers(ownerId: string) {
  const supabase = createClient();
  const rows: Array<{ lesson_no: number; type: "word" }> = [];

  for (let offset = 0; ; offset += candidatePageSize) {
    const { data, error } = await supabase
      .from("items")
      .select("lesson_no,type")
      .eq("user_id", ownerId)
      .eq("type", "word")
      .order("lesson_no", { ascending: false })
      .range(offset, offset + candidatePageSize - 1);

    if (error) throw error;
    const page = (data || []) as Array<{ lesson_no: number; type: "word" }>;
    rows.push(...page);
    if (page.length < candidatePageSize) break;
  }

  return lessonNumbersFromRows(rows).reverse();
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
  return uniqueStudyItems(items);
}

function isUsableWord(item: StudyItem, mode: GameMode) {
  if (item.type !== "word") return false;
  if (!collectChineseChars(item.hanzi).length) return false;
  if (mode === "choice") return Boolean(item.pinyin?.trim() && item.meaning?.trim());
  return Boolean(item.meaning?.trim());
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

function scoreFreehandWriting(userStrokes: Point[][], targetStrokes: Point[][]) {
  if (!userStrokes.length || !targetStrokes.length) return { score: Number.POSITIVE_INFINITY, coverage: 0, missingStrokeCount: Number.POSITIVE_INFINITY };

  const normalizedUserStrokes = normalizePointGroups(userStrokes);
  const normalizedTargetStrokes = normalizePointGroups(targetStrokes.map(toCanvasStroke));
  const userStrokePointGroups = normalizedUserStrokes.map((stroke) => densifyPointStrokes([stroke], 0.025));
  const targetStrokePointGroups = normalizedTargetStrokes.map((stroke) => densifyPointStrokes([stroke], 0.025));
  const userPoints = userStrokePointGroups.flat();
  const targetPoints = targetStrokePointGroups.flat();
  if (userPoints.length < 8 || targetPoints.length < 8) return { score: Number.POSITIVE_INFINITY, coverage: 0, missingStrokeCount: Number.POSITIVE_INFINITY };

  const userToTarget = averageNearestDistance(userPoints, targetPoints);
  const targetToUser = averageNearestDistance(targetPoints, userPoints);
  const strokeCountPenalty = Math.min(
    0.14,
    Math.max(0, targetStrokes.length - userStrokes.length) * 0.025 + Math.max(0, userStrokes.length - targetStrokes.length) * 0.012
  );
  const coverage = pointCoverage(targetPoints, userPoints, handwritingPointCoverageRadius);
  const missingStrokeCount = targetStrokePointGroups.filter(
    (strokePoints) => !hasCoveredTargetStroke(strokePoints, userPoints, userStrokePointGroups, handwritingPointCoverageRadius)
  ).length;

  return {
    score: userToTarget * 0.55 + targetToUser * 0.45 + strokeCountPenalty,
    coverage,
    missingStrokeCount
  };
}

function isFreehandWritingAccepted(result: { score: number; coverage: number; missingStrokeCount: number }) {
  if (!Number.isFinite(result.score)) return false;
  if (result.missingStrokeCount !== 0) return false;

  return result.coverage >= handwritingCoverageThreshold || result.score <= handwritingMatchThreshold;
}

function hasCoveredTargetStroke(requiredStroke: Point[], userPoints: Point[], userStrokes: Point[][], radius: number) {
  const totalCoverage = pointCoverage(requiredStroke, userPoints, radius * 1.1);
  if (totalCoverage >= handwritingStrokeCoverageThreshold) return true;

  return hasMatchingStroke(requiredStroke, userStrokes, radius);
}

function hasMatchingStroke(requiredStroke: Point[], drawnStrokes: Point[][], radius: number) {
  return drawnStrokes.some((drawnStroke) => {
    const requiredCoverage = pointCoverage(requiredStroke, drawnStroke, radius);
    const drawnCoverage = pointCoverage(drawnStroke, requiredStroke, radius * 1.15);
    return requiredCoverage >= handwritingStrokeCoverageThreshold && drawnCoverage >= handwritingStrokeReverseCoverageThreshold;
  });
}

function toCanvasStroke(stroke: Point[]) {
  return stroke.map(toCanvasPoint);
}

function toCanvasPoint(point: Point) {
  const padding = 12;
  const charMin = { x: 0, y: -124 };
  const charMax = { x: 1024, y: 900 };
  const availableWidth = writerSize - padding * 2;
  const availableHeight = writerSize - padding * 2;
  const scale = Math.min(availableWidth / (charMax.x - charMin.x), availableHeight / (charMax.y - charMin.y));
  const xOffset = -charMin.x * scale + padding + (availableWidth - scale * (charMax.x - charMin.x)) / 2;
  const yOffset = -charMin.y * scale + padding + (availableHeight - scale * (charMax.y - charMin.y)) / 2;

  return {
    x: point.x * scale + xOffset,
    y: writerSize - yOffset - point.y * scale
  };
}

function densifyPointStrokes(strokes: Point[][], spacing: number) {
  const result: Point[] = [];

  strokes.forEach((stroke) => {
    if (!stroke.length) return;
    result.push(stroke[0]);

    for (let index = 1; index < stroke.length; index += 1) {
      const start = stroke[index - 1];
      const end = stroke[index];
      const distance = pointDistance(start, end);
      const steps = Math.max(1, Math.ceil(distance / spacing));

      for (let step = 1; step <= steps; step += 1) {
        const ratio = step / steps;
        result.push({
          x: start.x + (end.x - start.x) * ratio,
          y: start.y + (end.y - start.y) * ratio
        });
      }
    }
  });

  return result;
}

function normalizePointGroups(strokes: Point[][]) {
  const points = strokes.flat();
  if (!points.length) return [];

  const bounds = getPointBounds(points);
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  const scale = Math.max(width, height, 1);
  const xPadding = (scale - width) / 2;
  const yPadding = (scale - height) / 2;

  return strokes.map((stroke) =>
    stroke.map((point) => ({
      x: (point.x - bounds.minX + xPadding) / scale,
      y: (point.y - bounds.minY + yPadding) / scale
    }))
  );
}

function getPointBounds(points: Point[]) {
  return points.reduce(
    (current, point) => ({
      minX: Math.min(current.minX, point.x),
      minY: Math.min(current.minY, point.y),
      maxX: Math.max(current.maxX, point.x),
      maxY: Math.max(current.maxY, point.y)
    }),
    { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY }
  );
}

function averageNearestDistance(fromPoints: Point[], toPoints: Point[]) {
  const total = fromPoints.reduce((sum, point) => {
    let best = Number.POSITIVE_INFINITY;

    for (const candidate of toPoints) {
      const distance = pointDistance(point, candidate);
      if (distance < best) best = distance;
    }

    return sum + best;
  }, 0);

  return total / fromPoints.length;
}

function pointCoverage(requiredPoints: Point[], drawnPoints: Point[], radius: number) {
  if (!requiredPoints.length || !drawnPoints.length) return 0;

  const coveredCount = requiredPoints.reduce((count, point) => {
    for (const candidate of drawnPoints) {
      if (pointDistance(point, candidate) <= radius) return count + 1;
    }

    return count;
  }, 0);

  return coveredCount / requiredPoints.length;
}

function pointDistance(left: Point, right: Point) {
  return Math.hypot(left.x - right.x, left.y - right.y);
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function isChineseChar(char: string) {
  return /[\u3400-\u9fff\uf900-\ufaff]/.test(char);
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import {
  examManualPlaceholder,
  examQuestionColumns,
  extraExamSections,
  isExamAnswerCorrect,
  isSharedListeningSection,
  labelExamSection,
  labelExamType,
  listenLimitForSection,
  mainExamSections,
  parseExamQuestionText,
  shuffleExamItems,
  type ExamFormSection,
  type ExamQuestion,
  type ExamQuestionDraft
} from "@/lib/exam";
import { getBrowserOwnerId } from "@/lib/shared-access";
import "./exam.css";

type ExamView = "practice" | "library";
type ExamStatus = "loading" | "ready" | "error";

type AttemptQuestion = {
  instanceId: string;
  question: ExamQuestion;
  userAnswer: string;
  correct?: boolean;
};

type AttemptSection = {
  form: ExamFormSection;
  questions: AttemptQuestion[];
};

type ListeningGroup = {
  key: string;
  audioText: string | null;
  questions: AttemptQuestion[];
};

type ExamStats = {
  total: number;
  scored: number;
  extra: number;
};

const emptyStats: ExamStats = {
  total: 0,
  scored: 0,
  extra: 0
};
const preferredVoiceKey = "hanngu-preferred-chinese-voice";

export default function ExamClient() {
  const [view, setView] = useState<ExamView>("practice");
  const [status, setStatus] = useState<ExamStatus>("loading");
  const [errorText, setErrorText] = useState("");
  const [questions, setQuestions] = useState<ExamQuestion[]>([]);
  const [stats, setStats] = useState<ExamStats>(emptyStats);
  const [attempt, setAttempt] = useState<AttemptSection[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [listenCounts, setListenCounts] = useState<Record<string, number>>({});
  const [examWarnings, setExamWarnings] = useState<string[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualItems, setManualItems] = useState<ExamQuestionDraft[]>([]);
  const [manualError, setManualError] = useState("");
  const [manualSaving, setManualSaving] = useState(false);

  const validManualCount = useMemo(() => manualItems.filter((item) => !item.validationErrors.length).length, [manualItems]);
  const invalidManualCount = manualItems.length - validManualCount;
  const scoredQuestions = attempt.flatMap((section) => section.questions).filter((item) => item.question.scored);
  const correctScoredCount = scoredQuestions.filter((item) => item.correct === true).length;
  const score10 = scoredQuestions.length ? Math.round((correctScoredCount / scoredQuestions.length) * 10 * 10) / 10 : 0;

  useEffect(() => {
    loadQuestions();
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

  async function loadQuestions() {
    setStatus("loading");
    setErrorText("");

    try {
      const loaded = await loadAllExamQuestions();
      setQuestions(loaded);
      setStats({
        total: loaded.length,
        scored: loaded.filter((question) => question.scored).length,
        extra: loaded.filter((question) => !question.scored).length
      });
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setErrorText(error instanceof Error ? error.message : "Không tải được thư viện câu hỏi thi.");
    }
  }

  async function loadAllExamQuestions() {
    const supabase = createClient();
    const ownerId = getBrowserOwnerId();
    const pageSize = 1000;
    const rows: ExamQuestion[] = [];

    for (let offset = 0; ; offset += pageSize) {
      const { data, error } = await supabase
        .from("exam_questions")
        .select(examQuestionColumns)
        .eq("user_id", ownerId)
        .order("created_at", { ascending: false })
        .range(offset, offset + pageSize - 1);

      if (error) throw error;
      rows.push(...((data || []) as ExamQuestion[]));
      if (!data || data.length < pageSize) return rows;
    }
  }

  function createExam() {
    const nextWarnings: string[] = [];
    const nextAttempt: AttemptSection[] = [];

    mainExamSections.forEach((form) => {
      const candidates = questions.filter((question) => question.section === form.id);
      const selected = shuffleExamItems(candidates).slice(0, form.count);

      if (selected.length < form.count) {
        nextWarnings.push(`${form.subtitle}: cần ${form.count}, hiện có ${selected.length}.`);
      }

      if (selected.length) {
        nextAttempt.push({
          form,
          questions: selected.map((question, index) => ({
            instanceId: `${form.id}-${question.id}-${index}`,
            question,
            userAnswer: ""
          }))
        });
      }
    });

    extraExamSections.forEach((form) => {
      const selected = shuffleExamItems(questions.filter((question) => question.section === form.id)).slice(0, form.count);
      if (selected.length) {
        nextAttempt.push({
          form,
          questions: selected.map((question, index) => ({
            instanceId: `${form.id}-${question.id}-${index}`,
            question,
            userAnswer: ""
          }))
        });
      }
    });

    if (!nextAttempt.length) {
      alert("Chưa có câu hỏi thi để tạo đề. Hãy thêm câu hỏi vào thư viện câu hỏi thi trước.");
      return;
    }

    setAttempt(nextAttempt);
    setSubmitted(false);
    setListenCounts({});
    setExamWarnings(nextWarnings);
    setView("practice");
  }

  function updateAnswer(instanceId: string, answer: string) {
    if (submitted) return;

    setAttempt((current) =>
      current.map((section) => ({
        ...section,
        questions: section.questions.map((item) => (item.instanceId === instanceId ? { ...item, userAnswer: answer } : item))
      }))
    );
  }

  function submitExam() {
    setAttempt((current) =>
      current.map((section) => ({
        ...section,
        questions: section.questions.map((item) => {
          if (!item.question.scored && !item.userAnswer.trim()) return { ...item, correct: undefined };
          return {
            ...item,
            correct: isExamAnswerCorrect(item.userAnswer, item.question.answer, item.question.type)
          };
        })
      }))
    );
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetExam() {
    setAttempt([]);
    setSubmitted(false);
    setListenCounts({});
    setExamWarnings([]);
  }

  async function listenToAudio(groupKey: string, audioText: string | null, sectionId: string) {
    if (!audioText?.trim()) {
      alert("Câu này chưa có audio_text để đọc.");
      return;
    }

    const limit = listenLimitForSection(sectionId);
    const used = listenCounts[groupKey] || 0;

    if (!submitted && used >= limit) {
      alert(`Phần này chỉ được nghe ${limit} lần.`);
      return;
    }

    if (!submitted) {
      setListenCounts((current) => ({ ...current, [groupKey]: used + 1 }));
    }

    await speakExamText(audioText, sectionId);
  }

  function previewManualText() {
    const parsed = parseExamQuestionText(manualText);

    if (parsed.error) {
      setManualItems([]);
      setManualError(parsed.error);
      return;
    }

    setManualItems(parsed.items);
    setManualError("");
  }

  async function saveManualQuestions() {
    const rows = manualItems
      .filter((item) => !item.validationErrors.length)
      .map((item) => ({
        user_id: getBrowserOwnerId(),
        group_id: item.group_id,
        section: item.section,
        type: item.type,
        question: item.question,
        prompt: item.prompt,
        option_a: item.option_a,
        option_b: item.option_b,
        option_c: item.option_c,
        option_d: item.option_d,
        answer: item.answer,
        audio_text: item.audio_text,
        hanzi: item.hanzi,
        pinyin: item.pinyin,
        meaning: item.meaning,
        explanation: item.explanation,
        difficulty: item.difficulty,
        tags: item.tags,
        scored: item.scored
      }));

    if (!rows.length) {
      setManualError("Chưa có câu hỏi hợp lệ để lưu.");
      return;
    }

    setManualSaving(true);
    setManualError("");

    try {
      const supabase = createClient();
      const { error } = await supabase.from("exam_questions").insert(rows);
      if (error) throw error;

      setManualOpen(false);
      setManualText("");
      setManualItems([]);
      await loadQuestions();
      setView("library");
    } catch (error) {
      setManualError(error instanceof Error ? `Không lưu được câu hỏi thi: ${error.message}` : "Không lưu được câu hỏi thi.");
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <section className="exam-page">
      <div className="exam-head">
        <div>
          <h1 className="page-title">Ôn thi</h1>
          <p className="page-subtitle">Tạo đề theo form mẫu và quản lý thư viện câu hỏi thi.</p>
        </div>
        <button className="button" type="button" onClick={() => setManualOpen(true)}>
          Thêm câu hỏi
        </button>
      </div>

      <div className="exam-view-tabs">
        <button className={view === "practice" ? "exam-view-tab active" : "exam-view-tab"} type="button" onClick={() => setView("practice")}>
          Ôn thi
        </button>
        <button className={view === "library" ? "exam-view-tab active" : "exam-view-tab"} type="button" onClick={() => setView("library")}>
          Thư viện câu hỏi
        </button>
      </div>

      {status === "error" ? (
        <div className="card exam-error">
          <strong>Không tải được dữ liệu ôn thi</strong>
          <p>{errorText}</p>
        </div>
      ) : null}

      {manualOpen ? (
        <section className="card exam-manual-card">
          <header className="exam-manual-head">
            <div>
              <h2>Thêm câu hỏi thi</h2>
              <p>Dán dữ liệu theo mẫu ***, app tự chia phần chính và phần luyện thêm.</p>
            </div>
            <button className="ghost-button" type="button" onClick={() => setManualOpen(false)}>
              Đóng
            </button>
          </header>

          <textarea
            className="textarea exam-manual-textarea"
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder={examManualPlaceholder}
          />

          <div className="exam-manual-actions">
            <button className="button" type="button" onClick={previewManualText}>
              Kiểm tra dữ liệu
            </button>
            {manualItems.length ? (
              <button className="success-button" type="button" onClick={saveManualQuestions} disabled={!validManualCount || manualSaving}>
                {manualSaving ? "Đang lưu..." : `Lưu ${validManualCount} câu`}
              </button>
            ) : null}
          </div>

          {manualError ? <p className="manual-error">{manualError}</p> : null}

          {manualItems.length ? (
            <div className="exam-manual-summary">
              <span>
                Đã tách <strong>{manualItems.length}</strong>
              </span>
              <span>
                Hợp lệ <strong>{validManualCount}</strong>
              </span>
              <span>
                Lỗi <strong>{invalidManualCount}</strong>
              </span>
              <span>
                Luyện thêm <strong>{manualItems.filter((item) => !item.scored).length}</strong>
              </span>
            </div>
          ) : null}

          {manualItems.length ? (
            <div className="exam-preview-stack">
              {manualItems.map((item, index) => (
                <article className={item.validationErrors.length ? "exam-question-card invalid-item" : "exam-question-card"} key={`${item.section}-${item.question}-${index}`}>
                  <div className="exam-question-meta">
                    <span>{labelExamSection(item.section)}</span>
                    <span>{labelExamType(item.type)}</span>
                    <span>{item.scored ? "Tính điểm" : "Luyện thêm"}</span>
                    {item.group_id ? <span>Nhóm nghe: {item.group_id}</span> : null}
                  </div>
                  <strong>{item.question}</strong>
                  {item.prompt ? <p>{item.prompt}</p> : null}
                  <small>Đáp án: {item.answer}</small>
                  {item.validationErrors.length ? (
                    <div className="validation-box">
                      {item.validationErrors.map((message) => (
                        <p key={message}>{message}</p>
                      ))}
                    </div>
                  ) : null}
                </article>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {view === "practice" ? (
        <PracticeView
          status={status}
          stats={stats}
          attempt={attempt}
          submitted={submitted}
          warnings={examWarnings}
          score10={score10}
          correctCount={correctScoredCount}
          totalCount={scoredQuestions.length}
          listenCounts={listenCounts}
          onCreateExam={createExam}
          onResetExam={resetExam}
          onUpdateAnswer={updateAnswer}
          onSubmitExam={submitExam}
          onListenAudio={listenToAudio}
        />
      ) : (
        <QuestionLibraryView questions={questions} stats={stats} loading={status === "loading"} onRefresh={loadQuestions} />
      )}
    </section>
  );
}

function PracticeView({
  status,
  stats,
  attempt,
  submitted,
  warnings,
  score10,
  correctCount,
  totalCount,
  listenCounts,
  onCreateExam,
  onResetExam,
  onUpdateAnswer,
  onSubmitExam,
  onListenAudio
}: {
  status: ExamStatus;
  stats: ExamStats;
  attempt: AttemptSection[];
  submitted: boolean;
  warnings: string[];
  score10: number;
  correctCount: number;
  totalCount: number;
  listenCounts: Record<string, number>;
  onCreateExam: () => void;
  onResetExam: () => void;
  onUpdateAnswer: (instanceId: string, answer: string) => void;
  onSubmitExam: () => void;
  onListenAudio: (groupKey: string, audioText: string | null, sectionId: string) => void;
}) {
  const hasAttempt = attempt.length > 0;

  return (
    <div className="exam-practice">
      <section className="card exam-create-card">
        <div>
          <h2>Tạo đề ôn thi</h2>
          <p>Đề sẽ lấy câu hỏi theo form mẫu. Phần luyện thêm nằm cuối đề và không tính điểm.</p>
        </div>
        <div className="exam-create-actions">
          <button className="button" type="button" onClick={onCreateExam} disabled={status === "loading" || !stats.total}>
            Tạo đề thi
          </button>
          {hasAttempt ? (
            <button className="ghost-button" type="button" onClick={onResetExam}>
              Xóa đề hiện tại
            </button>
          ) : null}
        </div>
      </section>

      {warnings.length ? (
        <div className="exam-warning">
          <strong>Thiếu câu ở một số phần</strong>
          {warnings.map((warning) => (
            <p key={warning}>{warning}</p>
          ))}
        </div>
      ) : null}

      {submitted ? (
        <section className="card exam-score-card">
          <span>Điểm</span>
          <strong>{score10}/10</strong>
          <p>
            Đúng {correctCount}/{totalCount} câu tính điểm. Phần luyện thêm không cộng điểm.
          </p>
        </section>
      ) : null}

      {hasAttempt ? (
        <div className="exam-section-stack">
          {attempt.map((section) => (
            <section className="card exam-section-card" key={section.form.id}>
              <header className="exam-section-head">
                <div>
                  <h2>{section.form.title}</h2>
                  <p>{section.form.subtitle}</p>
                </div>
                <span>{section.form.scored ? "Tính điểm" : "Luyện thêm"}</span>
              </header>

              <div className="exam-question-stack">
                {withQuestionStartIndexes(groupAttemptQuestions(section)).map(({ group, startIndex }) => (
                  <ListeningGroupBlock
                    group={group}
                    startIndex={startIndex}
                    sectionId={section.form.id}
                    submitted={submitted}
                    listenCounts={listenCounts}
                    onListenAudio={onListenAudio}
                    onUpdateAnswer={onUpdateAnswer}
                    key={group.key}
                  />
                ))}
              </div>
            </section>
          ))}

          {!submitted ? (
            <button className="success-button full-width exam-submit-button" type="button" onClick={onSubmitExam}>
              Nộp bài và xem đáp án
            </button>
          ) : null}
        </div>
      ) : (
        <div className="empty-state">
          <div>
            <div className="empty-icon">考</div>
            <h2>Chưa có đề ôn thi</h2>
            <p className="muted">Thêm câu hỏi vào thư viện rồi bấm Tạo đề thi.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function QuestionLibraryView({ questions, stats, loading, onRefresh }: { questions: ExamQuestion[]; stats: ExamStats; loading: boolean; onRefresh: () => void }) {
  const visibleQuestions = questions.slice(0, 200);

  return (
    <div className="exam-library">
      <div className="stats-grid">
        <StatCard label="Tổng" value={stats.total} />
        <StatCard label="Tính điểm" value={stats.scored} />
        <StatCard label="Luyện thêm" value={stats.extra} />
        <StatCard label="Hiển thị" value={visibleQuestions.length} />
      </div>

      <button className="ghost-button full-width" type="button" onClick={onRefresh} disabled={loading}>
        {loading ? "Đang tải..." : "Tải lại thư viện câu hỏi"}
      </button>

      <div className="exam-library-stack">
        {visibleQuestions.length ? (
          visibleQuestions.map((question) => (
            <article className="card exam-library-card" key={question.id}>
              <div className="exam-question-meta">
                <span>{labelExamSection(question.section)}</span>
                <span>{labelExamType(question.type)}</span>
                <span>{question.scored ? "Tính điểm" : "Luyện thêm"}</span>
                {question.group_id ? <span>Nhóm nghe: {question.group_id}</span> : null}
              </div>
              <strong>{question.question}</strong>
              {question.prompt ? <p>{question.prompt}</p> : null}
              <small>Đáp án: {question.answer}</small>
              {question.hanzi ? <div className="exam-hanzi-preview">{question.hanzi}</div> : null}
            </article>
          ))
        ) : (
          <div className="empty-state">
            <div>
              <div className="empty-icon">题</div>
              <h2>Chưa có câu hỏi thi</h2>
              <p className="muted">Bấm Thêm câu hỏi để upload dữ liệu theo cú pháp ***.</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ListeningGroupBlock({
  group,
  startIndex,
  sectionId,
  submitted,
  listenCounts,
  onListenAudio,
  onUpdateAnswer
}: {
  group: ListeningGroup;
  startIndex: number;
  sectionId: string;
  submitted: boolean;
  listenCounts: Record<string, number>;
  onListenAudio: (groupKey: string, audioText: string | null, sectionId: string) => void;
  onUpdateAnswer: (instanceId: string, answer: string) => void;
}) {
  const showGroupControl = group.questions.length > 1 || isSharedListeningSection(sectionId);

  return (
    <div className={showGroupControl ? "exam-listening-group" : "exam-listening-single"}>
      {showGroupControl ? (
        <AudioListenControl
          groupKey={group.key}
          audioText={group.audioText}
          sectionId={sectionId}
          submitted={submitted}
          listenCounts={listenCounts}
          label="Nghe đoạn"
          onListenAudio={onListenAudio}
        />
      ) : null}

      {group.questions.map((item, index) => (
        <ExamQuestionCard
          item={item}
          index={startIndex + index}
          submitted={submitted}
          showAudioControl={!showGroupControl}
          listenCounts={listenCounts}
          onListenAudio={onListenAudio}
          onUpdateAnswer={(answer) => onUpdateAnswer(item.instanceId, answer)}
          key={item.instanceId}
        />
      ))}
    </div>
  );
}

function ExamQuestionCard({
  item,
  index,
  submitted,
  showAudioControl,
  listenCounts,
  onListenAudio,
  onUpdateAnswer
}: {
  item: AttemptQuestion;
  index: number;
  submitted: boolean;
  showAudioControl: boolean;
  listenCounts: Record<string, number>;
  onListenAudio: (groupKey: string, audioText: string | null, sectionId: string) => void;
  onUpdateAnswer: (answer: string) => void;
}) {
  const question = item.question;
  const groupKey = audioGroupKey(question, item.instanceId);

  return (
    <article className={submitted ? resultClassName(item) : "exam-question"}>
      <div className="exam-question-title">
        <span>Câu {index + 1}</span>
        {!question.scored ? <em>Luyện thêm</em> : null}
      </div>
      {showAudioControl ? (
        <AudioListenControl
          groupKey={groupKey}
          audioText={question.audio_text}
          sectionId={question.section}
          submitted={submitted}
          listenCounts={listenCounts}
          label="Nghe"
          onListenAudio={onListenAudio}
        />
      ) : null}
      <strong>{displayQuestionText(question, submitted)}</strong>
      {question.prompt ? <p className="exam-prompt">{question.prompt}</p> : null}
      {renderAnswerInput(question, item.userAnswer, submitted, onUpdateAnswer)}
      {submitted ? <OfficialAnswer item={item} /> : null}
    </article>
  );
}

function AudioListenControl({
  groupKey,
  audioText,
  sectionId,
  submitted,
  listenCounts,
  label,
  onListenAudio
}: {
  groupKey: string;
  audioText: string | null;
  sectionId: string;
  submitted: boolean;
  listenCounts: Record<string, number>;
  label: string;
  onListenAudio: (groupKey: string, audioText: string | null, sectionId: string) => void;
}) {
  const limit = listenLimitForSection(sectionId);
  const used = listenCounts[groupKey] || 0;
  const remaining = Math.max(limit - used, 0);
  const disabled = !submitted && (!audioText || remaining <= 0);

  return (
    <div className="exam-audio-control">
      <button className="exam-listen-button" type="button" disabled={disabled} onClick={() => onListenAudio(groupKey, audioText, sectionId)}>
        🔊 {submitted ? "Nghe lại" : `${label} ${remaining}/${limit}`}
      </button>
      <span>{audioText ? (submitted ? "Đã mở đáp án" : "Nội dung nghe đang ẩn") : "Thiếu audio_text"}</span>
    </div>
  );
}

function groupAttemptQuestions(section: AttemptSection): ListeningGroup[] {
  const groups = new Map<string, ListeningGroup>();

  section.questions.forEach((item) => {
    const key = audioGroupKey(item.question, item.instanceId);
    const current = groups.get(key);

    if (current) {
      current.questions.push(item);
      return;
    }

    groups.set(key, {
      key,
      audioText: item.question.audio_text,
      questions: [item]
    });
  });

  return Array.from(groups.values());
}

function withQuestionStartIndexes(groups: ListeningGroup[]) {
  let startIndex = 0;

  return groups.map((group) => {
    const current = { group, startIndex };
    startIndex += group.questions.length;
    return current;
  });
}

function audioGroupKey(question: ExamQuestion, fallbackKey: string) {
  if (question.group_id) return `group:${question.group_id}`;
  if (isSharedListeningSection(question.section) && question.audio_text) return `audio:${stableHash(question.audio_text)}`;
  return `item:${fallbackKey}`;
}

function stableHash(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

function displayQuestionText(question: ExamQuestion, submitted: boolean) {
  if (!submitted && question.section === "p2_4_dialogue_choice") return "Nghe hội thoại rồi chọn đáp án đúng.";
  return question.question;
}

function resultClassName(item: AttemptQuestion) {
  if (item.correct === true) return "exam-question correct";
  if (item.correct === false) return "exam-question wrong";
  return "exam-question skipped";
}

function renderAnswerInput(question: ExamQuestion, answer: string, disabled: boolean, onUpdateAnswer: (answer: string) => void) {
  if (question.type === "choice_ab" || question.type === "choice_abcd") {
    const options = [
      ["A", question.option_a],
      ["B", question.option_b],
      ["C", question.option_c],
      ["D", question.option_d]
    ].filter(([, value]) => Boolean(value));

    return (
      <div className="exam-options">
        {options.map(([letter, value]) => (
          <button className={answer === letter ? "exam-option active" : "exam-option"} type="button" disabled={disabled} onClick={() => onUpdateAnswer(letter || "")} key={letter}>
            <span>{letter}</span>
            <strong>{value}</strong>
          </button>
        ))}
      </div>
    );
  }

  if (question.type === "true_false") {
    return (
      <div className="exam-true-false">
        <button className={answer === "true" ? "exam-option active" : "exam-option"} type="button" disabled={disabled} onClick={() => onUpdateAnswer("true")}>
          Đúng
        </button>
        <button className={answer === "false" ? "exam-option active" : "exam-option"} type="button" disabled={disabled} onClick={() => onUpdateAnswer("false")}>
          Sai
        </button>
      </div>
    );
  }

  return (
    <textarea
      className="textarea exam-answer-textarea"
      value={answer}
      disabled={disabled}
      onChange={(event) => onUpdateAnswer(event.target.value)}
      placeholder={question.type === "tone_mark" ? "Nhập pinyin có dấu..." : "Nhập đáp án..."}
    />
  );
}

function OfficialAnswer({ item }: { item: AttemptQuestion }) {
  const question = item.question;

  return (
    <div className="official-answer">
      <strong>{item.correct === undefined ? "Bỏ qua" : item.correct ? "Đúng" : "Chưa đúng"}</strong>
      <p>Đáp án: {question.answer}</p>
      {question.audio_text ? <p>Nội dung nghe: {question.audio_text}</p> : null}
      {question.hanzi ? <p className="official-hanzi">{question.hanzi}</p> : null}
      {question.pinyin ? <p className="official-pinyin">{question.pinyin}</p> : null}
      {question.meaning ? <p>{question.meaning}</p> : null}
      {question.explanation ? <small>{question.explanation}</small> : null}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

async function speakExamText(text: string, sectionId: string) {
  if (!("speechSynthesis" in window)) {
    alert("Trình duyệt này không hỗ trợ đọc phát âm.");
    return;
  }

  const synth = window.speechSynthesis;
  const speechText = prepareExamSpeechText(text);
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

  utterance.rate = speechRateForExamSection(sectionId, speechText);
  utterance.pitch = 1;
  utterance.onerror = (event) => {
    if (event.error !== "interrupted" && event.error !== "canceled") {
      alert("Thiết bị này không tìm thấy giọng đọc tiếng Trung. Hãy thử mở bằng Safari/Chrome mới hoặc bật giọng tiếng Trung trong cài đặt máy.");
    }
  };

  synth.cancel();
  synth.resume();
  synth.speak(utterance);
}

function prepareExamSpeechText(text: string) {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

function speechRateForExamSection(sectionId: string, text: string) {
  if (sectionId === "p1_1_word_sound") return 0.72;
  if (sectionId === "p1_2_sentence_sound" || sectionId === "p1_3_tone_mark") return 0.78;
  if (text.length > 120) return 0.9;
  return 0.84;
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
    // localStorage can be unavailable in private browsing modes.
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

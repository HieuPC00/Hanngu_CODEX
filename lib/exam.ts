export type ExamQuestionType = "choice_ab" | "choice_abcd" | "true_false" | "fill_blank" | "short_answer" | "tone_mark";

export type ExamSectionId =
  | "p1_1_word_sound"
  | "p1_2_sentence_sound"
  | "p1_3_tone_mark"
  | "p2_4_dialogue_choice"
  | "p2_5_dialogue_tf"
  | "p2_5_passage_fill"
  | "p2_5_passage_tf"
  | "p2_5_passage_short"
  | "extra_sentence_stress"
  | "extra_quick_answer"
  | "extra_custom";

export type ExamQuestion = {
  id: string;
  user_id: string;
  group_id: string | null;
  section: ExamSectionId;
  type: ExamQuestionType;
  question: string;
  prompt: string | null;
  option_a: string | null;
  option_b: string | null;
  option_c: string | null;
  option_d: string | null;
  answer: string;
  audio_text: string | null;
  hanzi: string | null;
  pinyin: string | null;
  meaning: string | null;
  explanation: string | null;
  difficulty: "easy" | "hard";
  tags: string | null;
  scored: boolean;
  created_at: string;
};

export type ExamQuestionDraft = Omit<ExamQuestion, "id" | "user_id" | "created_at"> & {
  validationErrors: string[];
  validationWarnings: string[];
};

export type ExamFormSection = {
  id: ExamSectionId;
  title: string;
  subtitle: string;
  count: number;
  scored: boolean;
};

export const mainExamSections: ExamFormSection[] = [
  { id: "p1_1_word_sound", title: "一、选择你听到的词语", subtitle: "Chọn từ bạn nghe được", count: 10, scored: true },
  { id: "p1_2_sentence_sound", title: "二、选择你听到的句子", subtitle: "Chọn câu bạn nghe được", count: 10, scored: true },
  { id: "p1_3_tone_mark", title: "三、听后标出句中词语的声调", subtitle: "Điền thanh điệu", count: 5, scored: true },
  { id: "p2_4_dialogue_choice", title: "四、听对话，选择正确答案", subtitle: "Nghe hội thoại chọn đáp án đúng", count: 10, scored: true },
  { id: "p2_5_dialogue_tf", title: "五、对话判断正误", subtitle: "Hội thoại đúng / sai", count: 4, scored: true },
  { id: "p2_5_passage_fill", title: "六、短文听后填空", subtitle: "Đoạn văn điền từ", count: 3, scored: true },
  { id: "p2_5_passage_tf", title: "七、短文判断正误", subtitle: "Đoạn văn đúng / sai", count: 4, scored: true },
  { id: "p2_5_passage_short", title: "八、回答问题", subtitle: "Trả lời câu hỏi", count: 3, scored: true }
];

export const extraExamSections: ExamFormSection[] = [
  { id: "extra_quick_answer", title: "练习一、快速回答", subtitle: "Luyện thêm trả lời nhanh", count: 4, scored: false },
  { id: "extra_sentence_stress", title: "练习二、句重音", subtitle: "Luyện thêm trọng âm câu", count: 4, scored: false },
  { id: "extra_custom", title: "练习三、补充练习", subtitle: "Luyện thêm khác", count: 4, scored: false }
];

export const examSections = [...mainExamSections, ...extraExamSections];
export const examSectionIds = examSections.map((section) => section.id);

export const examQuestionTypes: ExamQuestionType[] = ["choice_ab", "choice_abcd", "true_false", "fill_blank", "short_answer", "tone_mark"];

export const examQuestionColumns =
  "id,user_id,group_id,section,type,question,prompt,option_a,option_b,option_c,option_d,answer,audio_text,hanzi,pinyin,meaning,explanation,difficulty,tags,scored,created_at";

export const examManualPlaceholder = `***
section: p1_1_word_sound
type: choice_ab
question: 选择你在句中听到的词语
A: fēngfù
B: fènfù
answer: A
audio_text: 这种商品很丰富。
hanzi: 这种商品很丰富。
pinyin: zhè zhǒng shāngpǐn hěn fēngfù.
meaning: Loại hàng này rất phong phú.
explanation: Từ nghe được là fēngfù, tương ứng với đáp án A.
difficulty: easy
tags: ngữ âm, chọn từ nghe được
***
section: p2_5_dialogue_tf
group_id: dialogue_01
type: true_false
question: 他们星期天一起去商店。
answer: false
audio_text: 男: 星期天你去哪儿？女: 我去书店，你呢？男: 我也想去书店。我跟你一起去，好吗？
hanzi: 他们星期天一起去书店。
pinyin: tāmen Xīngqītiān yìqǐ qù shūdiàn.
meaning: Chủ nhật họ cùng đi hiệu sách.
explanation: Đoạn nghe nói họ đi 书店, không phải 商店.
difficulty: easy
tags: nghe hiểu, đúng sai, hội thoại
***
section: extra_quick_answer
type: short_answer
question: 你怎么来学校？
answer: 坐公共汽车 / 走路
audio_text: 你怎么来学校？
hanzi: 你怎么来学校？
pinyin: nǐ zěnme lái xuéxiào?
meaning: Bạn đến trường bằng cách nào?
explanation: Có thể trả lời đi xe buýt hoặc đi bộ.
difficulty: easy
tags: nghe hiểu, trả lời nhanh, luyện thêm`;

export function labelExamSection(sectionId: string) {
  return examSections.find((section) => section.id === sectionId)?.subtitle || sectionId;
}

export function labelExamType(type: string) {
  if (type === "choice_ab") return "Chọn A/B";
  if (type === "choice_abcd") return "Chọn A/B/C/D";
  if (type === "true_false") return "Đúng/Sai";
  if (type === "fill_blank") return "Điền từ";
  if (type === "tone_mark") return "Điền thanh điệu";
  return "Trả lời ngắn";
}

export function isScoredSection(sectionId: string) {
  return sectionId.startsWith("p1_") || sectionId.startsWith("p2_");
}

export function listenLimitForSection(sectionId: string) {
  if (sectionId === "p1_1_word_sound" || sectionId === "p1_2_sentence_sound") return 1;
  if (sectionId === "p1_3_tone_mark" || sectionId === "p2_4_dialogue_choice") return 2;
  return 3;
}

export function isSharedListeningSection(sectionId: string) {
  return sectionId === "p2_5_dialogue_tf" || sectionId.startsWith("p2_5_passage_");
}

export function parseExamQuestionText(text: string): { items: ExamQuestionDraft[]; error?: string } {
  const normalizedText = text.replace(/\r\n/g, "\n").trim();

  if (!normalizedText) return { items: [], error: "Chưa có nội dung để kiểm tra." };
  if (!normalizedText.includes("***")) return { items: [], error: "Thiếu dấu ***. Mỗi câu hỏi cần bắt đầu bằng ***." };

  const [prefix, ...blocks] = normalizedText.split("***");
  if (prefix.trim()) return { items: [], error: "Có nội dung đứng trước dấu *** đầu tiên. Hãy đặt *** trước mỗi câu hỏi." };

  const items = blocks
    .map((block) => parseExamQuestionBlock(block))
    .filter((item): item is ExamQuestionDraft => Boolean(item));

  if (!items.length) return { items: [], error: "Không tìm thấy câu hỏi hợp lệ sau dấu ***." };
  applyExamQuestionSetValidation(items);
  return { items };
}

function parseExamQuestionBlock(block: string): ExamQuestionDraft | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  const fields = new Map<string, string>();

  lines.forEach((line) => {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex === -1) return;

    const key = line.slice(0, separatorIndex).trim().toLowerCase();
    const value = line.slice(separatorIndex + 1).trim();
    if (!key) return;

    fields.set(key, value);
  });

  const section = fields.get("section") || "";
  const type = fields.get("type") || "";
  const difficulty = normalizeExamDifficulty(fields.get("difficulty"));
  const draft: ExamQuestionDraft = {
    group_id: nullableField(fields.get("group_id")),
    section: section as ExamSectionId,
    type: type as ExamQuestionType,
    question: fields.get("question") || "",
    prompt: nullableField(fields.get("prompt")),
    option_a: nullableField(fields.get("a")),
    option_b: nullableField(fields.get("b")),
    option_c: nullableField(fields.get("c")),
    option_d: nullableField(fields.get("d")),
    answer: fields.get("answer") || "",
    audio_text: nullableField(fields.get("audio_text")),
    hanzi: nullableField(fields.get("hanzi")),
    pinyin: nullableField(fields.get("pinyin")),
    meaning: nullableField(fields.get("meaning")),
    explanation: nullableField(fields.get("explanation")),
    difficulty,
    tags: nullableField(fields.get("tags")),
    scored: isScoredSection(section),
    validationErrors: [],
    validationWarnings: []
  };

  draft.validationErrors = validateExamQuestionDraft(draft);
  return draft;
}

function nullableField(value: string | undefined) {
  const trimmed = (value || "").trim();
  return trimmed ? trimmed : null;
}

function normalizeExamDifficulty(value: string | undefined): "easy" | "hard" {
  return value === "hard" ? "hard" : "easy";
}

function validateExamQuestionDraft(item: ExamQuestionDraft) {
  const errors: string[] = [];

  if (!examSectionIds.includes(item.section)) errors.push(`Section không hợp lệ: ${item.section || "(trống)"}.`);
  if (!examQuestionTypes.includes(item.type)) errors.push(`Type không hợp lệ: ${item.type || "(trống)"}.`);
  if (!item.question.trim()) errors.push("Thiếu question.");
  if (!item.answer.trim()) errors.push("Thiếu answer.");
  if (item.type === "choice_ab" && (!item.option_a?.trim() || !item.option_b?.trim())) errors.push("Câu choice_ab cần có A và B.");
  if (item.type === "choice_ab" && item.answer.trim() && !["A", "B"].includes(item.answer.trim().toUpperCase())) {
    errors.push("Câu choice_ab cần answer là A hoặc B.");
  }
  if (item.type === "choice_abcd" && (!item.option_a?.trim() || !item.option_b?.trim() || !item.option_c?.trim() || !item.option_d?.trim())) {
    errors.push("Câu choice_abcd cần có A, B, C, D.");
  }
  if (item.type === "choice_abcd" && item.answer.trim() && !["A", "B", "C", "D"].includes(item.answer.trim().toUpperCase())) {
    errors.push("Câu choice_abcd cần answer là A, B, C hoặc D.");
  }
  if (item.type === "true_false" && !["true", "false", "đúng", "sai", "对", "错"].includes(item.answer.trim().toLowerCase())) {
    errors.push("Câu true_false cần answer là true hoặc false.");
  }

  return errors;
}

function applyExamQuestionSetValidation(items: ExamQuestionDraft[]) {
  const grouped = new Map<string, ExamQuestionDraft[]>();

  items.forEach((item) => {
    item.validationWarnings = validateExamQuestionDraftWarnings(item);

    if (!item.group_id) return;
    const key = `${item.section}:${item.group_id}`;
    grouped.set(key, [...(grouped.get(key) || []), item]);
  });

  grouped.forEach((groupItems) => {
    const audioValues = Array.from(new Set(groupItems.map((item) => item.audio_text?.trim() || "").filter(Boolean)));

    if (audioValues.length > 1) {
      groupItems.forEach((item) => {
        item.validationErrors.push("Cùng section + group_id nhưng audio_text khác nhau. Nhóm nghe phải dùng đúng một audio_text chung.");
      });
    }

    if (groupItems.length > 1 && !isSharedListeningSection(groupItems[0].section) && groupItems[0].section !== "p2_4_dialogue_choice") {
      groupItems.forEach((item) => {
        item.validationWarnings.push("group_id đang dùng ở phần không bắt buộc nghe chung. App vẫn bốc nguyên nhóm, chỉ dùng khi thật sự cần.");
      });
    }
  });
}

function validateExamQuestionDraftWarnings(item: ExamQuestionDraft) {
  const warnings: string[] = [];
  const audioText = item.audio_text?.trim() || "";

  if (!audioText) {
    warnings.push("Thiếu audio_text nên câu này sẽ không có nút nghe.");
  } else if (!hasCjk(audioText)) {
    warnings.push("audio_text có vẻ không có Hán tự. Nên dùng câu Hán tự để giọng đọc tiếng Trung chính xác hơn.");
  }

  if (isSharedListeningSection(item.section) && !item.group_id && audioText) {
    warnings.push("Phần nghe chung chưa có group_id. App sẽ tự nhóm các câu có audio_text giống hệt nhau.");
  }

  if (item.type === "true_false" && item.option_a) warnings.push("true_false không cần A/B/C/D; app chỉ dùng answer true/false.");
  if ((item.type === "fill_blank" || item.type === "short_answer" || item.type === "tone_mark") && (item.option_a || item.option_b || item.option_c || item.option_d)) {
    warnings.push("Loại câu nhập tự do không dùng A/B/C/D; các lựa chọn sẽ bị bỏ qua.");
  }

  return warnings;
}

function hasCjk(value: string) {
  return /[\u3400-\u9fff]/.test(value);
}

export function normalizeExamAnswer(value: string) {
  return value
    .toLowerCase()
    .normalize("NFC")
    .replace(/[。？！?!，,、；;：:\s"'“”‘’《》〈〉（）()]/g, "")
    .trim();
}

export function isExamAnswerCorrect(input: string, answer: string, type: ExamQuestionType) {
  const trimmedInput = input.trim();
  if (!trimmedInput) return false;

  if (type === "choice_ab" || type === "choice_abcd") {
    return normalizeExamAnswer(trimmedInput) === normalizeExamAnswer(answer);
  }

  if (type === "true_false") {
    return normalizeBooleanAnswer(trimmedInput) === normalizeBooleanAnswer(answer);
  }

  return splitAnswerAlternatives(answer).some((alternative) => isTextAlternativeCorrect(trimmedInput, alternative));
}

function normalizeBooleanAnswer(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["true", "đúng", "dung", "对", "✓", "✔"].includes(normalized)) return "true";
  if (["false", "sai", "错", "x", "✗", "✘"].includes(normalized)) return "false";
  return normalized;
}

function splitAnswerAlternatives(answer: string) {
  return answer
    .split("/")
    .map((part) => part.trim())
    .filter(Boolean);
}

function isTextAlternativeCorrect(input: string, alternative: string) {
  const normalizedInput = normalizeExamAnswer(input);
  const normalizedAlternative = normalizeExamAnswer(alternative);

  if (normalizedInput === normalizedAlternative) return true;

  if (alternative.includes(";") || alternative.includes("；")) {
    const expectedParts = alternative
      .split(/[;；]/)
      .map((part) => normalizeExamAnswer(part))
      .filter(Boolean);
    const inputParts = input
      .split(/[;；\n]/)
      .map((part) => normalizeExamAnswer(part))
      .filter(Boolean);

    return expectedParts.length === inputParts.length && expectedParts.every((part, index) => part === inputParts[index]);
  }

  return false;
}

export function shuffleExamItems<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [next[index], next[swapIndex]] = [next[swapIndex], next[index]];
  }
  return next;
}

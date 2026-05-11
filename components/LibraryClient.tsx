"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase-browser";
import { hasChineseInPinyin, hasChineseText, normalizeChineseText } from "@/lib/text-quality";
import type { ExtractedItem, ItemType, StudyItem } from "@/lib/types";

const pageSize = 200;

type LibraryStats = {
  total: number;
  sentence: number;
  word: number;
  dialogue: number;
};

type DuplicateMatch = {
  id?: string;
  source: "library" | "batch";
  type: ItemType;
  hanzi: string;
  pinyin?: string | null;
  meaning?: string | null;
};

type ManualItem = ExtractedItem & {
  duplicateOf?: DuplicateMatch;
  allowDuplicate?: boolean;
  validationErrors: string[];
};

const emptyStats: LibraryStats = {
  total: 0,
  sentence: 0,
  word: 0,
  dialogue: 0
};

const manualPlaceholder = `***
你好
nǐ hǎo
xin chào
***
你最近身体怎么样?
nǐ zuìjìn shēntǐ zěnme yàng?
Dạo này sức khỏe bạn thế nào?
***
医院
yīyuàn
bệnh viện`;

export default function LibraryClient() {
  const [items, setItems] = useState<StudyItem[]>([]);
  const [stats, setStats] = useState<LibraryStats>(emptyStats);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorText, setErrorText] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualText, setManualText] = useState("");
  const [manualItems, setManualItems] = useState<ManualItem[]>([]);
  const [manualError, setManualError] = useState("");
  const [manualExistingItems, setManualExistingItems] = useState<DuplicateMatch[]>([]);
  const [manualSaving, setManualSaving] = useState(false);

  const manualSaveableCount = useMemo(() => manualItems.filter(isSaveableManualItem).length, [manualItems]);

  useEffect(() => {
    loadLibrary();
  }, []);

  async function loadLibrary(options?: { append?: boolean }) {
    const append = Boolean(options?.append);
    const supabase = createClient();
    const offset = append ? items.length : 0;

    if (append) {
      setLoadingMore(true);
    } else {
      setStatus("loading");
      setErrorText("");
    }

    try {
      const [itemResult, statsResult] = await Promise.all([
        supabase
          .from("items")
          .select("id,user_id,document_id,type,hanzi,pinyin,meaning,mastery,shown_count,last_shown_at,last_studied_at,created_at")
          .order("created_at", { ascending: false })
          .range(offset, offset + pageSize - 1),
        loadStats()
      ]);

      if (itemResult.error) throw itemResult.error;

      setStats(statsResult);
      setItems((current) => (append ? [...current, ...((itemResult.data || []) as StudyItem[])] : ((itemResult.data || []) as StudyItem[])));
      setStatus("ready");
    } catch (error) {
      setStatus("error");
      setErrorText(error instanceof Error ? error.message : "Không tải được thư viện từ Supabase.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function loadStats(): Promise<LibraryStats> {
    const supabase = createClient();
    const [total, sentence, word, dialogue] = await Promise.all([
      supabase.from("items").select("id", { count: "exact", head: true }),
      supabase.from("items").select("id", { count: "exact", head: true }).eq("type", "sentence"),
      supabase.from("items").select("id", { count: "exact", head: true }).eq("type", "word"),
      supabase.from("items").select("id", { count: "exact", head: true }).eq("type", "dialogue")
    ]);

    const error = total.error || sentence.error || word.error || dialogue.error;
    if (error) throw error;

    return {
      total: total.count || 0,
      sentence: sentence.count || 0,
      word: word.count || 0,
      dialogue: dialogue.count || 0
    };
  }

  async function openManualForm() {
    setManualOpen(true);
    setManualError("");
  }

  function closeManualForm() {
    setManualOpen(false);
    setManualText("");
    setManualItems([]);
    setManualError("");
    setManualExistingItems([]);
  }

  async function previewManualText() {
    const parsed = parseManualText(manualText);

    if (parsed.error) {
      setManualItems([]);
      setManualError(parsed.error);
      return;
    }

    const existing = await loadExistingItems();
    setManualExistingItems(existing);
    setManualItems(markManualDuplicates(parsed.items, existing));
    setManualError("");
  }

  function updateManualItem(index: number, patch: Partial<ManualItem>) {
    setManualItems((current) =>
      markManualDuplicates(
        current.map((item, itemIndex) => (itemIndex === index ? normalizeManualItem({ ...item, ...patch }) : item)),
        manualExistingItems
      )
    );
  }

  function removeManualItem(index: number) {
    setManualItems((current) => markManualDuplicates(current.filter((_, itemIndex) => itemIndex !== index), manualExistingItems));
  }

  async function saveManualItems() {
    const rows = manualItems.filter(isSaveableManualItem).map((item) => ({
      document_id: null,
      type: item.type,
      hanzi: item.hanzi,
      pinyin: item.pinyin,
      meaning: item.meaning
    }));

    if (!rows.length) {
      setManualError("Chưa có mục hợp lệ để lưu. Mục trùng cần bật 'Vẫn lưu mục này' nếu bạn muốn lưu.");
      return;
    }

    setManualSaving(true);
    setManualError("");

    try {
      const supabase = createClient();
      const { error } = await supabase.from("items").insert(rows);
      if (error) throw error;

      closeManualForm();
      await loadLibrary();
    } catch (error) {
      setManualError(error instanceof Error ? `Không lưu được lên Supabase: ${error.message}` : "Không lưu được lên Supabase.");
    } finally {
      setManualSaving(false);
    }
  }

  return (
    <section>
      <div className="library-head">
        <div>
          <h1 className="page-title">Thư viện</h1>
          <p className="page-subtitle">Toàn bộ dữ liệu học đã lưu trong Supabase.</p>
        </div>
        <button className="button manual-open-button" type="button" onClick={openManualForm}>
          Thêm thủ công
        </button>
      </div>

      <div className="stats-grid">
        <StatCard label="Tổng" value={stats.total} />
        <StatCard label="Câu" value={stats.sentence} />
        <StatCard label="Từ vựng" value={stats.word} />
        <StatCard label="Hội thoại" value={stats.dialogue} />
      </div>

      {manualOpen ? (
        <section className="card manual-card">
          <header className="manual-head">
            <div>
              <h2>Thêm thủ công</h2>
              <p>Mỗi mục bắt đầu bằng ***, sau đó lần lượt là Hán tự, pinyin, nghĩa.</p>
            </div>
            <button className="ghost-button" type="button" onClick={closeManualForm}>
              Đóng
            </button>
          </header>

          <textarea
            className="textarea manual-textarea"
            value={manualText}
            onChange={(event) => setManualText(event.target.value)}
            placeholder={manualPlaceholder}
          />

          <div className="manual-actions">
            <button className="button" type="button" onClick={previewManualText}>
              Kiểm tra dữ liệu
            </button>
            {manualItems.length ? (
              <button className="success-button" type="button" onClick={saveManualItems} disabled={!manualSaveableCount || manualSaving}>
                {manualSaving ? "Đang lưu..." : `Lưu ${manualSaveableCount} mục`}
              </button>
            ) : null}
          </div>

          {manualError ? <p className="manual-error">{manualError}</p> : null}

          {manualItems.length ? (
            <div className="manual-preview">
              {manualItems.map((item, index) => {
                const duplicate = item.duplicateOf;
                const isInvalid = item.validationErrors.length > 0;

                return (
                  <article className={isInvalid ? "manual-preview-item invalid-item" : duplicate ? "manual-preview-item duplicate-item" : "manual-preview-item"} key={`${item.hanzi}-${index}`}>
                    <div className="manual-item-toolbar">
                      <select className="select" value={item.type} onChange={(event) => updateManualItem(index, { type: event.target.value as ItemType })}>
                        <option value="sentence">Câu</option>
                        <option value="dialogue">Hội thoại</option>
                        <option value="word">Từ vựng</option>
                      </select>
                      <button className="danger-button" type="button" onClick={() => removeManualItem(index)}>
                        Xóa
                      </button>
                    </div>

                    {isInvalid ? (
                      <div className="validation-box">
                        {item.validationErrors.map((message) => (
                          <p key={message}>{message}</p>
                        ))}
                      </div>
                    ) : null}

                    {duplicate ? (
                      <div className="duplicate-box">
                        <strong>Trùng với {duplicate.source === "library" ? "mục đã lưu" : "mục trong lần nhập này"}:</strong>
                        <span>{duplicate.hanzi}</span>
                        {duplicate.pinyin ? <em>{duplicate.pinyin}</em> : null}
                        {duplicate.meaning ? <small>{duplicate.meaning}</small> : null}
                        <label className="duplicate-choice">
                          <input type="checkbox" checked={Boolean(item.allowDuplicate)} onChange={(event) => updateManualItem(index, { allowDuplicate: event.target.checked })} />
                          Vẫn lưu mục này
                        </label>
                      </div>
                    ) : null}

                    <textarea className="textarea manual-hanzi-input" value={item.hanzi} onChange={(event) => updateManualItem(index, { hanzi: event.target.value })} />
                    <textarea className="textarea manual-pinyin-input" value={item.pinyin} onChange={(event) => updateManualItem(index, { pinyin: event.target.value })} />
                    <textarea className="textarea" value={item.meaning} onChange={(event) => updateManualItem(index, { meaning: event.target.value })} />
                  </article>
                );
              })}
            </div>
          ) : null}
        </section>
      ) : null}

      {status === "error" ? (
        <div className="card library-error">
          <strong>Không tải được Thư viện</strong>
          <p>{errorText}</p>
        </div>
      ) : null}

      <div className="library-stack">
        {items.length ? (
          items.map((item) => (
            <article className="card library-card" key={item.id}>
              <div className="library-meta">
                {labelType(item.type)} · Đã hiện {item.shown_count}×
              </div>
              <div className="library-hanzi">{item.hanzi}</div>
              <div className="library-pinyin">{item.pinyin}</div>
              <div className="library-meaning">{item.meaning}</div>
            </article>
          ))
        ) : status === "loading" ? (
          <div className="empty-state">
            <div>
              <div className="empty-icon">学</div>
              <h2>Đang tải thư viện</h2>
            </div>
          </div>
        ) : (
          <div className="empty-state">
            <div>
              <div className="empty-icon">📚</div>
              <h2>Thư viện trống</h2>
              <p className="muted">Upload ảnh hoặc thêm thủ công để tạo mục học đầu tiên.</p>
            </div>
          </div>
        )}
      </div>

      {items.length < stats.total ? (
        <button className="ghost-button full-width load-more-button" type="button" onClick={() => loadLibrary({ append: true })} disabled={loadingMore}>
          {loadingMore ? "Đang tải..." : "Tải thêm"}
        </button>
      ) : null}
    </section>
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

function labelType(type: StudyItem["type"]) {
  if (type === "dialogue") return "Hội thoại";
  if (type === "word") return "Từ vựng";
  return "Câu";
}

async function loadExistingItems(): Promise<DuplicateMatch[]> {
  const supabase = createClient();
  const pageSize = 1000;
  const allItems: DuplicateMatch[] = [];

  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase
      .from("items")
      .select("id,type,hanzi,pinyin,meaning")
      .range(offset, offset + pageSize - 1);

    if (error) return allItems;

    allItems.push(
      ...(data || []).map((item) => ({
        id: item.id,
        source: "library" as const,
        type: item.type,
        hanzi: item.hanzi,
        pinyin: item.pinyin,
        meaning: item.meaning
      }))
    );

    if (!data || data.length < pageSize) return allItems;
  }
}

function parseManualText(text: string): { items: ManualItem[]; error?: string } {
  const normalizedText = text.replace(/\r\n/g, "\n").trim();

  if (!normalizedText) return { items: [], error: "Chưa có nội dung để kiểm tra." };
  if (!normalizedText.includes("***")) return { items: [], error: "Thiếu dấu ***. Mỗi mục cần bắt đầu bằng ***." };

  const [prefix, ...blocks] = normalizedText.split("***");
  if (prefix.trim()) return { items: [], error: "Có nội dung đứng trước dấu *** đầu tiên. Hãy đặt *** trước mỗi mục." };

  const items = blocks
    .map((block) => parseManualBlock(block))
    .filter((item): item is ManualItem => Boolean(item))
    .map(normalizeManualItem);

  if (!items.length) return { items: [], error: "Không tìm thấy mục hợp lệ sau dấu ***." };

  return { items };
}

function parseManualBlock(block: string): ManualItem | null {
  const lines = block
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) return null;

  const hanziLineCount = Math.max(1, countLeadingChineseLines(lines));
  const hanziLines = lines.slice(0, hanziLineCount);
  const remainingLines = lines.slice(hanziLineCount);
  const pinyinLineCount = hanziLineCount > 1 && remainingLines.length > hanziLineCount ? hanziLineCount : 1;
  const pinyinLines = remainingLines.slice(0, pinyinLineCount);
  const meaningLines = remainingLines.slice(pinyinLineCount);
  const hanzi = hanziLines.join("\n");

  return {
    type: detectItemType(hanzi),
    hanzi,
    pinyin: pinyinLines.join("\n"),
    meaning: meaningLines.join("\n"),
    validationErrors: []
  };
}

function countLeadingChineseLines(lines: string[]) {
  let count = 0;

  for (const line of lines) {
    if (!hasChineseText(line)) break;
    count += 1;
  }

  return count;
}

function normalizeManualItem(item: ManualItem): ManualItem {
  const next: ManualItem = {
    ...item,
    type: item.type || detectItemType(item.hanzi),
    hanzi: item.hanzi.trim(),
    pinyin: item.pinyin.trim(),
    meaning: item.meaning.trim(),
    validationErrors: []
  };

  next.validationErrors = validateManualItem(next);
  return next;
}

function validateManualItem(item: ExtractedItem) {
  const errors: string[] = [];

  if (!item.hanzi.trim()) errors.push("Thiếu Hán tự.");
  if (!item.pinyin.trim()) errors.push("Thiếu pinyin.");
  if (!item.meaning.trim()) errors.push("Thiếu nghĩa.");
  if (item.hanzi.trim() && !hasChineseText(item.hanzi)) errors.push("Ô Hán tự phải có chữ Trung.");
  if (hasChineseInPinyin(item.pinyin)) errors.push("Pinyin không được chứa Hán tự.");
  if (hasChineseText(item.meaning)) errors.push("Nghĩa tiếng Việt không được chứa Hán tự.");

  return errors;
}

function markManualDuplicates(items: ManualItem[], existingItems: DuplicateMatch[]): ManualItem[] {
  const seen = new Map<string, DuplicateMatch>();

  existingItems.forEach((item) => {
    const key = normalizeChineseText(item.hanzi);
    if (key && !seen.has(key)) seen.set(key, item);
  });

  return items.map((item) => {
    const normalizedItem = normalizeManualItem(item);
    const key = normalizeChineseText(normalizedItem.hanzi);
    const duplicateOf = key ? seen.get(key) : undefined;
    const nextItem: ManualItem = {
      ...normalizedItem,
      duplicateOf,
      allowDuplicate: duplicateOf ? Boolean(item.allowDuplicate) : false
    };

    if (key && !nextItem.validationErrors.length && !seen.has(key)) {
      seen.set(key, {
        source: "batch",
        type: nextItem.type,
        hanzi: nextItem.hanzi,
        pinyin: nextItem.pinyin,
        meaning: nextItem.meaning
      });
    }

    return nextItem;
  });
}

function isSaveableManualItem(item: ManualItem) {
  return !item.validationErrors.length && (!item.duplicateOf || item.allowDuplicate);
}

function detectItemType(hanzi: string): ItemType {
  const lines = hanzi
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > 1 || /(^|\n)\s*[A-Za-z]\s*[:：]/.test(hanzi)) return "dialogue";

  const compactLength = hanzi.replace(/\s/g, "").length;
  const hasSentencePunctuation = /[。！？!?，,；;]/.test(hanzi);

  if (!hasSentencePunctuation && compactLength <= 4) return "word";
  return "sentence";
}

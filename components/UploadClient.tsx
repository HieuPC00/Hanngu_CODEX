"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { cleanMeaning, hasChineseInPinyin, hasChineseText, normalizeChineseText } from "@/lib/text-quality";
import type { ExtractResult, ExtractedItem, ItemType } from "@/lib/types";
import "./upload.css";

type DuplicateMatch = {
  id?: string;
  source: "library" | "batch";
  type: ItemType;
  hanzi: string;
  pinyin?: string | null;
  meaning?: string | null;
};

type PreviewItem = ExtractedItem & {
  duplicateOf?: DuplicateMatch;
  allowDuplicate?: boolean;
};

type PreviewResult = Omit<ExtractResult, "items"> & {
  items: PreviewItem[];
};

export default function UploadClient() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<PreviewResult[]>([]);
  const [existingItems, setExistingItems] = useState<DuplicateMatch[]>([]);

  const validItemCount = useMemo(
    () => results.reduce((sum, result) => sum + result.items.filter(isSaveableStudyItem).length, 0),
    [results]
  );

  function chooseFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []).slice(0, 10);
    setFiles(selected);
    setResults([]);
  }

  async function extract() {
    setProcessing(true);
    const storedItems = await loadExistingItems();
    const nextResults: PreviewResult[] = [];
    setExistingItems(storedItems);

    try {
      for (let index = 0; index < files.length; index += 1) {
        const originalFile = files[index];
        setProgress(`Đang xử lý ${index + 1}/${files.length}...`);

        try {
          const image = await prepareOcrImage(originalFile);
          const result = await extractImage(image, sourceName);
          nextResults.push({
            fileName: originalFile.name,
            documentId: result.documentId,
            error: result.error,
            items: result.items.map(normalizeStudyItem)
          });
        } catch (error) {
          nextResults.push({
            fileName: originalFile.name,
            error: error instanceof Error ? error.message : "Không xử lý được ảnh này",
            items: []
          });
        }

        setResults(markDuplicates(nextResults, storedItems));
      }
    } finally {
      setProgress("");
      setProcessing(false);
    }
  }

  function updateItem(resultIndex: number, itemIndex: number, patch: Partial<PreviewItem>) {
    setResults((current) =>
      markDuplicates(
        current.map((result, rIndex) =>
          rIndex === resultIndex
            ? {
                ...result,
                items: result.items.map((item, iIndex) => (iIndex === itemIndex ? normalizeStudyItem({ ...item, ...patch }) : item))
              }
            : result
        ),
        existingItems
      )
    );
  }

  function removeItem(resultIndex: number, itemIndex: number) {
    setResults((current) =>
      markDuplicates(
        current.map((result, rIndex) =>
          rIndex === resultIndex ? { ...result, items: result.items.filter((_, iIndex) => iIndex !== itemIndex) } : result
        ),
        existingItems
      )
    );
  }

  function cancel() {
    setFiles([]);
    setResults([]);
    setProgress("");
    setProcessing(false);
  }

  async function saveItems() {
    const supabase = createClient();
    const rows = results.flatMap((result) =>
      result.items
        .map(normalizeStudyItem)
        .filter(isSaveableStudyItem)
        .map((item) => ({
          document_id: result.documentId || null,
          type: item.type,
          hanzi: item.hanzi,
          pinyin: item.pinyin,
          meaning: item.meaning
      }))
    );
    if (!rows.length) {
      alert("Chưa có mục hợp lệ để lưu. Mục trùng cần bật 'Vẫn lưu mục này' nếu bạn muốn lưu.");
      return;
    }
    const { error } = await supabase.from("items").insert(rows);
    if (error) {
      alert(`Không lưu được lên Supabase: ${error.message}`);
      return;
    }
    router.push("/");
    router.refresh();
  }

  if (results.length) {
    return (
      <section className="upload-page">
        <h1 className="page-title">Preview kết quả OCR</h1>
        <p className="page-subtitle">Sửa lại Hán tự, pinyin và nghĩa trước khi lưu.</p>

        <div className="preview-stack">
          {results.map((result, resultIndex) => (
            <article className="card result-card" key={`${result.fileName}-${resultIndex}`}>
              <header className="result-head">
                <strong>{result.fileName}</strong>
                {result.error ? <span className="error-text">{result.error}</span> : null}
              </header>
              {result.items.map((item, itemIndex) => {
                const isInvalid = !isValidStudyItem(item);
                const duplicate = item.duplicateOf;

                return (
                <div className={isInvalid ? "preview-item invalid-item" : duplicate ? "preview-item duplicate-item" : "preview-item"} key={`${item.hanzi}-${itemIndex}`}>
                  <div className="row">
                    <select
                      className="select"
                      value={item.type}
                      onChange={(event) => updateItem(resultIndex, itemIndex, { type: event.target.value as ItemType })}
                    >
                      <option value="sentence">Câu</option>
                      <option value="dialogue">Hội thoại</option>
                      <option value="word">Từ vựng</option>
                    </select>
                    <button className="danger-button" type="button" onClick={() => removeItem(resultIndex, itemIndex)}>
                      Xóa
                    </button>
                  </div>
                  {isInvalid ? <p className="validation-text">Mục này chưa hợp lệ: ô Hán tự phải có chữ Trung, pinyin không được chứa Hán tự.</p> : null}
                  {duplicate ? (
                    <div className="duplicate-box">
                      <strong>Trùng với {duplicate.source === "library" ? "mục đã lưu" : "mục trong lần upload này"}:</strong>
                      <span>{duplicate.hanzi}</span>
                      {duplicate.pinyin ? <em>{duplicate.pinyin}</em> : null}
                      {duplicate.meaning ? <small>{duplicate.meaning}</small> : null}
                      <label className="duplicate-choice">
                        <input
                          type="checkbox"
                          checked={Boolean(item.allowDuplicate)}
                          onChange={(event) => updateItem(resultIndex, itemIndex, { allowDuplicate: event.target.checked })}
                        />
                        Vẫn lưu mục này
                      </label>
                    </div>
                  ) : null}
                  <textarea className="textarea hanzi-input" value={item.hanzi} onChange={(e) => updateItem(resultIndex, itemIndex, { hanzi: e.target.value })} />
                  <textarea className="textarea pinyin-input" value={item.pinyin} onChange={(e) => updateItem(resultIndex, itemIndex, { pinyin: e.target.value })} />
                  <textarea className="textarea" value={item.meaning} onChange={(e) => updateItem(resultIndex, itemIndex, { meaning: e.target.value })} />
                </div>
                );
              })}
            </article>
          ))}
        </div>

        <footer className="upload-footer">
          <button className="ghost-button" type="button" onClick={cancel}>
            Hủy
          </button>
          <button className="success-button" type="button" onClick={saveItems} disabled={!validItemCount}>
            Lưu {validItemCount} mục
          </button>
        </footer>
      </section>
    );
  }

  return (
    <section>
      <h1 className="page-title">Upload ảnh</h1>
      <p className="page-subtitle">Chọn tối đa 10 ảnh có chữ Trung. Mỗi ảnh chỉ gọi AI một lần để tiết kiệm quota.</p>

      <label className="drop-zone">
        <span className="camera-icon">📷</span>
        <strong>{files.length ? `Đã chọn ${files.length} ảnh` : "Bấm để chọn ảnh"}</strong>
        <span className="muted">Tối đa 10 ảnh/lần</span>
        <input type="file" accept="image/*" multiple onChange={chooseFiles} />
      </label>

      <label className="source-field">
        <span>Nguồn</span>
        <input className="field" value={sourceName} onChange={(event) => setSourceName(event.target.value)} placeholder="Bài 5 sách HSK 2" />
      </label>

      <button className="button full-width" type="button" onClick={extract} disabled={!files.length || processing}>
        {processing ? progress : `Trích xuất ${files.length} ảnh`}
      </button>
    </section>
  );
}

async function extractImage(image: File, sourceName: string): Promise<ExtractResult> {
  const formData = new FormData();
  formData.append("image", image, image.name);
  formData.append("sourceName", sourceName);

  const response = await fetch("/api/extract", { method: "POST", body: formData });
  const contentType = response.headers.get("content-type") || "";

  if (!contentType.includes("application/json")) {
    const text = await response.text();
    throw new Error(text.slice(0, 180) || `HTTP ${response.status}`);
  }

  const payload = (await response.json()) as ExtractResult;
  return response.ok ? payload : { ...payload, error: payload.error || `HTTP ${response.status}` };
}

async function loadExistingItems(): Promise<DuplicateMatch[]> {
  const supabase = createClient();
  const { data, error } = await supabase.from("items").select("id,type,hanzi,pinyin,meaning").range(0, 9999);
  if (error) return [];

  return (data || []).map((item) => ({
    id: item.id,
    source: "library",
    type: item.type,
    hanzi: item.hanzi,
    pinyin: item.pinyin,
    meaning: item.meaning
  }));
}

function markDuplicates(results: PreviewResult[], existingItems: DuplicateMatch[]): PreviewResult[] {
  const seen = new Map<string, DuplicateMatch>();

  existingItems.forEach((item) => {
    const key = normalizeChineseText(item.hanzi);
    if (key && !seen.has(key)) seen.set(key, item);
  });

  return results.map((result) => ({
    ...result,
    items: result.items.map((item) => {
      const key = normalizeChineseText(item.hanzi);
      const duplicateOf = key ? seen.get(key) : undefined;
      const nextItem: PreviewItem = {
        ...item,
        duplicateOf,
        allowDuplicate: duplicateOf ? Boolean(item.allowDuplicate) : false
      };

      if (key && isValidStudyItem(nextItem) && !seen.has(key)) {
        seen.set(key, {
          source: "batch",
          type: nextItem.type,
          hanzi: nextItem.hanzi,
          pinyin: nextItem.pinyin,
          meaning: nextItem.meaning
        });
      }

      return nextItem;
    })
  }));
}

function normalizeStudyItem(item: ExtractedItem): PreviewItem {
  return {
    ...item,
    hanzi: item.hanzi.trim(),
    pinyin: hasChineseInPinyin(item.pinyin) ? "" : item.pinyin.trim(),
    meaning: cleanMeaning(item.meaning)
  };
}

function isValidStudyItem(item: ExtractedItem) {
  return hasChineseText(item.hanzi) && !hasChineseInPinyin(item.pinyin);
}

function isSaveableStudyItem(item: PreviewItem) {
  return isValidStudyItem(item) && (!item.duplicateOf || item.allowDuplicate);
}

async function prepareOcrImage(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;

  try {
    const image = await loadImage(file);
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const trim = detectUsefulImageBounds(image);
    const sourceWidth = trim.right - trim.left;
    const sourceHeight = trim.bottom - trim.top;
    const maxLongSide = 3200;
    const scale = Math.min(1, maxLongSide / Math.max(sourceWidth, sourceHeight));
    const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
    const targetHeight = Math.max(1, Math.round(sourceHeight * scale));

    return await renderImageCrop(image, `${baseName}.jpg`, trim.left, trim.top, sourceWidth, sourceHeight, targetWidth, targetHeight);
  } catch {
    return file;
  }
}

function detectUsefulImageBounds(image: HTMLImageElement) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const sampleWidth = Math.min(900, width);
  const sampleHeight = Math.min(1400, height);
  const canvas = document.createElement("canvas");
  canvas.width = sampleWidth;
  canvas.height = sampleHeight;
  const context = canvas.getContext("2d");

  if (!context) {
    return { left: 0, top: 0, right: width, bottom: height };
  }

  context.drawImage(image, 0, 0, sampleWidth, sampleHeight);
  const data = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
  let left = sampleWidth;
  let top = sampleHeight;
  let right = 0;
  let bottom = 0;

  for (let y = 0; y < sampleHeight; y += 2) {
    for (let x = 0; x < sampleWidth; x += 2) {
      const offset = (y * sampleWidth + x) * 4;
      const r = data[offset];
      const g = data[offset + 1];
      const b = data[offset + 2];
      const dark = r < 235 || g < 235 || b < 235;

      if (dark) {
        left = Math.min(left, x);
        top = Math.min(top, y);
        right = Math.max(right, x);
        bottom = Math.max(bottom, y);
      }
    }
  }

  if (right <= left || bottom <= top) {
    return { left: 0, top: 0, right: width, bottom: height };
  }

  const scaleX = width / sampleWidth;
  const scaleY = height / sampleHeight;
  const paddingX = Math.round(width * 0.025);
  const paddingY = Math.round(height * 0.025);

  return {
    left: Math.max(0, Math.floor(left * scaleX) - paddingX),
    top: Math.max(0, Math.floor(top * scaleY) - paddingY),
    right: Math.min(width, Math.ceil(right * scaleX) + paddingX),
    bottom: Math.min(height, Math.ceil(bottom * scaleY) + paddingY)
  };
}

async function renderImageCrop(
  image: HTMLImageElement,
  name: string,
  sourceX: number,
  sourceY: number,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");

  if (!context) throw new Error("Không xử lý được ảnh");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, targetWidth, targetHeight);
  context.drawImage(image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, targetWidth, targetHeight);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  if (!blob) throw new Error("Không nén được ảnh");

  return new File([blob], name, { type: "image/jpeg" });
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();

    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Không đọc được ảnh"));
    };

    image.src = url;
  });
}

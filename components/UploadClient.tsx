"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import { addLocalItems, getLocalItems } from "@/lib/local-store";
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
          const ocrImages = await prepareOcrImages(originalFile);
          const parts: ExtractResult[] = [];

          for (let partIndex = 0; partIndex < ocrImages.length; partIndex += 1) {
            const image = ocrImages[partIndex];
            const partLabel = ocrImages.length > 1 ? ` phần ${partIndex + 1}/${ocrImages.length}` : "";
            setProgress(`Đang xử lý ${index + 1}/${files.length}${partLabel}...`);
            parts.push(await extractImage(image, sourceName));
          }

          const items = parts.flatMap((part) => part.items);
          const errors = parts.map((part) => part.error).filter(Boolean);
          nextResults.push({
            fileName: originalFile.name,
            documentId: parts.find((part) => part.documentId)?.documentId,
            error: errors.length ? errors.join(" | ") : undefined,
            items: items.map(normalizeStudyItem)
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
    const extractedItems = results.flatMap((result) => result.items.map(normalizeStudyItem).filter(isSaveableStudyItem));
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
      addLocalItems(extractedItems);
      alert("Không lưu được lên Supabase, app đã lưu dự phòng trên máy này để không mất dữ liệu OCR.");
      router.push("/");
      router.refresh();
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
      <p className="page-subtitle">Chọn tối đa 10 ảnh có chữ Trung. Ảnh sẽ xử lý tuần tự để tránh rate limit.</p>

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
  const supabaseItems: DuplicateMatch[] = error
    ? []
    : (data || []).map((item) => ({
        id: item.id,
        source: "library",
        type: item.type,
        hanzi: item.hanzi,
        pinyin: item.pinyin,
        meaning: item.meaning
      }));

  return [
    ...getLocalItems().map((item): DuplicateMatch => ({
      id: item.id,
      source: "library",
      type: item.type,
      hanzi: item.hanzi,
      pinyin: item.pinyin,
      meaning: item.meaning
    })),
    ...supabaseItems
  ];
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

async function prepareOcrImages(file: File): Promise<File[]> {
  if (!file.type.startsWith("image/")) return [file];

  try {
    const image = await loadImage(file);
    const maxSide = 2600;
    const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const shouldTile = height > 1500 && height / width > 1.55;

    if (!shouldTile) {
      return [await renderImageTile(image, `${baseName}.jpg`, scale, 0, height, width)];
    }

    const tileCount = Math.min(4, Math.max(2, Math.ceil(height / Math.max(width * 1.15, 900))));
    const overlap = Math.min(180, Math.round(height / (tileCount * 8)));
    const tileHeight = height / tileCount;
    const tiles: File[] = [];

    for (let tileIndex = 0; tileIndex < tileCount; tileIndex += 1) {
      const y = Math.max(0, Math.round(tileIndex * tileHeight - overlap));
      const bottom = Math.min(height, Math.round((tileIndex + 1) * tileHeight + overlap));
      tiles.push(await renderImageTile(image, `${baseName}-part-${tileIndex + 1}.jpg`, scale, y, bottom - y, width));
    }

    return tiles;
  } catch {
    return [file];
  }
}

async function renderImageTile(image: HTMLImageElement, name: string, scale: number, targetY: number, targetHeight: number, targetWidth: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const context = canvas.getContext("2d");

  if (!context) throw new Error("Không xử lý được ảnh");

  const sourceY = Math.max(0, targetY / scale);
  const sourceHeight = Math.min(image.naturalHeight - sourceY, targetHeight / scale);

  context.drawImage(
    image,
    0,
    sourceY,
    image.naturalWidth,
    sourceHeight,
    0,
    0,
    targetWidth,
    targetHeight
  );

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

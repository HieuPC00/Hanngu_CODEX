"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase-browser";
import type { ExtractResult, ExtractedItem, ItemType } from "@/lib/types";
import "./upload.css";

export default function UploadClient() {
  const router = useRouter();
  const [files, setFiles] = useState<File[]>([]);
  const [sourceName, setSourceName] = useState("");
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState("");
  const [results, setResults] = useState<ExtractResult[]>([]);

  const itemCount = useMemo(() => results.reduce((sum, result) => sum + result.items.length, 0), [results]);

  function chooseFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files || []).slice(0, 10);
    setFiles(selected);
    setResults([]);
  }

  async function extract() {
    setProcessing(true);
    const nextResults: ExtractResult[] = [];
    for (let index = 0; index < files.length; index += 1) {
      setProgress(`Đang xử lý ${index + 1}/${files.length}...`);
      const formData = new FormData();
      formData.append("image", files[index]);
      formData.append("sourceName", sourceName);
      const response = await fetch("/api/extract", { method: "POST", body: formData });
      const payload = (await response.json()) as ExtractResult;
      nextResults.push(payload);
      setResults([...nextResults]);
    }
    setProgress("");
    setProcessing(false);
  }

  function updateItem(resultIndex: number, itemIndex: number, patch: Partial<ExtractedItem>) {
    setResults((current) =>
      current.map((result, rIndex) =>
        rIndex === resultIndex
          ? {
              ...result,
              items: result.items.map((item, iIndex) => (iIndex === itemIndex ? { ...item, ...patch } : item))
            }
          : result
      )
    );
  }

  function removeItem(resultIndex: number, itemIndex: number) {
    setResults((current) =>
      current.map((result, rIndex) =>
        rIndex === resultIndex ? { ...result, items: result.items.filter((_, iIndex) => iIndex !== itemIndex) } : result
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
      result.items.map((item) => ({
        document_id: result.documentId || null,
        type: item.type,
        hanzi: item.hanzi,
        pinyin: item.pinyin,
        meaning: item.meaning
      }))
    );
    if (!rows.length) return;
    const { error } = await supabase.from("items").insert(rows);
    if (error) {
      alert(error.message);
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
              {result.items.map((item, itemIndex) => (
                <div className="preview-item" key={`${item.hanzi}-${itemIndex}`}>
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
                  <textarea className="textarea hanzi-input" value={item.hanzi} onChange={(e) => updateItem(resultIndex, itemIndex, { hanzi: e.target.value })} />
                  <textarea className="textarea pinyin-input" value={item.pinyin} onChange={(e) => updateItem(resultIndex, itemIndex, { pinyin: e.target.value })} />
                  <textarea className="textarea" value={item.meaning} onChange={(e) => updateItem(resultIndex, itemIndex, { meaning: e.target.value })} />
                </div>
              ))}
            </article>
          ))}
        </div>

        <footer className="upload-footer">
          <button className="ghost-button" type="button" onClick={cancel}>
            Hủy
          </button>
          <button className="success-button" type="button" onClick={saveItems} disabled={!itemCount}>
            Lưu {itemCount} mục
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

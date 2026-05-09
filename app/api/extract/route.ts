import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import type { ExtractedItem, ItemType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const allowedTypes: ItemType[] = ["word", "sentence", "dialogue"];

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
    error: userError
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return NextResponse.json({ fileName: "unknown", error: "Unauthorized", items: [] }, { status: 401 });
  }

  const formData = await request.formData();
  const file = formData.get("image");
  const sourceName = String(formData.get("sourceName") || "");

  if (!(file instanceof File)) {
    return NextResponse.json({ fileName: "unknown", error: "Missing image", items: [] }, { status: 400 });
  }

  if (file.size > 12 * 1024 * 1024) {
    return NextResponse.json({
      fileName: file.name,
      error: "Ảnh quá lớn. Hãy chụp/cắt ảnh gọn hơn rồi thử lại.",
      items: []
    });
  }

  const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
  const safeExtension = extension.replace(/[^a-z0-9]/g, "") || "jpg";
  let imagePath = `${user.id}/${Date.now()}-${crypto.randomUUID()}.${safeExtension}`;

  if (!imagePath.startsWith(`${user.id}/`)) {
    return NextResponse.json({ fileName: file.name, error: "Invalid storage path", items: [] }, { status: 400 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const imageUrl = `data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}`;

  const uploadResult = await supabase.storage.from("documents").upload(imagePath, bytes, {
    contentType: file.type || "image/jpeg",
    upsert: false
  });

  if (uploadResult.error) {
    imagePath = `inline:${file.name}`;
  }

  const documentResult = await supabase
    .from("documents")
    .insert({ image_url: imagePath, source_name: sourceName || null })
    .select("id")
    .single();

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({
      fileName: file.name,
      documentId: documentResult.data?.id,
      imagePath,
      error: "Missing GROQ_API_KEY on Vercel",
      items: []
    });
  }

  try {
    const items = await extractWithGroq(groqKey, imageUrl);
    if (!items.length) {
      return NextResponse.json({
        fileName: file.name,
        documentId: documentResult.data?.id,
        imagePath,
        error: "Không tìm thấy chữ Trung trong ảnh này. Hãy thử ảnh rõ hơn hoặc cắt sát vùng có chữ.",
        items: []
      });
    }

    return NextResponse.json({
      fileName: file.name,
      documentId: documentResult.data?.id,
      imagePath,
      items
    });
  } catch (error) {
    return NextResponse.json({
      fileName: file.name,
      documentId: documentResult.data?.id,
      imagePath,
      error: error instanceof Error ? error.message : "Groq extraction failed",
      items: []
    });
  }
}

async function extractWithGroq(apiKey: string, imageUrl: string): Promise<ExtractedItem[]> {
  const model = process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
  const prompt = `Bạn là hệ thống OCR và biên soạn học liệu tiếng Trung cho người Việt.
Trích xuất TẤT CẢ nội dung tiếng Trung trong ảnh theo thứ tự xuất hiện.
Quy tắc:
- Câu hoàn chỉnh độc lập: type="sentence".
- Đoạn hội thoại nhiều dòng liên tiếp: type="dialogue"; hanzi, pinyin, meaning đều dùng \\n tương ứng từng dòng.
- Từ vựng đơn lẻ: type="word".
- Pinyin có dấu chuẩn, ví dụ nǐ hǎo, không dùng ni3 hao3.
- Nghĩa tiếng Việt tự nhiên, không dịch word-by-word.
- Bỏ qua header, footer, số trang, watermark.
Chỉ trả JSON hợp lệ dạng {"items":[{"type":"word|sentence|dialogue","hanzi":"...","pinyin":"...","meaning":"..."}]}.`;

  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Groq error ${response.status}: ${text.slice(0, 220)}`);
  }

  const payload = await response.json();
  const content = payload.choices?.[0]?.message?.content;
  const parsed = JSON.parse(content || "{}");
  const rawItems: Array<{ type?: ItemType; hanzi?: string; pinyin?: string; meaning?: string }> = Array.isArray(parsed.items)
    ? parsed.items
    : [];

  return rawItems
    .map((item): ExtractedItem => {
      const candidateType = item.type;
      const type = candidateType && allowedTypes.includes(candidateType) ? candidateType : "sentence";
      return {
        type,
        hanzi: String(item.hanzi || "").trim(),
        pinyin: String(item.pinyin || "").trim(),
        meaning: String(item.meaning || "").trim()
      };
    })
    .filter((item) => item.hanzi);
}

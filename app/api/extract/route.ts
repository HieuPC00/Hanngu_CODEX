import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase-server";
import { cleanMeaning, hasChineseInPinyin, hasChineseText } from "@/lib/text-quality";
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

  const bytes = Buffer.from(await file.arrayBuffer());
  const imageUrl = `data:${file.type || "image/jpeg"};base64,${bytes.toString("base64")}`;

  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) {
    return NextResponse.json({
      fileName: file.name,
      error: "Missing GROQ_API_KEY on Vercel",
      items: []
    });
  }

  try {
    const items = await extractWithGroq(groqKey, imageUrl);
    if (!items.length) {
      return NextResponse.json({
        fileName: file.name,
        error: "Không tìm thấy chữ Trung trong ảnh này. Hãy thử ảnh rõ hơn hoặc cắt sát vùng có chữ.",
        items: []
      });
    }

    const documentResult = await supabase
      .from("documents")
      .insert({ image_url: `no-image:${file.name}`, source_name: sourceName || null })
      .select("id")
      .single();

    return NextResponse.json({
      fileName: file.name,
      documentId: documentResult.data?.id,
      items
    });
  } catch (error) {
    return NextResponse.json({
      fileName: file.name,
      error: error instanceof Error ? error.message : "Groq extraction failed",
      items: []
    });
  }
}

async function extractWithGroq(apiKey: string, imageUrl: string): Promise<ExtractedItem[]> {
  const model = process.env.GROQ_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
  const prompt = `You are an OCR system for Mandarin Chinese learning cards for Vietnamese learners.

Extract ONLY actual Chinese learning content from the image.

Return valid JSON only:
{"items":[{"type":"word|sentence|dialogue","hanzi":"...","pinyin":"...","meaning":"..."}]}

Strict field rules:
1. "hanzi" MUST contain the original Chinese characters from the image, for example: 这台电脑五千块钱。
   - NEVER put pinyin, Vietnamese, English, Latin letters, or translations in "hanzi".
   - If you cannot read the Chinese characters, omit that item.
2. "pinyin" MUST contain only romanized pinyin with tone marks, for example: zhè tái diànnǎo wǔ qiān kuài qián.
   - NEVER put Chinese characters in "pinyin".
3. "meaning" MUST be natural Vietnamese only.
   - NEVER include Chinese characters in "meaning".
   - Example: "Chiếc máy tính này năm nghìn tệ."
4. For dialogue, keep corresponding lines separated by \\n in hanzi, pinyin, and meaning.
5. Use type="word" for single vocabulary, "sentence" for standalone sentences, "dialogue" for multi-line conversations.
6. Ignore page numbers, UI text, watermarks, headers, and footers.
7. Do not invent content. Do not translate Vietnamese-only text into Chinese.`;

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
        pinyin: hasChineseInPinyin(item.pinyin) ? "" : String(item.pinyin || "").trim(),
        meaning: cleanMeaning(item.meaning)
      };
    })
    .filter((item) => hasChineseText(item.hanzi));
}

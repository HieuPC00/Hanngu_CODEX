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
  const mimeType = file.type || "image/jpeg";
  const imageBase64 = bytes.toString("base64");

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return NextResponse.json({
      fileName: file.name,
      error: "Missing GEMINI_API_KEY on Vercel",
      items: []
    });
  }

  try {
    const items = await extractWithGemini(geminiKey, imageBase64, mimeType);
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
      error: error instanceof Error ? error.message : "Image extraction failed",
      items: []
    });
  }
}

const extractionPrompt = `You are an OCR system for Mandarin Chinese learning cards for Vietnamese learners.

Extract ALL actual Chinese learning content from the entire image.

Important coverage rules:
- Scan the full image from top to bottom and left to right. Do not stop after the first clear section.
- The page may contain multiple sections: pinyin + Chinese examples, Chinese-only exercises, questions, dialogues, numbered practice lines, and short instructions. Extract every visible Chinese sentence, question, vocabulary item, and dialogue line that a learner could study.
- If one line has pinyin followed by Chinese in parentheses, use the Chinese in parentheses as "hanzi" and use the printed pinyin for "pinyin".
- If a Chinese sentence/question/dialogue has no printed pinyin, still extract it and generate accurate pinyin with tone marks from the Chinese text.
- If a Chinese sentence/question/dialogue has no Vietnamese meaning printed, generate a natural Vietnamese meaning.
- Include lower-page exercise content such as numbered sentences, questions, and A/B dialogue. Do not ignore it because it looks like an exercise.
- Omit only pure page UI, page numbers, watermarks, ads, website/browser text, and non-learning headers/footers.

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
7. Do not invent extra Chinese content. It is allowed to generate pinyin and Vietnamese meaning from Chinese that is actually visible in the image.
8. Preserve the reading order of the page in the returned array.
9. Prefer more complete extraction over a short summary. If the page has 20 study lines, return about 20 items.`;

const responseJsonSchema = {
  type: "object",
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: allowedTypes,
            description: "word for vocabulary, sentence for standalone sentence/question, dialogue for multi-line conversation."
          },
          hanzi: {
            type: "string",
            description: "Original Chinese characters exactly visible in the image. No pinyin, no Vietnamese, no Latin text."
          },
          pinyin: {
            type: "string",
            description: "Romanized Mandarin pinyin with tone marks only. Generate it when the image has Chinese but no printed pinyin."
          },
          meaning: {
            type: "string",
            description: "Natural Vietnamese meaning only. No Chinese characters."
          }
        },
        required: ["type", "hanzi", "pinyin", "meaning"]
      }
    }
  },
  required: ["items"]
};

async function extractWithGemini(apiKey: string, imageBase64: string, mimeType: string): Promise<ExtractedItem[]> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { text: extractionPrompt },
            {
              inline_data: {
                mime_type: mimeType,
                data: imageBase64
              }
            }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.05,
        maxOutputTokens: 8192,
        responseMimeType: "application/json",
        responseJsonSchema
      }
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(formatGeminiError(response.status, text));
  }

  const payload = await response.json();
  const content = payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text || "").join("") || "";
  const parsed = JSON.parse(content || "{}");
  const rawItems: Array<{ type?: ItemType; hanzi?: string; pinyin?: string; meaning?: string }> = Array.isArray(parsed.items)
    ? parsed.items
    : [];

  return normalizeExtractedItems(rawItems);
}

function normalizeExtractedItems(rawItems: Array<{ type?: ItemType; hanzi?: string; pinyin?: string; meaning?: string }>): ExtractedItem[] {
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

function formatGeminiError(status: number, body: string) {
  if (status === 429) {
    return "Gemini đã hết quota miễn phí hoặc vượt giới hạn tạm thời. Hãy lưu các mục đã trích được, đợi quota hồi lại rồi upload tiếp ít ảnh hơn.";
  }

  if (status === 400) {
    return "Gemini không nhận được ảnh này. Hãy thử chụp/cắt ảnh rõ hơn rồi upload lại.";
  }

  if (status === 401 || status === 403) {
    return "Gemini API key chưa hợp lệ hoặc chưa có quyền dùng API.";
  }

  return `Gemini lỗi ${status}: ${body.slice(0, 160)}`;
}

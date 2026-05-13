import { NextResponse } from "next/server";
import { ACCESS_COOKIE_NAME, isValidAccessCode, readCookieValue } from "@/lib/shared-access";
import { inferDifficulty, normalizeDifficulty } from "@/lib/difficulty";
import { cleanMeaning, hasChineseInPinyin, hasChineseText } from "@/lib/text-quality";
import type { ExtractedItem, ItemDifficulty, ItemType } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const allowedTypes: ItemType[] = ["word", "sentence", "dialogue"];
const allowedDifficulties: ItemDifficulty[] = ["easy", "hard"];

type ImageInput = {
  imageIndex: number;
  fileName: string;
  mimeType: string;
  imageBase64: string;
};

type ExtractApiResult = {
  fileName: string;
  error?: string;
  items: ExtractedItem[];
};

export async function POST(request: Request) {
  const accessCode = readCookieValue(request.headers.get("cookie"), ACCESS_COOKIE_NAME);

  if (!isValidAccessCode(accessCode)) {
    return NextResponse.json({ fileName: "unknown", error: "Unauthorized", items: [] }, { status: 401 });
  }

  const formData = await request.formData();
  const files = formData
    .getAll("images")
    .filter((file): file is File => file instanceof File);
  const singleFile = formData.get("image");

  if (!files.length && singleFile instanceof File) {
    files.push(singleFile);
  }

  if (!files.length) {
    return NextResponse.json({ error: "Missing image", results: [] }, { status: 400 });
  }

  if (files.length > 10) {
    return NextResponse.json({ error: "Chỉ xử lý tối đa 10 ảnh mỗi lần.", results: [] }, { status: 400 });
  }

  const results: ExtractApiResult[] = files.map((file) => ({
    fileName: file.name,
    items: []
  }));
  const imageInputs: ImageInput[] = [];

  for (let imageIndex = 0; imageIndex < files.length; imageIndex += 1) {
    const file = files[imageIndex];

    if (file.size > 12 * 1024 * 1024) {
      results[imageIndex] = {
        fileName: file.name,
        error: "Ảnh quá lớn. Hãy chụp/cắt ảnh gọn hơn rồi thử lại.",
        items: []
      };
      continue;
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    imageInputs.push({
      imageIndex,
      fileName: file.name,
      mimeType: file.type || "image/jpeg",
      imageBase64: bytes.toString("base64")
    });
  }

  if (!imageInputs.length) {
    return NextResponse.json({ results });
  }

  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    return NextResponse.json({
      results: results.map((result, index) =>
        imageInputs.some((image) => image.imageIndex === index)
          ? { ...result, error: "Missing GEMINI_API_KEY on Vercel" }
          : result
      )
    });
  }

  try {
    const extractedByIndex = await extractWithGemini(geminiKey, imageInputs);

    imageInputs.forEach((image) => {
      const items = extractedByIndex.get(image.imageIndex) || [];
      results[image.imageIndex] = {
        fileName: image.fileName,
        error: items.length ? undefined : "Không tìm thấy chữ Trung trong ảnh này. Hãy thử ảnh rõ hơn hoặc cắt sát vùng có chữ.",
        items
      };
    });

    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image extraction failed";

    imageInputs.forEach((image) => {
      results[image.imageIndex] = {
        fileName: image.fileName,
        error: message,
        items: []
      };
    });

    return NextResponse.json({ results });
  }
}

const extractionPrompt = `You are an OCR system for Mandarin Chinese learning cards for Vietnamese learners.

You will receive 1 to 10 images. Each image is preceded by an IMAGE_INDEX marker.

Extract ALL actual Chinese learning content from every image. Return one result object for every IMAGE_INDEX.

Important coverage rules:
- Scan the full image from top to bottom and left to right. Do not stop after the first clear section.
- The page may contain multiple sections: pinyin + Chinese examples, Chinese-only exercises, questions, dialogues, numbered practice lines, and short instructions. Extract every visible Chinese sentence, question, vocabulary item, and dialogue line that a learner could study.
- If one line has pinyin followed by Chinese in parentheses, use the Chinese in parentheses as "hanzi" and use the printed pinyin for "pinyin".
- If a Chinese sentence/question/dialogue has no printed pinyin, still extract it and generate accurate pinyin with tone marks from the Chinese text.
- If a Chinese sentence/question/dialogue has no Vietnamese meaning printed, generate a natural Vietnamese meaning.
- Include lower-page exercise content such as numbered sentences, questions, and A/B dialogue. Do not ignore it because it looks like an exercise.
- Omit only pure page UI, page numbers, watermarks, ads, website/browser text, and non-learning headers/footers.

Return valid JSON only:
{"results":[{"imageIndex":0,"items":[{"type":"word|sentence|dialogue","difficulty":"easy|hard","hanzi":"...","pinyin":"...","meaning":"..."}]}]}

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
6. Set difficulty="easy" for short vocabulary or simple short sentences. Set difficulty="hard" for dialogues, long sentences, multi-clause text, paragraphs, or dense exercises.
7. Ignore page numbers, UI text, watermarks, headers, and footers.
8. Do not invent extra Chinese content. It is allowed to generate pinyin and Vietnamese meaning from Chinese that is actually visible in the image.
9. Preserve the reading order of the page in the returned array.
10. Prefer more complete extraction over a short summary. If the page has 20 study lines, return about 20 items.`;

const responseJsonSchema = {
  type: "object",
  properties: {
    results: {
      type: "array",
      items: {
        type: "object",
        properties: {
          imageIndex: {
            type: "integer",
            description: "The IMAGE_INDEX number for this image."
          },
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
                difficulty: {
                  type: "string",
                  enum: allowedDifficulties,
                  description: "easy for short/simple items, hard for dialogues, long sentences, paragraphs, or dense exercises."
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
              required: ["type", "difficulty", "hanzi", "pinyin", "meaning"]
            }
          }
        },
        required: ["imageIndex", "items"]
      }
    }
  },
  required: ["results"]
};

async function extractWithGemini(apiKey: string, images: ImageInput[]): Promise<Map<number, ExtractedItem[]>> {
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const imageParts = images.flatMap((image) => [
    {
      text: `IMAGE_INDEX: ${image.imageIndex}\nFILE_NAME: ${image.fileName}`
    },
    {
      inline_data: {
        mime_type: image.mimeType,
        data: image.imageBase64
      }
    }
  ]);

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
            ...imageParts
          ]
        }
      ],
      generationConfig: {
        temperature: 0.05,
        maxOutputTokens: 16384,
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
  const rawResults: Array<{
    imageIndex?: number;
    items?: Array<{ type?: ItemType; difficulty?: ItemDifficulty; hanzi?: string; pinyin?: string; meaning?: string }>;
  }> = Array.isArray(parsed.results) ? parsed.results : [];
  const byIndex = new Map<number, ExtractedItem[]>();

  rawResults.forEach((result) => {
    if (typeof result.imageIndex !== "number") return;
    byIndex.set(result.imageIndex, normalizeExtractedItems(Array.isArray(result.items) ? result.items : []));
  });

  return byIndex;
}

function normalizeExtractedItems(rawItems: Array<{ type?: ItemType; difficulty?: ItemDifficulty; hanzi?: string; pinyin?: string; meaning?: string }>): ExtractedItem[] {
  return rawItems
    .map((item): ExtractedItem => {
      const candidateType = item.type;
      const type = candidateType && allowedTypes.includes(candidateType) ? candidateType : "sentence";
      const hanzi = String(item.hanzi || "").trim();
      return {
        type,
        difficulty: normalizeDifficulty(item.difficulty, inferDifficulty(hanzi, type)),
        hanzi,
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

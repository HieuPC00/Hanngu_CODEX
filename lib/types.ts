export type ItemType = "word" | "sentence" | "dialogue";

export type StudyItem = {
  id: string;
  user_id: string;
  document_id: string | null;
  type: ItemType;
  hanzi: string;
  pinyin: string | null;
  meaning: string | null;
  mastery: number;
  shown_count: number;
  last_shown_at: string | null;
  last_studied_at: string | null;
  created_at: string;
};

export type ExtractedItem = {
  type: ItemType;
  hanzi: string;
  pinyin: string;
  meaning: string;
};

export type ExtractResult = {
  fileName: string;
  error?: string;
  items: ExtractedItem[];
};

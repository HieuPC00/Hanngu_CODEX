const seedCards = [
  { hanzi: "你好", pinyin: "nǐ hǎo", meaning: "xin chào", example: "你好，我叫安。", source: "sample" },
  { hanzi: "谢谢", pinyin: "xiè xie", meaning: "cảm ơn", example: "谢谢你的帮助。", source: "sample" },
  { hanzi: "我想喝水", pinyin: "wǒ xiǎng hē shuǐ", meaning: "tôi muốn uống nước", example: "我想喝水。", source: "sample" },
  { hanzi: "这个菜很好吃", pinyin: "zhè ge cài hěn hǎo chī", meaning: "món này rất ngon", example: "这个菜很好吃。", source: "sample" }
];

const miniDict = {
  你: ["nǐ", "bạn"],
  好: ["hǎo", "tốt, khỏe"],
  我: ["wǒ", "tôi"],
  想: ["xiǎng", "muốn, nghĩ"],
  喝: ["hē", "uống"],
  水: ["shuǐ", "nước"],
  这: ["zhè", "này"],
  个: ["ge", "lượng từ"],
  菜: ["cài", "món ăn, rau"],
  很: ["hěn", "rất"],
  吃: ["chī", "ăn"],
  谢: ["xiè", "cảm ơn"],
  的: ["de", "của"],
  帮: ["bāng", "giúp"],
  助: ["zhù", "giúp đỡ"],
  叫: ["jiào", "gọi là"],
  安: ["ān", "an"]
};

const intervals = {
  fail: 10 * 60 * 1000,
  hard: 24 * 60 * 60 * 1000,
  good: 3 * 24 * 60 * 60 * 1000,
  easy: 7 * 24 * 60 * 60 * 1000
};

const store = {
  cards: load("mandarinCaptureCards", seedCards.map(withMeta)),
  activeId: null,
  view: "capture",
  user: null,
  supabase: null
};

const els = {
  cardCount: document.querySelector("#cardCount"),
  dueCount: document.querySelector("#dueCount"),
  statusText: document.querySelector("#statusText"),
  authStatus: document.querySelector("#authStatus"),
  emailInput: document.querySelector("#emailInput"),
  loginButton: document.querySelector("#loginButton"),
  logoutButton: document.querySelector("#logoutButton"),
  syncButton: document.querySelector("#syncButton"),
  searchInput: document.querySelector("#searchInput"),
  imageInput: document.querySelector("#imageInput"),
  imagePreview: document.querySelector("#imagePreview"),
  sourceText: document.querySelector("#sourceText"),
  createCards: document.querySelector("#createCards"),
  clearInput: document.querySelector("#clearInput"),
  draftList: document.querySelector("#draftList"),
  studyCard: document.querySelector("#studyCard"),
  nextCard: document.querySelector("#nextCard"),
  showHanzi: document.querySelector("#showHanzi"),
  showPinyin: document.querySelector("#showPinyin"),
  showMeaning: document.querySelector("#showMeaning"),
  showExample: document.querySelector("#showExample"),
  libraryList: document.querySelector("#libraryList"),
  exportData: document.querySelector("#exportData"),
  importData: document.querySelector("#importData"),
  remoteUrl: document.querySelector("#remoteUrl")
};

function load(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

function save() {
  localStorage.setItem("mandarinCaptureCards", JSON.stringify(store.cards));
}

function authConfig() {
  return window.MANDARIN_CAPTURE_CONFIG || {};
}

function authReady() {
  const config = authConfig();
  return Boolean(window.supabase && config.supabaseUrl && config.supabaseAnonKey);
}

function setAuthStatus(message) {
  els.authStatus.textContent = message;
}

async function initAuth() {
  if (!authReady()) {
    setAuthStatus("Chưa cấu hình Supabase. Vẫn dùng được local, chưa đăng nhập/sync.");
    return;
  }
  const config = authConfig();
  store.supabase = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey);
  const { data } = await store.supabase.auth.getSession();
  store.user = data.session?.user || null;
  updateAuthUi();
  store.supabase.auth.onAuthStateChange(async (_event, session) => {
    store.user = session?.user || null;
    updateAuthUi();
    if (store.user) await syncFromCloud();
  });
  if (store.user) await syncFromCloud();
}

function updateAuthUi() {
  if (!authReady()) {
    setAuthStatus("Chưa cấu hình Supabase.");
    return;
  }
  setAuthStatus(store.user ? `Đã đăng nhập: ${store.user.email}` : "Chưa đăng nhập. Nhập email để nhận magic link.");
}

async function login() {
  if (!authReady()) {
    setAuthStatus("Thiếu Supabase URL/key trong config.js.");
    return;
  }
  const email = els.emailInput.value.trim();
  if (!email) {
    setAuthStatus("Nhập email trước.");
    return;
  }
  const { error } = await store.supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  setAuthStatus(error ? `Lỗi đăng nhập: ${error.message}` : "Đã gửi link đăng nhập. Mở email để xác nhận.");
}

async function logout() {
  if (!store.supabase) return;
  await store.supabase.auth.signOut();
  store.user = null;
  updateAuthUi();
}

function mergeCards(localCards, cloudCards) {
  const map = new Map();
  [...cloudCards, ...localCards].forEach((card) => map.set(card.id, withMeta(card)));
  return [...map.values()];
}

async function syncFromCloud() {
  if (!store.supabase || !store.user) return;
  const { data, error } = await store.supabase.from("mandarin_decks").select("cards").eq("user_id", store.user.id).maybeSingle();
  if (error) {
    setAuthStatus(`Không tải được dữ liệu cloud: ${error.message}`);
    return;
  }
  if (data?.cards?.length) {
    store.cards = mergeCards(store.cards, data.cards);
    save();
  }
  await syncToCloud();
  render();
}

async function syncToCloud() {
  if (!store.supabase || !store.user) {
    setAuthStatus("Cần đăng nhập trước khi đồng bộ.");
    return;
  }
  const { error } = await store.supabase.from("mandarin_decks").upsert({
    user_id: store.user.id,
    cards: store.cards,
    updated_at: new Date().toISOString()
  });
  setAuthStatus(error ? `Đồng bộ lỗi: ${error.message}` : `Đã đồng bộ ${store.cards.length} thẻ.`);
}

function withMeta(card) {
  return {
    id: card.id || `card-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    hanzi: card.hanzi,
    pinyin: card.pinyin || inferPinyin(card.hanzi),
    meaning: card.meaning || inferMeaning(card.hanzi),
    example: card.example || card.hanzi,
    source: card.source || "manual",
    due: card.due || 0,
    createdAt: card.createdAt || new Date().toISOString()
  };
}

function chineseChunks(text) {
  const matches = text.match(/[\u3400-\u9fff]{1,24}/g) || [];
  return [...new Set(matches.map((item) => item.trim()).filter(Boolean))];
}

function inferPinyin(text) {
  return [...text].map((char) => miniDict[char]?.[0] || "?").join(" ");
}

function inferMeaning(text) {
  const parts = [...text].map((char) => miniDict[char]?.[1]).filter(Boolean);
  return parts.length ? parts.join(" / ") : "cần bổ sung nghĩa";
}

function activeCard() {
  if (!store.activeId) store.activeId = pickNextCard()?.id || store.cards[0]?.id;
  return store.cards.find((card) => card.id === store.activeId) || store.cards[0];
}

function pickNextCard() {
  const due = store.cards.filter((card) => (card.due || 0) <= Date.now());
  return due[0] || store.cards[0];
}

function setStatus(message) {
  els.statusText.textContent = message;
}

function render() {
  const query = els.searchInput.value.trim().toLowerCase();
  const cards = store.cards.filter((card) =>
    [card.hanzi, card.pinyin, card.meaning, card.example].join(" ").toLowerCase().includes(query)
  );
  els.cardCount.textContent = store.cards.length;
  els.dueCount.textContent = store.cards.filter((card) => (card.due || 0) <= Date.now()).length;
  renderDrafts(cards.slice(0, 8));
  renderStudy();
  renderLibrary(cards);
  els.remoteUrl.textContent = location.protocol === "file:" ? "Chạy web server để có URL truy cập từ máy khác." : location.href;
}

function renderDrafts(cards) {
  els.draftList.innerHTML = cards.length
    ? cards.map(cardTemplate).join("")
    : `<p class="meta">Chưa có thẻ. Nhập text tiếng Trung rồi bấm Tạo thẻ học.</p>`;
}

function renderStudy() {
  const card = activeCard();
  if (!card) {
    els.studyCard.innerHTML = `<p class="meta">Chưa có thẻ học.</p>`;
    return;
  }
  els.studyCard.innerHTML = `
    ${els.showHanzi.checked ? `<div class="study-hanzi">${card.hanzi}</div>` : ""}
    ${els.showPinyin.checked ? `<div class="study-line">${card.pinyin}</div>` : ""}
    ${els.showMeaning.checked ? `<div class="study-line">${card.meaning}</div>` : ""}
    ${els.showExample.checked ? `<div class="study-line">${card.example}</div>` : ""}
    ${!els.showHanzi.checked && !els.showPinyin.checked && !els.showMeaning.checked && !els.showExample.checked ? `<div class="study-line">Tất cả đang ẩn</div>` : ""}
  `;
}

function renderLibrary(cards) {
  els.libraryList.innerHTML = cards.length
    ? cards.map(cardTemplate).join("")
    : `<p class="meta">Không có thẻ phù hợp.</p>`;
}

function cardTemplate(card) {
  return `
    <article class="mini-card">
      <div class="hanzi">${card.hanzi}</div>
      <div>
        <strong>${card.pinyin}</strong>
        <div class="meta">${card.meaning}</div>
        <div class="meta">${card.example}</div>
      </div>
      <button class="secondary" data-study="${card.id}" type="button">Học</button>
    </article>
  `;
}

function createCards() {
  const text = els.sourceText.value.trim();
  if (!text) {
    setStatus("Chưa có nội dung tiếng Trung.");
    return;
  }
  const chunks = chineseChunks(text);
  if (!chunks.length) {
    setStatus("Không tìm thấy Hán tự trong nội dung.");
    return;
  }
  const newCards = chunks.map((chunk) => withMeta({ hanzi: chunk, example: text, source: "input" }));
  store.cards = [...newCards, ...store.cards];
  store.activeId = newCards[0].id;
  save();
  syncToCloud();
  setStatus(`Đã tạo ${newCards.length} thẻ mới.`);
  switchView("study");
  render();
}

function switchView(view) {
  store.view = view;
  document.querySelectorAll(".tab").forEach((tab) => tab.classList.toggle("active", tab.dataset.view === view));
  document.querySelectorAll(".view").forEach((panel) => panel.classList.toggle("active", panel.id === `${view}View`));
}

function review(rating) {
  const card = activeCard();
  if (!card) return;
  card.due = Date.now() + intervals[rating];
  save();
  syncToCloud();
  store.activeId = pickNextCard()?.id || card.id;
  setStatus(`Đã lưu mức "${rating}".`);
  render();
}

function exportData() {
  const blob = new Blob([JSON.stringify({ version: 1, cards: store.cards }, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `mandarin-capture-${Date.now()}.json`;
  link.click();
  URL.revokeObjectURL(url);
}

function importData(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(String(reader.result || "{}"));
      if (!Array.isArray(data.cards)) throw new Error("Invalid backup");
      store.cards = data.cards.map(withMeta);
      store.activeId = store.cards[0]?.id || null;
      save();
      setStatus(`Đã nhập ${store.cards.length} thẻ.`);
      render();
    } catch {
      setStatus("File backup không hợp lệ.");
    }
  };
  reader.readAsText(file);
}

document.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button) return;
  if (button.dataset.view) switchView(button.dataset.view);
  if (button.dataset.study) {
    store.activeId = button.dataset.study;
    switchView("study");
    render();
  }
  if (button.dataset.review) review(button.dataset.review);
});

els.createCards.addEventListener("click", createCards);
els.clearInput.addEventListener("click", () => {
  els.sourceText.value = "";
  els.imageInput.value = "";
  els.imagePreview.textContent = "Chưa chọn ảnh";
  setStatus("Đã xóa nhập liệu.");
});
els.imageInput.addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  els.imagePreview.innerHTML = `<img src="${url}" alt="Ảnh nguồn đã chọn" />`;
  setStatus("Đã chọn ảnh. Bản mới hiện lưu ảnh làm nguồn, OCR tự động sẽ tích hợp ở bước tiếp theo.");
});
els.nextCard.addEventListener("click", () => {
  const index = store.cards.findIndex((card) => card.id === activeCard()?.id);
  store.activeId = store.cards[(index + 1) % store.cards.length]?.id;
  render();
});
[els.showHanzi, els.showPinyin, els.showMeaning, els.showExample, els.searchInput].forEach((input) => {
  input.addEventListener("input", render);
  input.addEventListener("change", render);
});
els.exportData.addEventListener("click", exportData);
els.importData.addEventListener("change", (event) => importData(event.target.files?.[0]));
els.loginButton.addEventListener("click", login);
els.logoutButton.addEventListener("click", logout);
els.syncButton.addEventListener("click", syncToCloud);

render();
initAuth();

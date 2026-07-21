"use strict";

const STORAGE_KEY = "bingo-master-ultimate-v1";
const PRESENTATION_EVENT_KEY = "bingo-master-ultimate-presenter-event";
const CHANNEL_NAME = "bingo-master-ultimate-presenter";
const DRUM_ROLL_SRC = "sounds/drum-roll.mp3";
const ROLL_FINISH_SRC = "sounds/roll-finish.mp3";
const BGM_PERSIST_LIMIT_BYTES = 3.5 * 1024 * 1024;
const COLUMNS = [
  { letter: "B", min: 1, max: 15 },
  { letter: "I", min: 16, max: 30 },
  { letter: "N", min: 31, max: 45 },
  { letter: "G", min: 46, max: 60 },
  { letter: "O", min: 61, max: 75 }
];

const state = {
  history: [],
  numberData: {},
  settings: {
    maxNumber: 75,
    autoInterval: 4,
    bulkCount: 5,
    allowRedraw: false,
    volume: 45,
    drumVolume: 130,
    theme: "dark",
    mode: "host",
    bgm: false,
    bgmName: "",
    bgmData: "",
    bgmUrl: "",
    bgmTracks: [],
    bgmTrackIndex: 0,
    prizes: ""
  },
  spinning: false,
  autoTimer: null,
  spinTimer: null,
  timer: {
    total: 300,
    remaining: 300,
    id: null
  },
  audio: null,
  sessionBgmUrls: new Set(),
  sessionImageUrls: new Set(),
  sessionImageData: {},
  presentationNumberData: {},
  bgmPausedForRoulette: false,
  drumRollElement: null,
  lastPresentationNumber: null,
  lastPresentationEffectAt: 0
};

const els = {};

document.addEventListener("DOMContentLoaded", () => {
  cacheElements();
  loadState();
  bindEvents();
  setupPresentationChannel();
  renderAll();
  if (state.settings.bgm && !isDisplayOnly()) updateBgm();
  registerServiceWorker();
});

function cacheElements() {
  [
    "effectsCanvas", "currentLetter", "currentNumber", "currentTerm", "currentDescription", "drawDisplay",
    "startBtn", "stopBtn", "autoBtn", "fastBtn", "bulkBtn", "openDisplayBtn", "resetBtn",
    "historyList", "remainingBadge", "fullscreenBtn", "themeBtn",
    "volumeInput", "maxNumberInput", "autoIntervalInput", "bulkCountInput", "drumVolumeInput",
    "allowRedrawInput", "bgmInput", "bgmFileInput", "bgmFileName", "bgmUrlInput", "bgmUrlAddBtn",
    "bgmTrackSelect", "bgmPlayBtn", "bgmPrevBtn", "bgmNextBtn", "bgmRemoveBtn",
    "adminPanel",
    "timerText", "timerMinutesInput", "timerStartBtn", "timerResetBtn", "prizesInput",
    "exportJsonBtn", "exportCsvBtn", "importInput", "searchInput", "addDataBtn",
    "dataTableBody", "detailModal", "modalMedia", "modalCategory", "modalTitle",
    "modalDescription", "modalUrl", "modalMemo", "modalTags", "editModal", "editForm", "editTitle",
    "editOriginalNumber", "editNumber", "editTerm", "editImageFile", "editImage",
    "editIcon", "editCategory", "editUrl", "editMemo", "editColor", "editTags",
    "deleteDataBtn"
  ].forEach((id) => {
    els[id] = document.getElementById(id);
  });
}

function bindEvents() {
  els.startBtn.addEventListener("click", startSpin);
  els.stopBtn.addEventListener("click", stopSpinAndDraw);
  els.autoBtn.addEventListener("click", toggleAuto);
  els.fastBtn.addEventListener("click", () => drawNumber({ fast: true }));
  els.bulkBtn.addEventListener("click", bulkDraw);
  els.openDisplayBtn.addEventListener("click", openDisplayWindow);
  els.resetBtn.addEventListener("click", resetDraws);
  els.fullscreenBtn.addEventListener("click", toggleFullscreen);
  els.themeBtn.addEventListener("click", cycleTheme);
  els.exportJsonBtn.addEventListener("click", exportJson);
  els.exportCsvBtn.addEventListener("click", exportCsv);
  els.importInput.addEventListener("change", importFile);
  els.searchInput.addEventListener("input", renderDataTable);
  els.addDataBtn.addEventListener("click", () => openEditModal());
  els.editForm.addEventListener("submit", saveEditedData);
  els.editImageFile.addEventListener("change", importEditImage);
  els.deleteDataBtn.addEventListener("click", deleteEditedData);
  els.timerStartBtn.addEventListener("click", toggleTimer);
  els.timerResetBtn.addEventListener("click", resetTimer);
  document.querySelectorAll("dialog .close").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });

  ["maxNumberInput", "autoIntervalInput", "bulkCountInput", "drumVolumeInput"].forEach((id) => {
    els[id].addEventListener("change", updateNumericSetting);
  });
  els.drumVolumeInput.addEventListener("input", updateNumericSetting);
  els.allowRedrawInput.addEventListener("change", () => updateSetting("allowRedraw", els.allowRedrawInput.checked));
  els.bgmInput.addEventListener("change", () => {
    updateSetting("bgm", els.bgmInput.checked);
    if (els.bgmInput.checked) {
      updateBgm();
    } else {
      stopBgm();
      state.bgmPausedForRoulette = false;
    }
    broadcastPresentation({ type: "bgm-update" });
  });
  els.bgmFileInput.addEventListener("change", importBgmFile);
  els.bgmUrlInput.addEventListener("change", updateBgmUrl);
  els.bgmUrlInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    updateBgmUrl();
  });
  els.bgmUrlAddBtn.addEventListener("click", updateBgmUrl);
  els.bgmTrackSelect.addEventListener("change", selectBgmTrack);
  els.bgmPlayBtn.addEventListener("click", playSelectedBgm);
  els.bgmPrevBtn.addEventListener("click", () => stepBgmTrack(-1));
  els.bgmNextBtn.addEventListener("click", () => stepBgmTrack(1));
  els.bgmRemoveBtn.addEventListener("click", removeSelectedBgmTrack);
  els.volumeInput.addEventListener("input", () => {
    updateSetting("volume", Number(els.volumeInput.value));
    updateBgmVolume();
    broadcastPresentation({ type: "bgm-update" });
  });
  els.prizesInput.addEventListener("input", () => updateSetting("prizes", sanitizeText(els.prizesInput.value, 2000)));

  window.addEventListener("resize", resizeCanvas);
  window.addEventListener("beforeunload", revokeSessionBgmUrls);
  window.addEventListener("beforeunload", revokeSessionImageUrls);
  document.body.addEventListener("click", retryBgmAfterGesture, { passive: true });
  window.addEventListener("storage", (event) => {
    if (event.key === PRESENTATION_EVENT_KEY && event.newValue) {
      try {
        handlePresentationMessage(JSON.parse(event.newValue).message);
      } catch {}
      return;
    }
    if (event.key === STORAGE_KEY) {
      const previous = state.history.at(-1);
      loadState();
      renderAll();
      const current = state.history.at(-1);
      if (isDisplayOnly() && current && current !== previous) {
        playPresentationResult(100);
      }
    }
  });
  resizeCanvas();
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    if (Array.isArray(saved.history)) {
      state.history = saved.history.filter((n) => Number.isInteger(n) && n > 0 && n <= 150);
    }
    if (saved.numberData && typeof saved.numberData === "object") {
      state.numberData = normalizeNumberData(saved.numberData);
    }
    if (saved.settings && typeof saved.settings === "object") {
      Object.assign(state.settings, normalizeSettings(saved.settings));
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    history: state.history,
    numberData: serializeNumberData(),
    settings: serializeSettings()
  }));
}

function saveStateSafely(message = "") {
  try {
    saveState();
    return true;
  } catch {
    if (message) alert(message);
    return false;
  }
}

function serializeSettings() {
  const persistentTracks = state.settings.bgmTracks.filter((track) => isPersistentBgmTrack(track));
  const currentIndex = persistentTracks.findIndex((track) => track.id === getCurrentBgmTrack()?.id);
  return {
    ...state.settings,
    bgmTracks: persistentTracks,
    bgmTrackIndex: currentIndex >= 0 ? currentIndex : 0
  };
}

function isPersistentBgmTrack(track) {
  return Boolean(track && !track.temporary && (track.data || (track.url && !track.url.startsWith("blob:"))));
}

function serializeNumberData() {
  const result = {};
  Object.entries(state.numberData).forEach(([number, item]) => {
    result[number] = {
      ...item,
      image: isSessionImageUrl(item.image) ? "" : item.image
    };
  });
  return result;
}

function isSessionImageUrl(url) {
  return Boolean(url && state.sessionImageUrls.has(url));
}

function normalizeSettings(input) {
  return {
    maxNumber: clampNumber(input.maxNumber, 1, 150, 75),
    autoInterval: clampNumber(input.autoInterval, 1, 20, 4),
    bulkCount: clampNumber(input.bulkCount, 1, 75, 5),
    allowRedraw: Boolean(input.allowRedraw),
    volume: clampNumber(input.volume, 0, 100, 45),
    drumVolume: clampNumber(input.drumVolume, 0, 200, 130),
    theme: ["light", "dark", "neon"].includes(input.theme) ? input.theme : "dark",
    bgm: Boolean(input.bgm),
    bgmName: sanitizeText(input.bgmName || "", 120),
    bgmData: sanitizeAudioData(input.bgmData || ""),
    bgmUrl: sanitizeUrl(input.bgmUrl || ""),
    bgmTracks: normalizeBgmTracks(input.bgmTracks, input),
    bgmTrackIndex: clampNumber(input.bgmTrackIndex, 0, 999, 0),
    prizes: sanitizeText(input.prizes || "", 2000)
  };
}

function normalizeBgmTracks(tracks, legacy = {}) {
  const result = [];
  if (Array.isArray(tracks)) {
    tracks.forEach((track) => {
      const clean = cleanBgmTrack(track);
      if (clean) result.push(clean);
    });
  }
  if (!result.length && (legacy.bgmData || legacy.bgmUrl)) {
    const clean = cleanBgmTrack({
      name: legacy.bgmName || (legacy.bgmUrl ? "URL BGM" : "BGM"),
      data: legacy.bgmData || "",
      url: legacy.bgmUrl || ""
    });
    if (clean) result.push(clean);
  }
  return result.slice(0, 20);
}

function cleanBgmTrack(track) {
  if (!track || typeof track !== "object") return null;
  const data = sanitizeAudioData(track.data || "");
  const url = sanitizeAudioUrl(track.url || "");
  if (!data && !url) return null;
  const temporary = Boolean(track.temporary || url.startsWith("blob:"));
  return {
    id: sanitizeText(track.id || `${Date.now()}-${Math.random()}`, 80),
    name: sanitizeText(track.name || (url ? "URL BGM" : "BGM"), 120),
    data,
    url,
    temporary
  };
}

function normalizeNumberData(input) {
  const result = {};
  Object.values(input).forEach((item) => {
    const clean = cleanDataItem(item);
    if (clean) result[clean.number] = clean;
  });
  return result;
}

function cleanDataItem(item) {
  if (!item || typeof item !== "object") return null;
  const number = clampNumber(item.number, 1, 150, NaN);
  if (!Number.isInteger(number)) return null;
  return {
    number,
    term: sanitizeText(item.term, 80),
    description: sanitizeText(item.description, 1200),
    image: sanitizeImageUrl(item.image),
    icon: sanitizeText(item.icon, 12),
    category: sanitizeText(item.category, 40),
    url: sanitizeUrl(item.url),
    memo: sanitizeText(item.memo, 1000),
    color: /^#[0-9a-f]{6}$/i.test(item.color || "") ? item.color : "#00a896",
    tags: Array.isArray(item.tags)
      ? item.tags.map((tag) => sanitizeText(tag, 30)).filter(Boolean).slice(0, 12)
      : sanitizeText(item.tags, 240).split(",").map((tag) => tag.trim()).filter(Boolean).slice(0, 12)
  };
}

function renderAll() {
  applySettingsToInputs();
  renderHistory();
  renderCurrent();
  renderDataTable();
  renderTimer();
  document.body.className = `theme-${state.settings.theme}${isDisplayOnly() ? " display-only" : ""}`;
}

function applySettingsToInputs() {
  els.maxNumberInput.value = state.settings.maxNumber;
  els.autoIntervalInput.value = state.settings.autoInterval;
  els.bulkCountInput.value = state.settings.bulkCount;
  els.drumVolumeInput.value = state.settings.drumVolume;
  els.allowRedrawInput.checked = state.settings.allowRedraw;
  els.volumeInput.value = state.settings.volume;
  els.bgmInput.checked = state.settings.bgm;
  renderBgmTracks();
  els.bgmUrlInput.value = "";
  els.prizesInput.value = state.settings.prizes;
}

function renderBgmTracks() {
  const tracks = state.settings.bgmTracks;
  if (state.settings.bgmTrackIndex >= tracks.length) state.settings.bgmTrackIndex = Math.max(0, tracks.length - 1);
  els.bgmTrackSelect.replaceChildren();
  tracks.forEach((track, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = `${track.name}${track.temporary ? "（一時）" : ""}`;
    els.bgmTrackSelect.append(option);
  });
  els.bgmTrackSelect.disabled = !tracks.length;
  els.bgmTrackSelect.value = String(state.settings.bgmTrackIndex);
  const current = getCurrentBgmTrack();
  els.bgmFileName.textContent = current ? `${tracks.length}曲 / ${current.name}${current.temporary ? "（一時）" : ""}` : "未設定";
  els.bgmPlayBtn.disabled = !tracks.length;
  els.bgmPrevBtn.disabled = tracks.length < 2;
  els.bgmNextBtn.disabled = tracks.length < 2;
  els.bgmRemoveBtn.disabled = !tracks.length;
}

function renderHistory() {
  els.historyList.replaceChildren();
  [...state.history].reverse().forEach((number) => {
    const li = document.createElement("li");
    const data = state.numberData[number];
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `${getLetter(number)}-${number}${data?.term ? ` / ${data.term}` : ""}`;
    button.addEventListener("click", () => openEditModal(number));
    li.append(button);
    els.historyList.append(li);
  });
  const remaining = getAvailableNumbers().length;
  els.remainingBadge.textContent = `${remaining} remaining`;
}

function renderCurrent() {
  const current = state.history.at(-1);
  if (!current) {
    els.drawDisplay.classList.add("idle-title");
    els.currentLetter.textContent = "--";
    els.currentNumber.textContent = "";
    els.currentTerm.textContent = "BINGO Master Ultimate";
    renderWinnerImage(null);
    return;
  }
  els.drawDisplay.classList.remove("idle-title");
  const data = getPresentationData(current);
  els.currentLetter.textContent = getLetter(current);
  els.currentNumber.textContent = String(current);
  els.currentTerm.textContent = data?.term || data?.category || "名称未登録";
  renderWinnerImage(data?.image || "");
}

function getPresentationData(number) {
  return state.presentationNumberData[number] || state.numberData[number] || defaultDataItem(number);
}

function renderWinnerImage(src) {
  els.currentDescription.replaceChildren();
  els.currentDescription.hidden = !src;
  els.drawDisplay.classList.toggle("has-image", Boolean(src));
  if (!src) return;
  const img = document.createElement("img");
  img.src = src;
  img.alt = "当選画像";
  img.referrerPolicy = "no-referrer";
  els.currentDescription.append(img);
}

function renderDataTable() {
  const query = els.searchInput.value.trim().toLowerCase();
  els.dataTableBody.replaceChildren();
  const rows = range(1, state.settings.maxNumber)
    .map((number) => state.numberData[number] || defaultDataItem(number))
    .filter((item) => !query || [
      String(item.number), item.term, item.description, item.category, item.tags.join(" ")
    ].join(" ").toLowerCase().includes(query));

  rows.forEach((item) => {
    const tr = document.createElement("tr");
    tr.dataset.number = String(item.number);
    tr.append(
      tableCell(`${getLetter(item.number)}-${item.number}`),
      quickEditCell("term", item.term, "名称"),
      imageInsertCell(item)
    );
    const actionCell = document.createElement("td");
    actionCell.className = "row-actions";
    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "保存";
    saveButton.className = "primary";
    saveButton.addEventListener("click", () => saveQuickEditRow(tr));
    const moreButton = document.createElement("button");
    moreButton.type = "button";
    moreButton.textContent = "詳細";
    moreButton.addEventListener("click", () => openEditModal(item.number));
    actionCell.append(saveButton, moreButton);
    tr.append(actionCell);
    els.dataTableBody.append(tr);
  });
}

function tableCell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

function quickEditCell(field, value, label) {
  const td = document.createElement("td");
  const input = field === "description" ? document.createElement("textarea") : document.createElement("input");
  input.dataset.field = field;
  input.value = value || "";
  input.placeholder = label;
  input.setAttribute("aria-label", label);
  if (field === "description") input.rows = 2;
  td.append(input);
  return td;
}

function imageInsertCell(item) {
  const td = document.createElement("td");
  td.className = "image-insert-cell";
  const preview = document.createElement("div");
  preview.className = "image-preview";
  if (item.image) {
    const img = document.createElement("img");
    img.src = item.image;
    img.alt = `${item.number} image`;
    preview.append(img);
  } else {
    preview.textContent = "未設定";
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/*";
  input.dataset.field = "image";
  input.setAttribute("aria-label", "画像挿入");
  input.addEventListener("change", () => importRowImage(item.number, input.files?.[0]));
  td.append(preview, input);
  return td;
}

function saveQuickEditRow(row) {
  const number = Number(row.dataset.number);
  const current = state.numberData[number] || defaultDataItem(number);
  const term = row.querySelector('[data-field="term"]').value;
  const item = cleanDataItem({
    ...current,
    number,
    term
  });
  if (!item) return alert("番号データの形式を確認してください。");
  state.numberData[number] = item;
  saveState();
  renderHistory();
  renderCurrent();
  renderDataTable();
}

function importRowImage(number, file) {
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("画像ファイルを選択してください。");
    return;
  }
  const current = state.numberData[number] || defaultDataItem(number);
  revokeSessionImageUrl(current.image);
  const url = URL.createObjectURL(file);
  state.sessionImageUrls.add(url);
  readSessionImageData(number, file);
  const item = cleanDataItem({
    ...current,
    number,
    image: url
  });
  if (!item) return;
  state.numberData[number] = item;
  renderCurrent();
  renderDataTable();
}

function importEditImage(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  if (!file.type.startsWith("image/")) {
    alert("画像ファイルを選択してください。");
    event.target.value = "";
    return;
  }
  revokeSessionImageUrl(els.editImage.value);
  const url = URL.createObjectURL(file);
  state.sessionImageUrls.add(url);
  els.editImage.value = url;
  readSessionImageData(Number(els.editNumber.value), file);
}

function readSessionImageData(number, file) {
  if (!number || !file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const data = String(reader.result || "");
    if (/^data:image\//i.test(data)) {
      state.sessionImageData[number] = data;
    }
  };
  reader.readAsDataURL(file);
}

function revokeSessionImageUrl(url) {
  if (!url || !state.sessionImageUrls.has(url)) return;
  URL.revokeObjectURL(url);
  state.sessionImageUrls.delete(url);
}

function revokeSessionImageUrls() {
  state.sessionImageUrls.forEach((url) => URL.revokeObjectURL(url));
  state.sessionImageUrls.clear();
}

function startSpin() {
  const available = getAvailableNumbers();
  if (!available.length) return;
  ensureAudio();
  pauseBgmForRoulette();
  startDrumRoll();
  startSpinPreview(available);
  broadcastPresentation({ type: "spin-start", available });
}

function startSpinPreview(available) {
  ensureAudio();
  pauseBgmForRoulette();
  startDrumRoll();
  state.spinning = true;
  els.drawDisplay.classList.remove("idle-title");
  els.drawDisplay.classList.add("spinning");
  renderWinnerImage(null);
  if (els.startBtn) els.startBtn.disabled = true;
  if (els.stopBtn) els.stopBtn.disabled = false;
  clearInterval(state.spinTimer);
  state.spinTimer = setInterval(() => {
    const preview = available[Math.floor(Math.random() * available.length)];
    els.currentLetter.textContent = getLetter(preview);
    els.currentNumber.textContent = String(preview);
    els.currentTerm.textContent = "回転中...";
    renderWinnerImage(null);
  }, 70);
}

function stopSpinAndDraw() {
  stopSpinPreview();
  setTimeout(() => drawNumber(), 180);
}

function stopSpinPreview() {
  clearInterval(state.spinTimer);
  state.spinning = false;
  els.drawDisplay.classList.remove("spinning");
  if (els.startBtn) els.startBtn.disabled = false;
  if (els.stopBtn) els.stopBtn.disabled = true;
}

function drawNumber(options = {}) {
  const available = getAvailableNumbers();
  if (!available.length) {
    stopAuto();
    return;
  }
  const number = available[Math.floor(Math.random() * available.length)];
  state.history.push(number);
  if (!options.silent) {
    ensureAudio();
    stopDrumRoll();
    playCymbal();
    launchEffects(options.fast ? 70 : 190);
    triggerWinnerAnimation();
    if (!state.autoTimer) resumeBgmAfterRoulette();
  }
  saveState();
  renderHistory();
  renderCurrent();
  if (!options.silent) {
    broadcastPresentation({
      type: "draw-result",
      number,
      effectCount: options.fast ? 70 : 190,
      item: buildPresentationItem(number)
    });
  }
}

function buildPresentationItem(number) {
  const item = state.numberData[number] || defaultDataItem(number);
  return {
    ...item,
    image: state.sessionImageData[number] || item.image
  };
}

function getAvailableNumbers() {
  const all = range(1, state.settings.maxNumber);
  if (state.settings.allowRedraw) return all;
  const drawn = new Set(state.history);
  return all.filter((number) => !drawn.has(number));
}

function bulkDraw() {
  const count = Math.min(state.settings.bulkCount, getAvailableNumbers().length);
  for (let i = 0; i < count; i += 1) {
    drawNumber({ silent: i < count - 1, fast: true });
  }
}

function toggleAuto() {
  if (state.autoTimer) {
    stopAuto();
    return;
  }
  els.autoBtn.textContent = "自動停止";
  runAutoDrawCycle();
}

function stopAuto() {
  clearTimeout(state.autoTimer);
  state.autoTimer = null;
  if (state.spinning) {
    stopSpinPreview();
    stopDrumRoll();
    resumeBgmAfterRoulette();
  }
  els.autoBtn.textContent = "自動抽選";
}

function runAutoDrawCycle() {
  const available = getAvailableNumbers();
  if (!available.length) {
    stopAuto();
    return;
  }
  const intervalMs = state.settings.autoInterval * 1000;
  const spinMs = Math.min(2600, Math.max(1000, Math.floor(intervalMs * 0.45)));
  startSpin();
  state.autoTimer = setTimeout(() => {
    stopSpinPreview();
    drawNumber();
    const restMs = Math.max(800, intervalMs - spinMs);
    state.autoTimer = setTimeout(runAutoDrawCycle, restMs);
  }, spinMs);
}

function resetDraws() {
  if (!confirm("抽選履歴をリセットしますか？")) return;
  stopAuto();
  state.history = [];
  saveState();
  renderAll();
}

function openDetailModal(number) {
  const data = state.numberData[number] || defaultDataItem(number);
  els.modalCategory.textContent = data.category || "No category";
  els.modalTitle.textContent = `${getLetter(number)}-${number} ${data.icon || ""}`;
  els.modalDescription.textContent = data.image ? "画像登録済み" : "画像は未登録です。";
  els.modalUrl.textContent = data.url || "-";
  els.modalUrl.href = data.url || "#";
  els.modalMemo.textContent = data.memo || "-";
  els.modalTags.textContent = data.tags.join(", ") || "-";
  els.modalMedia.replaceChildren();
  if (data.image) {
    const img = document.createElement("img");
    img.src = data.image;
    img.alt = data.term || `${number} image`;
    img.referrerPolicy = "no-referrer";
    els.modalMedia.append(img);
  } else {
    els.modalMedia.textContent = data.icon || getLetter(number);
  }
  els.detailModal.showModal();
}

function openEditModal(number = null) {
  const data = number ? (state.numberData[number] || defaultDataItem(number)) : defaultDataItem(nextBlankNumber());
  els.editTitle.textContent = number ? "番号データ編集" : "番号データ追加";
  els.editOriginalNumber.value = number || "";
  els.editNumber.value = data.number;
  els.editTerm.value = data.term;
  els.editImageFile.value = "";
  els.editImage.value = data.image;
  els.editIcon.value = data.icon;
  els.editCategory.value = data.category;
  els.editUrl.value = data.url;
  els.editMemo.value = data.memo;
  els.editColor.value = data.color;
  els.editTags.value = data.tags.join(", ");
  els.deleteDataBtn.hidden = !number;
  els.editModal.showModal();
}

function saveEditedData(event) {
  event.preventDefault();
  const item = cleanDataItem({
    number: Number(els.editNumber.value),
    term: els.editTerm.value,
    description: "",
    image: els.editImage.value,
    icon: els.editIcon.value,
    category: els.editCategory.value,
    url: els.editUrl.value,
    memo: els.editMemo.value,
    color: els.editColor.value,
    tags: els.editTags.value
  });
  if (!item) return alert("番号データの形式を確認してください。");
  const original = Number(els.editOriginalNumber.value);
  if (original && original !== item.number) {
    delete state.numberData[original];
    if (state.sessionImageData[original]) {
      state.sessionImageData[item.number] = state.sessionImageData[original];
      delete state.sessionImageData[original];
    }
  }
  state.numberData[item.number] = item;
  state.settings.maxNumber = Math.max(state.settings.maxNumber, item.number);
  saveState();
  els.editModal.close();
  renderAll();
}

function deleteEditedData() {
  const number = Number(els.editOriginalNumber.value);
  if (!number || !confirm("この番号データを削除しますか？")) return;
  revokeSessionImageUrl(state.numberData[number]?.image);
  delete state.sessionImageData[number];
  delete state.numberData[number];
  saveState();
  els.editModal.close();
  renderAll();
}

function defaultDataItem(number) {
  return {
    number,
    term: "",
    description: "",
    image: "",
    icon: "",
    category: "",
    url: "",
    memo: "",
    color: "#00a896",
    tags: []
  };
}

function nextBlankNumber() {
  for (const number of range(1, state.settings.maxNumber)) {
    if (!state.numberData[number]) return number;
  }
  return Math.min(state.settings.maxNumber + 1, 150);
}

function updateNumericSetting(event) {
  const map = {
    maxNumberInput: ["maxNumber", 1, 150, 75],
    autoIntervalInput: ["autoInterval", 1, 20, 4],
    bulkCountInput: ["bulkCount", 1, 75, 5],
    drumVolumeInput: ["drumVolume", 0, 200, 130]
  };
  const [key, min, max, fallback] = map[event.target.id];
  updateSetting(key, clampNumber(event.target.value, min, max, fallback));
  if (key === "drumVolume") updateBgmVolume();
}

function updateSetting(key, value) {
  state.settings[key] = value;
  if (key === "maxNumber") {
    state.history = state.history.filter((number) => number <= value);
  }
  saveState();
  renderAll();
}

function cycleTheme() {
  const themes = ["dark", "light", "neon"];
  const next = themes[(themes.indexOf(state.settings.theme) + 1) % themes.length];
  updateSetting("theme", next);
}

function toggleFullscreen() {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    document.documentElement.requestFullscreen().catch(() => {});
  }
}

function openDisplayWindow() {
  const url = new URL(window.location.href);
  url.searchParams.set("display", "1");
  window.open(url.href, "bingo-master-display", "popup=yes,width=1280,height=720");
}

function isDisplayOnly() {
  return new URLSearchParams(window.location.search).get("display") === "1";
}

function setupPresentationChannel() {
  if (!("BroadcastChannel" in window)) return;
  state.channel = new BroadcastChannel(CHANNEL_NAME);
  state.channel.addEventListener("message", (event) => {
    handlePresentationMessage(event.data || {});
  });
}

function broadcastPresentation(message) {
  state.channel?.postMessage(message);
  try {
    localStorage.setItem(PRESENTATION_EVENT_KEY, JSON.stringify({
      id: `${Date.now()}-${Math.random()}`,
      message
    }));
  } catch {}
}

function handlePresentationMessage(message) {
  if (!isDisplayOnly() || !message) return;
  if (message.type === "spin-start" && Array.isArray(message.available)) {
    startSpinPreview(message.available);
  }
  if (message.type === "draw-result") {
    loadState();
    if (message.item?.number) {
      const item = cleanDataItem({ ...message.item, image: "" }) || defaultDataItem(message.item.number);
      item.image = sanitizeTransientImageSource(message.item.image);
      state.presentationNumberData[item.number] = item;
    }
    renderAll();
    playPresentationResult(message.effectCount || 100);
  }
  if (message.type === "bgm-update") {
    loadState();
    renderAll();
    updateBgm();
  }
}

function playPresentationResult(effectCount) {
  const current = state.history.at(-1);
  const now = Date.now();
  if (current === state.lastPresentationNumber && now - state.lastPresentationEffectAt < 1000) return;
  state.lastPresentationNumber = current;
  state.lastPresentationEffectAt = now;
  stopSpinPreview();
  ensureAudio();
  stopDrumRoll();
  playCymbal();
  launchEffects(effectCount);
  triggerWinnerAnimation();
  resumeBgmAfterRoulette();
}

function exportJson() {
  downloadFile("bingo-master-ultimate.json", JSON.stringify({
    version: "1.0",
    exportedAt: new Date().toISOString(),
    history: state.history,
    numberData: Object.values(state.numberData),
    settings: state.settings
  }, null, 2), "application/json");
}

function exportCsv() {
  const rows = [["number", "term", "description", "image", "icon", "category", "url", "memo", "color", "tags"]];
  range(1, state.settings.maxNumber).forEach((number) => {
    const item = state.numberData[number] || defaultDataItem(number);
    rows.push([
      item.number, item.term, item.description, item.image, item.icon, item.category,
      item.url, item.memo, item.color, item.tags.join("|")
    ]);
  });
  const csv = rows.map((row) => row.map(csvEscape).join(",")).join("\n");
  downloadFile("bingo-master-ultimate.csv", csv, "text/csv");
}

function importFile(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const text = String(reader.result || "");
      if (file.name.toLowerCase().endsWith(".json")) {
        importJson(text);
      } else {
        importCsv(text);
      }
      saveState();
      renderAll();
      alert("読み込みが完了しました。");
    } catch (error) {
      alert(`読み込みに失敗しました: ${error.message}`);
    } finally {
      event.target.value = "";
    }
  };
  reader.readAsText(file);
}

function importJson(text) {
  const parsed = JSON.parse(text);
  if (!parsed || typeof parsed !== "object") throw new Error("JSON形式が不正です。");
  const rows = Array.isArray(parsed.numberData) ? parsed.numberData : Object.values(parsed.numberData || {});
  state.numberData = normalizeNumberData(rows);
  if (Array.isArray(parsed.history)) {
    state.history = parsed.history.map(Number).filter((n) => Number.isInteger(n) && n > 0 && n <= 150);
  }
  if (parsed.settings) {
    Object.assign(state.settings, normalizeSettings(parsed.settings));
  }
}

function importCsv(text) {
  const rows = parseCsv(text);
  const headers = rows.shift()?.map((header) => header.trim()) || [];
  if (!headers.includes("number")) throw new Error("number列が必要です。");
  const items = rows.map((row) => {
    const record = {};
    headers.forEach((header, index) => {
      record[header] = row[index] || "";
    });
    record.tags = String(record.tags || "").split("|");
    return record;
  });
  state.numberData = normalizeNumberData(items);
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === "\"" && quoted && next === "\"") {
      cell += "\"";
      i += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cellValue) => cellValue.trim()));
}

function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.style.display = "none";
  document.body.append(link);
  link.click();
  setTimeout(() => {
    link.remove();
    URL.revokeObjectURL(url);
  }, 300);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll("\"", "\"\"")}"` : text;
}

function toggleTimer() {
  if (state.timer.id) {
    clearInterval(state.timer.id);
    state.timer.id = null;
    els.timerStartBtn.textContent = "開始";
    return;
  }
  if (state.timer.remaining <= 0) resetTimer();
  els.timerStartBtn.textContent = "停止";
  state.timer.id = setInterval(() => {
    state.timer.remaining -= 1;
    renderTimer();
    if (state.timer.remaining <= 0) {
      clearInterval(state.timer.id);
      state.timer.id = null;
      els.timerStartBtn.textContent = "開始";
      launchEffects(120);
      playTone(880, 0.5, "square");
    }
  }, 1000);
}

function resetTimer() {
  clearInterval(state.timer.id);
  const minutes = clampNumber(els.timerMinutesInput.value, 1, 180, 5);
  state.timer.total = minutes * 60;
  state.timer.remaining = state.timer.total;
  state.timer.id = null;
  els.timerStartBtn.textContent = "開始";
  renderTimer();
}

function renderTimer() {
  const minutes = Math.floor(state.timer.remaining / 60);
  const seconds = state.timer.remaining % 60;
  els.timerText.textContent = `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function ensureAudio() {
  if (!state.audio) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    state.audio = {
      context: AudioContext ? new AudioContext() : null,
      bgmOsc: null,
      bgmElement: null,
      bgmElements: new Set(),
      bgmGain: null
    };
  }
  if (state.audio.context?.state === "suspended") state.audio.context.resume();
}

function playTone(frequency, seconds, type = "sine") {
  if (isDisplayOnly()) return;
  if (!state.audio?.context || state.settings.volume <= 0) return;
  const ctx = state.audio.context;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.frequency.value = frequency;
  osc.type = type;
  gain.gain.value = state.settings.volume / 450;
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + seconds);
  osc.connect(gain).connect(ctx.destination);
  osc.start();
  osc.stop(ctx.currentTime + seconds);
}

function startDrumRoll() {
  if (isDisplayOnly()) return;
  if (state.settings.volume <= 0 || state.settings.drumVolume <= 0 || state.drumRollElement) return;
  const audio = new Audio(DRUM_ROLL_SRC);
  audio.loop = true;
  audio.volume = effectVolume(state.settings.drumVolume);
  state.drumRollElement = audio;
  audio.play().catch(() => {
    state.drumRollElement = null;
  });
}

function stopDrumRoll() {
  if (!state.drumRollElement) return;
  state.drumRollElement.pause();
  state.drumRollElement.currentTime = 0;
  state.drumRollElement = null;
}

function playCymbal() {
  if (isDisplayOnly()) return;
  if (state.settings.volume <= 0) return;
  const audio = new Audio(ROLL_FINISH_SRC);
  audio.volume = effectVolume(140);
  audio.play().catch(() => {});
}

function effectVolume(multiplier = 100) {
  return Math.min(1, Math.max(0, (state.settings.volume / 100) * (multiplier / 100)));
}

function updateBgm() {
  ensureAudio();
  if (!state.audio) return;
  stopBgm();
  if (isDisplayOnly()) return;
  if (!state.settings.bgm) return;

  const track = getCurrentBgmTrack();
  if (track) {
    const audio = new Audio(track.data || track.url);
    audio.loop = state.settings.bgmTracks.length < 2;
    audio.volume = state.settings.volume / 100;
    state.audio.bgmElement = audio;
    state.audio.bgmElements.add(audio);
    audio.addEventListener("pause", () => {
      if (audio !== state.audio?.bgmElement) state.audio?.bgmElements?.delete(audio);
    });
    audio.addEventListener("ended", () => stepBgmTrack(1, { autoplay: true }));
    audio.play().catch(() => {});
    return;
  }
  if (state.audio.context) {
    const ctx = state.audio.context;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 110;
    gain.gain.value = state.settings.volume / 1800;
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    state.audio.bgmOsc = osc;
    state.audio.bgmGain = gain;
  }
}

function updateBgmUrl() {
  const url = sanitizeAudioUrl(els.bgmUrlInput.value);
  if (els.bgmUrlInput.value.trim() && !url) {
    alert("音声URL、または sounds/bgm.mp3 のような相対パスを入力してください。");
    els.bgmUrlInput.value = "";
    return;
  }
  if (!url) return;
  addBgmTrack({
    name: url.split("/").pop() || "URL BGM",
    url
  });
  els.bgmUrlInput.value = "";
}

function addBgmTrack(track) {
  const clean = cleanBgmTrack(track);
  if (!clean) return;
  state.settings.bgmTracks.push(clean);
  state.settings.bgmTrackIndex = state.settings.bgmTracks.length - 1;
  state.settings.bgm = true;
  state.settings.bgmData = "";
  state.settings.bgmUrl = "";
  state.settings.bgmName = clean.name;
  saveStateSafely("BGMを追加しましたが、保存容量を超えたためこの画面を開いている間だけ使えます。");
  renderAll();
  updateBgm();
  broadcastPresentation({ type: "bgm-update" });
}

function getCurrentBgmTrack() {
  return state.settings.bgmTracks[state.settings.bgmTrackIndex] || null;
}

function selectBgmTrack() {
  state.settings.bgmTrackIndex = clampNumber(els.bgmTrackSelect.value, 0, Math.max(0, state.settings.bgmTracks.length - 1), 0);
  saveState();
  renderAll();
  updateBgm();
}

function playSelectedBgm() {
  if (!state.settings.bgmTracks.length) return;
  state.settings.bgm = true;
  saveStateSafely();
  renderAll();
  if (state.audio?.bgmElement) {
    state.audio.bgmElement.play().catch(() => updateBgm());
    return;
  }
  updateBgm();
}

function stepBgmTrack(direction, options = {}) {
  const tracks = state.settings.bgmTracks;
  if (!tracks.length) return;
  const next = (state.settings.bgmTrackIndex + direction + tracks.length) % tracks.length;
  state.settings.bgmTrackIndex = next;
  saveState();
  renderAll();
  if (options.autoplay || state.settings.bgm) updateBgm();
}

function removeSelectedBgmTrack() {
  const tracks = state.settings.bgmTracks;
  if (!tracks.length) return;
  const [removed] = tracks.splice(state.settings.bgmTrackIndex, 1);
  revokeSessionBgmUrl(removed?.url);
  state.settings.bgmTrackIndex = Math.min(state.settings.bgmTrackIndex, Math.max(0, tracks.length - 1));
  state.settings.bgm = tracks.length ? state.settings.bgm : false;
  saveStateSafely();
  renderAll();
  updateBgm();
}

function revokeSessionBgmUrl(url) {
  if (!url || !state.sessionBgmUrls.has(url)) return;
  URL.revokeObjectURL(url);
  state.sessionBgmUrls.delete(url);
}

function revokeSessionBgmUrls() {
  state.sessionBgmUrls.forEach((url) => URL.revokeObjectURL(url));
  state.sessionBgmUrls.clear();
}

function stopBgm() {
  if (state.audio?.bgmOsc) {
    state.audio.bgmOsc.stop();
    state.audio.bgmOsc = null;
    state.audio.bgmGain = null;
  }
  if (state.audio?.bgmElements) {
    state.audio.bgmElements.forEach((audio) => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    });
    state.audio.bgmElements.clear();
  }
  if (state.audio?.bgmElement) {
    state.audio.bgmElement.pause();
    state.audio.bgmElement.removeAttribute("src");
    state.audio.bgmElement.load();
    state.audio.bgmElement = null;
  }
}

function updateBgmVolume() {
  if (state.audio?.bgmElement) {
    state.audio.bgmElement.volume = state.settings.volume / 100;
  }
  if (state.drumRollElement) {
    state.drumRollElement.volume = effectVolume(state.settings.drumVolume);
  }
  if (state.audio?.bgmGain) {
    state.audio.bgmGain.gain.value = state.settings.volume / 1800;
  }
}

function pauseBgmForRoulette() {
  if (!state.settings.bgm || state.bgmPausedForRoulette) return;
  ensureAudio();
  state.bgmPausedForRoulette = true;
  if (state.audio?.bgmElements?.size) {
    state.audio.bgmElements.forEach((audio) => audio.pause());
  }
  if (state.audio?.bgmElement) {
    state.audio.bgmElement.pause();
  }
  if (state.audio?.bgmOsc) {
    stopBgm();
  }
}

function resumeBgmAfterRoulette() {
  if (!state.bgmPausedForRoulette) return;
  state.bgmPausedForRoulette = false;
  setTimeout(() => {
    if (!state.settings.bgm || isDisplayOnly()) return;
    if (state.audio?.bgmElement) {
      state.audio.bgmElement.play().catch(() => {});
      return;
    }
    updateBgm();
  }, 1100);
}

function retryBgmAfterGesture() {
  if (isDisplayOnly()) return;
  if (!state.settings.bgm) return;
  if (state.spinning || state.bgmPausedForRoulette) return;
  if (state.audio?.bgmElement) {
    if (state.audio.bgmElement.paused) {
      state.audio.bgmElement.play().catch(() => {});
    }
    return;
  }
  if (state.audio?.bgmOsc) return;
  updateBgm();
}

function importBgmFile(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;
  importBgmFilesSequentially(files);
  event.target.value = "";
}

function importBgmFilesSequentially(files) {
  const [file, ...rest] = files;
  if (!file) {
    if (!saveStateSafely()) {
      makeSessionBgmTracksTemporary();
      saveStateSafely();
      alert("一部のBGMは保存容量を超えたため、この画面を開いている間だけ使えます。");
    }
    renderAll();
    updateBgmVolume();
    broadcastPresentation({ type: "bgm-update" });
    return;
  }
  if (!file.type.startsWith("audio/")) {
    alert(`${file.name} は音声ファイルではありません。`);
    importBgmFilesSequentially(rest);
    return;
  }
  const tempUrl = URL.createObjectURL(file);
  state.sessionBgmUrls.add(tempUrl);
  const track = {
    id: `${Date.now()}-${Math.random()}`,
    name: sanitizeText(file.name, 120),
    data: "",
    url: tempUrl,
    temporary: true
  };
  state.settings.bgmTracks.push(track);
  state.settings.bgmTrackIndex = state.settings.bgmTracks.length - 1;
  state.settings.bgm = true;
  state.settings.bgmData = "";
  state.settings.bgmUrl = "";
  state.settings.bgmName = track.name;
  renderAll();
  updateBgm();
  broadcastPresentation({ type: "bgm-update" });

  if (file.size > BGM_PERSIST_LIMIT_BYTES) {
    importBgmFilesSequentially(rest);
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const data = sanitizeAudioData(String(reader.result || ""));
    if (data) {
      track.data = data;
      track.temporary = false;
    }
    importBgmFilesSequentially(rest);
  };
  reader.onerror = () => {
    importBgmFilesSequentially(rest);
  };
  reader.readAsDataURL(file);
}

function makeSessionBgmTracksTemporary() {
  state.settings.bgmTracks.forEach((track) => {
    if (!track.url || !state.sessionBgmUrls.has(track.url)) return;
    track.data = "";
    track.temporary = true;
  });
}

function resizeCanvas() {
  els.effectsCanvas.width = window.innerWidth * window.devicePixelRatio;
  els.effectsCanvas.height = window.innerHeight * window.devicePixelRatio;
}

function launchEffects(count) {
  const canvas = els.effectsCanvas;
  const ctx = canvas.getContext("2d");
  const scale = window.devicePixelRatio || 1;
  const colors = ["#e84a5f", "#00a896", "#f9c74f", "#ffffff", "#31f7c5", "#ff2e88", "#ffe45c"];
  const centerX = canvas.width / 2;
  const centerY = canvas.height * 0.34;
  const particles = Array.from({ length: count }, (_, index) => {
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.7;
    const speed = (Math.random() * 9 + 4) * scale;
    const radial = index % 3 !== 0;
    return {
      x: radial ? centerX : Math.random() * canvas.width,
      y: radial ? centerY : canvas.height * (0.12 + Math.random() * 0.24),
      vx: radial ? Math.cos(angle) * speed : (Math.random() - 0.5) * 11 * scale,
      vy: radial ? Math.sin(angle) * speed - 4 * scale : (Math.random() * -9 - 4) * scale,
      size: (Math.random() * 9 + 4) * scale,
      life: 95 + Math.random() * 60,
      spin: Math.random() * Math.PI,
      color: colors[Math.floor(Math.random() * colors.length)]
    };
  });

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      p.x += p.vx;
      p.y += p.vy;
      p.spin += 0.16;
      p.vy += 0.18 * scale;
      p.life -= 1;
      ctx.globalAlpha = Math.max(p.life / 100, 0);
      ctx.fillStyle = p.color;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size * 1.6, p.size * 0.72);
      ctx.restore();
    });
    ctx.globalAlpha = 1;
    if (particles.some((p) => p.life > 0)) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  }
  frame();
}

function triggerWinnerAnimation() {
  els.drawDisplay.classList.remove("winner-burst");
  void els.drawDisplay.offsetWidth;
  els.drawDisplay.classList.add("winner-burst");
  setTimeout(() => els.drawDisplay.classList.remove("winner-burst"), 1300);
}

function getLetter(number) {
  return COLUMNS.find((column) => number >= column.min && number <= column.max)?.letter || "+";
}

function range(start, end) {
  if (end < start) return [];
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.round(number)));
}

function sanitizeText(value, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
}

function sanitizeUrl(value) {
  const text = sanitizeText(value, 600);
  if (!text) return "";
  try {
    const url = new URL(text, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function sanitizeAudioUrl(value) {
  const text = sanitizeText(value, 1200);
  if (!text) return "";
  if (/^blob:/i.test(text)) return text;
  if (/^data:audio\/[a-z0-9.+-]+;base64,/i.test(text)) return text;
  try {
    const url = new URL(text, window.location.href);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function sanitizeAudioData(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text) return "";
  return /^data:audio\/[a-z0-9.+-]+;base64,/i.test(text) ? text : "";
}

function sanitizeImageUrl(value) {
  const text = sanitizeText(value, 600);
  if (!text) return "";
  if (/^blob:/i.test(text)) return text;
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp);base64,/i.test(text)) return text;
  return sanitizeUrl(text);
}

function sanitizeTransientImageSource(value) {
  const text = String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!text) return "";
  if (/^data:image\/(?:png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(text)) return text;
  if (/^blob:/i.test(text)) return text;
  return sanitizeImageUrl(text);
}

function registerServiceWorker() {
  if ("serviceWorker" in navigator && location.protocol !== "file:") {
    navigator.serviceWorker.register("sw.js?v=7").then((registration) => {
      registration.update().catch(() => {});
    }).catch(() => {});
  }
}

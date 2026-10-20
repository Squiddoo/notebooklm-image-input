const OCR_LANGS = ["eng", "nld"];
const PROGRESS_STEP = 10;

let workerPromise = null;
let lastProgress = -1;

function getWorker() {
  if (workerPromise) return workerPromise;

  workerPromise = Tesseract.createWorker(OCR_LANGS, 1, {
    workerPath: chrome.runtime.getURL("vendor/worker.min.js"),
    corePath: chrome.runtime.getURL("vendor/"),
    langPath: chrome.runtime.getURL("vendor/lang"),
    workerBlobURL: false,
    logger: (m) => {
      if (!m || m.status !== "recognizing text") return;
      const pct = Math.round((m.progress || 0) * 100);
      if (pct === lastProgress) return;
      lastProgress = pct;
      if (pct % PROGRESS_STEP !== 0 && pct !== 100) return;
      chrome.runtime
        .sendMessage({ target: "content", type: "ocr-progress", progress: pct })
        .catch(() => {});
    }
  }).catch((err) => {
    workerPromise = null;
    throw err;
  });

  return workerPromise;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.target !== "offscreen" || msg.type !== "ocr") return;

  (async () => {
    try {
      const worker = await getWorker();
      lastProgress = -1;
      const opts = msg.psm ? { psm: msg.psm, preserve_interword_spaces: true } : {};
      const { data } = await worker.recognize(msg.dataUrl, opts);
      sendResponse({ ok: true, text: (data && data.text) || "" });
    } catch (err) {
      sendResponse({ ok: false, error: String((err && err.message) || err) });
    }
  })();

  return true;
});

let offscreenReady = null;

async function createOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
  } catch {
    /* older Chrome without hasDocument */
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: ["WORKERS"],
      justification: "Lokale OCR van geplakte screenshots"
    });
  } catch (err) {
    if (!String(err).includes("single offscreen")) throw err;
  }
}

function ensureOffscreen() {
  if (!offscreenReady) {
    offscreenReady = createOffscreen().catch((err) => {
      offscreenReady = null;
      throw err;
    });
  }
  return offscreenReady;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "ocr" || msg.target === "offscreen") return;

  ensureOffscreen()
    .then(() =>
      chrome.runtime.sendMessage({
        target: "offscreen",
        type: "ocr",
        dataUrl: msg.dataUrl
      })
    )
    .then((res) => sendResponse(res || { ok: false, error: "Geen antwoord van de OCR-worker" }))
    .catch((err) =>
      sendResponse({ ok: false, error: String((err && err.message) || err) })
    );

  return true;
});

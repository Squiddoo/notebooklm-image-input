<div align="center">

# NotebookLM Image Input

**A Chrome extension that inserts text from screenshots and files directly into [Google NotebookLM](https://notebooklm.google.com/).**

[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![OCR](https://img.shields.io/badge/OCR-Tesseract.js-2D8CFF?style=flat)](https://github.com/naptha/tesseract.js)
[![License](https://img.shields.io/badge/License-MIT-blue?style=flat)](LICENSE)

</div>

---

## Overview

NotebookLM's chat is designed for text, but sometimes the information you need is trapped in a screenshot or image.

**NotebookLM Image Input** solves this by extracting text from images and inserting it directly into your chat input. Paste a screenshot, drop a file, or select one using the file picker. The extension handles the text extraction for you, without creating a NotebookLM source.

OCR runs locally through Tesseract.js, so images don't need to be uploaded to an external OCR service.

## Preview

<div align="center">

![NotebookLM Image Input in action](https://cdn.discordapp.com/attachments/1542569852617756713/1562451677313892414/x3bsp8h.gif?ex=6ada0a04&is=6ad8b884&hm=5d581eae335c09649e03ad6318c4616d4e0d7a66734d79df1d207d7705866daf&)

</div>

## Features

| Feature | Description |
|---|---|
| Clipboard paste | Paste screenshots using `Ctrl+V` |
| File picker | Select images and text files using the `+` button |
| Drag and drop | Drop supported files directly onto the chat input |
| Local OCR | Extract text using Tesseract.js |
| Direct insertion | Insert extracted text into your NotebookLM prompt |
| Configurable settings | Control auto-send and the maximum input character count |
| Language support | Includes English and Dutch OCR data |

## Installation

Requires Google Chrome or a compatible Chromium-based browser.

1. Clone or download this repository.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked**.
5. Select the extension's folder containing `manifest.json`.
6. Open or reload [NotebookLM](https://notebooklm.google.com/).

## Usage

- **`Ctrl+V`** — paste a screenshot from your clipboard.
- **`+`** — select an image or text file.
- **Drag and drop** — drop a supported file onto the input field.
- **`Enter`** — insert the extracted text. Press Enter again to send when auto-send is disabled.

## Settings

Click the gear icon to configure the extension.

| Setting | Default | Description |
|---|---|---|
| Auto-send after OCR | Off | Automatically send the prompt after text extraction |
| Max input characters | `3,900` | Set the character limit displayed by the input counter |

## How It Works

The extension uses [Tesseract.js](https://github.com/naptha/tesseract.js) to perform optical character recognition locally.

1. An image is pasted, dropped, or selected.
2. The extension processes the image using the local OCR engine.
3. The extracted text is inserted into the NotebookLM chat input.
4. You can review the text before sending your prompt.

No external OCR service is required, and the extension does not create a NotebookLM source from the image.

## Project Structure

| File | Purpose |
|---|---|
| `manifest.json` | Extension configuration and permissions |
| `content.js` | Interface, paste handling, drag and drop, OCR coordination, and text insertion |
| `background.js` | Service worker and offscreen document management |
| `offscreen.html` | Offscreen document for OCR processing |
| `offscreen.js` | Local OCR execution |
| `vendor/` | Tesseract.js, worker, WASM core, and language data |

## Privacy

OCR processing runs locally on your machine. Images are not uploaded to an external OCR service, and no NotebookLM source is created automatically.

When you send a prompt, the extracted text is submitted to NotebookLM as part of your message.

## License

[MIT](LICENSE) — free to use, modify, and distribute.

---

<div align="center">
<sub>Developed by <a href="https://github.com/Squiddoo">Squiddoo</a></sub>
</div>

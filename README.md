# NotebookLM Image Input

A Chrome extension that inserts screenshots and files into the NotebookLM chat as text.

## What it does

The NotebookLM chat only accepts text. This extension turns images into text and inserts that text into your prompt, without saving the image as a source.

- Paste a screenshot into the chat with `Ctrl+V`
- Drag and drop a file onto the input field
- Click the `+` button to pick a file
- Supports images and text files

OCR runs locally and the result is appended to your chat input. Nothing is uploaded and no source is created.

## Installation

1. Download or clone this repository
2. Open `chrome://extensions` in Chrome
3. Enable developer mode
4. Click `Load unpacked` and select this extension's folder
5. Reload notebooklm.google.com

## Usage

- **Ctrl+V**: paste a screenshot from the clipboard
- **+**: pick a file
- **Drag and drop**: drop a file onto the input field
- **Enter**: the text is inserted into the input. Press Enter again to send.

## Settings

Click the gear icon:

- Auto-send after OCR: on/off
- Max input characters: counter limit (default 3,900)

## How it works

OCR runs locally through Tesseract.js in an offscreen document. Nothing leaves your machine.

## Files

- `manifest.json` - extension manifest
- `content.js` - UI, paste, drag and drop, OCR, text insertion
- `background.js` - service worker and offscreen management
- `offscreen.html`, `offscreen.js` - local OCR
- `vendor/` - Tesseract.js, worker, wasm core, trained data (eng, nld)

## License

MIT

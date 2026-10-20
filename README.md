# NotebookLM Image Input

Chrome-extensie om screenshots en bestanden als tekst in te voegen in de NotebookLM-chat.

## Wat het doet

De chat in NotebookLM accepteert alleen tekst. Met deze extensie voeg je afbeeldingen toe als tekst aan je invoer, zonder ze als bron op te slaan.

- Plak een screenshot met `Ctrl+V` in de chat
- Sleep een bestand naar het invoerveld
- Klik op de `+`-knop om een bestand te kiezen
- Ondersteunt afbeeldingen en tekstbestanden

De extensie converteert de afbeelding lokaal naar tekst (OCR) en voegt die tekst toe aan je chat-invoer. Het wordt niet als bron toegevoegd.

## Installatie

1. Download of clone deze repository
2. Ga in Chrome naar `chrome://extensions`
3. Schakel ontwikkelaarsmodus in
4. Klik op `Unpacked laden` en selecteer de map van deze extensie
5. Vernieuw notebooklm.google.com

## Gebruik

- **Ctrl+V**: plak screenshot uit klembord
- **+**: kies een bestand
- **Sleep en zet neer**: sleep bestand naar invoerveld
- **Enter**: tekst wordt toegevoegd aan invoer. Druk nogmaals op Enter om te verzenden.

## Instellingen

Klik op het tandwiel-icoon:

- Direct verzenden na OCR: aan/uit
- Max invoer karakters: limiet voor teller (standaard 3.900)

## Techniek

OCR draait lokaal via Tesseract.js in een offscreen document. Niets wordt geupload.

## Bestanden

- `manifest.json` - extensie manifest
- `content.js` - UI, plakken, slepen, OCR, tekst invoegen
- `background.js` - service worker en offscreen beheer
- `offscreen.html`, `offscreen.js` - lokale OCR
- `vendor/` - Tesseract.js, worker, wasm-core, trained-data (eng, nld)

## Licentie

MIT

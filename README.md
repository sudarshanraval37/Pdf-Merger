# PDF Merger

A modern, fully in-browser PDF merging tool. No backend, no uploads, no tracking — everything runs locally via the [pdf-lib](https://pdf-lib.js.org/) library.

## Quick Start

1. Download or clone the project folder.
2. Open `index.html` in any modern browser (Chrome, Firefox, Edge, Safari).
3. Drop PDFs onto the upload zone, reorder them, and click **Merge & Download**.

No installation, no server, no internet connection required after the initial page load.

---

## Project Structure

```
pdf-merger/
├── index.html    — App shell, semantic HTML, accessibility markup
├── style.css     — Full design system (CSS variables, dark/light, responsive)
├── script.js     — All application logic (vanilla ES6+)
├── assets/       — Reserved for future icons/images
└── README.md     — This file
```

---

## Features

### Upload
- **File picker** — click the drop zone or press `Ctrl + O`
- **Drag & drop** — drag files from your OS directly onto the zone
- **Multiple files** — select or drop as many as you need at once
- **Validation** — non-PDF files, duplicates, and files over 100 MB are rejected with clear messages

### File List
- Displays name, file size, and page count (read asynchronously)
- Upload order badge on each card
- Glassmorphism card design with hover/focus states

### Reorder
- **Drag & drop** cards to change merge order
- Smooth animations throughout
- Order numbers update automatically

### Remove
- Per-file ✕ button with exit animation
- **Remove all** button (with confirmation dialog)
- `Delete` key removes the currently selected card

### Merge
- Merges PDFs in the current displayed order via pdf-lib
- **Progress bar** and animated overlay while working
- Clear error messages for corrupted or unreadable files

### Download
- Automatic browser download when merge completes
- **Editable filename** field (`.pdf` extension appended automatically)

### Statistics
- Live-updated totals: file count · page count · total size

### Search & Sort
- Filter by filename (instant, case-insensitive)
- Sort by: upload order · name A–Z · largest first · newest first

### Dark / Light Mode
- Toggle button in the header
- Preference saved to `localStorage`
- Respects `prefers-color-scheme` on first visit

### Toast Notifications
- Non-blocking toasts for: upload success, merge complete, invalid file, removal, errors
- Click any toast to dismiss early

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl + O` | Open file picker |
| `Ctrl + M` | Merge PDFs |
| `Delete` | Remove selected file |
| `Esc` | Close modal / deselect |
| `?` | Open shortcuts reference |

---

## Browser Support

Works in all modern browsers with ES6+ support:
- Chrome / Edge 80+
- Firefox 75+
- Safari 14+

---

## Privacy

**Zero data ever leaves your device.** Files are read into memory using the File API, processed by pdf-lib entirely client-side, and the result is downloaded directly to your machine. There are no analytics, no telemetry, and no external requests beyond loading the fonts and pdf-lib from CDN on first load.

---

## Dependencies

| Library | Version | Purpose |
|---------|---------|---------|
| [pdf-lib](https://pdf-lib.js.org/) | 1.17.1 | PDF parsing, page copying, document creation |
| [Space Grotesk](https://fonts.google.com/specimen/Space+Grotesk) | — | Display / heading typeface |
| [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans) | — | Body typeface |

All loaded from public CDNs; no npm install needed.

---

## License

MIT — free to use, modify, and distribute.
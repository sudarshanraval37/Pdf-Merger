/**
 * PDF Merger — script.js
 * ============================================================
 * All-in-one vanilla JS controller for the PDF Merger app.
 * No frameworks, no build step. Works entirely in-browser via
 * the pdf-lib library (loaded from CDN in index.html).
 *
 * Sections:
 *  1. State
 *  2. DOM references
 *  3. Theme
 *  4. Toast notifications
 *  5. Modal (keyboard shortcuts)
 *  6. File validation & ingestion
 *  7. Page-count reader (pdf-lib)
 *  8. Statistics bar
 *  9. Render: PDF card list
 * 10. Search & Sort
 * 11. Drag-and-drop reorder (list items)
 * 12. Remove file / Remove all
 * 13. Merge & Download
 * 14. Loading overlay & progress
 * 15. Keyboard shortcuts
 * 16. Bootstrap / init
 * ============================================================
 */

'use strict';

/* ============================================================
   1. STATE
   Central data store — all UI derives from this object.
   ============================================================ */
const state = {
    /** @type {Array<PdfEntry>} Master list, insertion-ordered */
    files: [],
    /** Currently selected card id (for keyboard Delete) */
    selectedId: null,
    /** Search query string */
    searchQuery: '',
    /** Sort key: 'order' | 'name' | 'size' | 'time' */
    sortKey: 'order',
    /** Merge in progress? */
    merging: false,
};

/**
 * @typedef {Object} PdfEntry
 * @property {string}  id        — Unique ID (timestamp + random)
 * @property {File}    file      — Original File object
 * @property {string}  name      — file.name
 * @property {number}  size      — file.size (bytes)
 * @property {number}  uploadedAt — Date.now() at upload time
 * @property {number}  order     — Insertion order (1-based, mutable)
 * @property {number|null} pages — Page count, resolved async
 */

/* ============================================================
   2. DOM REFERENCES
   Grab all elements once at boot; never query inside loops.
   ============================================================ */
const dom = {
    // Upload
    dropZone: document.getElementById('dropZone'),
    fileInput: document.getElementById('fileInput'),

    // Stats
    statsBar: document.getElementById('statsBar'),
    statFiles: document.getElementById('statFiles'),
    statPages: document.getElementById('statPages'),
    statSize: document.getElementById('statSize'),

    // Controls
    controlsBar: document.getElementById('controlsBar'),
    searchInput: document.getElementById('searchInput'),
    sortSelect: document.getElementById('sortSelect'),
    removeAllBtn: document.getElementById('removeAllBtn'),

    // List
    pdfListSection: document.getElementById('pdfListSection'),
    pdfList: document.getElementById('pdfList'),
    noResultsMsg: document.getElementById('noResultsMsg'),

    // Merge
    mergeSection: document.getElementById('mergeSection'),
    mergeBtn: document.getElementById('mergeBtn'),
    mergeHint: document.getElementById('mergeHint'),
    outputFilename: document.getElementById('outputFilename'),

    // Overlay
    loadingOverlay: document.getElementById('loadingOverlay'),
    loadingStatus: document.getElementById('loadingStatus'),
    progressBar: document.getElementById('progressBar'),
    progressPercent: document.getElementById('progressPercent'),

    // Toast
    toastContainer: document.getElementById('toastContainer'),

    // Theme
    themeToggle: document.getElementById('themeToggle'),

    // Modal
    shortcutsBtn: document.getElementById('shortcutsBtn'),
    shortcutsModal: document.getElementById('shortcutsModal'),
    shortcutsClose: document.getElementById('shortcutsClose'),
};

/* ============================================================
   3. THEME  (dark / light, persisted to localStorage)
   ============================================================ */

/** Apply theme to <html> and save preference. */
function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('pdfmerger-theme', theme);
}

/** Read saved preference or fall back to system preference. */
function initTheme() {
    const saved = localStorage.getItem('pdfmerger-theme');
    if (saved) { applyTheme(saved); return; }
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
}

dom.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
});

/* ============================================================
   4. TOAST NOTIFICATIONS
   showToast(title, message, type, duration)
   type: 'success' | 'error' | 'warning' | 'info'
   ============================================================ */

const TOAST_ICONS = {
    success: '✅',
    error: '❌',
    warning: '⚠️',
    info: 'ℹ️',
};

/**
 * Display a non-blocking toast notification.
 * @param {string} title
 * @param {string} [message]
 * @param {'success'|'error'|'warning'|'info'} [type='info']
 * @param {number} [duration=3800] ms before auto-dismiss
 */
function showToast(title, message = '', type = 'info', duration = 3800) {
    const toast = document.createElement('div');
    toast.className = `toast toast--${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
    <span class="toast-icon" aria-hidden="true">${TOAST_ICONS[type]}</span>
    <div class="toast-body">
      <p class="toast-title">${escapeHtml(title)}</p>
      ${message ? `<p class="toast-msg">${escapeHtml(message)}</p>` : ''}
    </div>`;

    dom.toastContainer.appendChild(toast);

    // Auto-dismiss
    const timer = setTimeout(() => dismissToast(toast), duration);

    // Click to dismiss early
    toast.addEventListener('click', () => { clearTimeout(timer); dismissToast(toast); });
}

function dismissToast(toast) {
    if (!toast.parentNode) return;
    toast.classList.add('toast-exit');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
}

/* ============================================================
   5. MODAL — Keyboard Shortcuts
   ============================================================ */

function openModal() {
    dom.shortcutsModal.classList.add('open');
    dom.shortcutsModal.setAttribute('aria-hidden', 'false');
    dom.shortcutsClose.focus();
}

function closeModal() {
    dom.shortcutsModal.classList.remove('open');
    dom.shortcutsModal.setAttribute('aria-hidden', 'true');
    dom.shortcutsBtn.focus();
}

dom.shortcutsBtn.addEventListener('click', openModal);
dom.shortcutsClose.addEventListener('click', closeModal);

// Close on backdrop click
dom.shortcutsModal.addEventListener('click', (e) => {
    if (e.target === dom.shortcutsModal) closeModal();
});

/* ============================================================
   6. FILE VALIDATION & INGESTION
   ============================================================ */

const MAX_FILE_SIZE_MB = 100;
const MAX_FILE_SIZE = MAX_FILE_SIZE_MB * 1024 * 1024;

/**
 * Validate and add an array of File objects to state.
 * Skips duplicates, wrong types, oversized files, and alerts user.
 * @param {FileList|File[]} fileList
 */
async function addFiles(fileList) {
    const incoming = Array.from(fileList);
    let addedCount = 0;
    let skipped = [];

    for (const file of incoming) {
        // Type check
        if (!isPdf(file)) {
            skipped.push(`"${file.name}" — not a PDF`);
            continue;
        }

        // Size check
        if (file.size > MAX_FILE_SIZE) {
            skipped.push(`"${file.name}" — exceeds ${MAX_FILE_SIZE_MB} MB limit`);
            continue;
        }

        // Duplicate check (same name + size)
        const isDuplicate = state.files.some(
            (e) => e.name === file.name && e.size === file.size
        );
        if (isDuplicate) {
            skipped.push(`"${file.name}" — already added`);
            continue;
        }

        // Build entry
        const entry = {
            id: generateId(),
            file,
            name: file.name,
            size: file.size,
            uploadedAt: Date.now(),
            order: state.files.length + 1,
            pages: null, // resolved below
        };

        state.files.push(entry);
        addedCount++;

        // Resolve page count asynchronously, then re-render
        readPageCount(entry).then(() => {
            renderList();
            updateStats();
        });
    }

    // Normalise order integers after any additions
    reindexOrder();

    // Feedback toasts
    if (addedCount > 0) {
        showToast(
            `${addedCount} file${addedCount > 1 ? 's' : ''} added`,
            `${state.files.length} PDF${state.files.length > 1 ? 's' : ''} ready.`,
            'success'
        );
    }

    skipped.forEach((msg) => showToast('Skipped', msg, 'warning', 5000));

    renderList();
    updateStats();
    syncUIVisibility();
}

/**
 * Return true if file appears to be a PDF (MIME or extension).
 * @param {File} file
 */
function isPdf(file) {
    if (file.type === 'application/pdf') return true;
    return file.name.toLowerCase().endsWith('.pdf');
}

/* ============================================================
   7. PAGE-COUNT READER  (uses pdf-lib, async)
   ============================================================ */

/**
 * Read the page count from a PDF file using pdf-lib.
 * Updates the entry in-place; safe to call concurrently.
 * @param {PdfEntry} entry
 */
async function readPageCount(entry) {
    try {
        const buffer = await entry.file.arrayBuffer();
        const pdf = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
        entry.pages = pdf.getPageCount();
    } catch (_) {
        // Corrupted or encrypted PDF — page count stays null
        entry.pages = null;
    }
}

/* ============================================================
   8. STATISTICS BAR
   ============================================================ */

/** Recalculate and display total files, pages, size. */
function updateStats() {
    const totalFiles = state.files.length;
    const totalSize = state.files.reduce((acc, e) => acc + e.size, 0);
    const totalPages = state.files.reduce((acc, e) => acc + (e.pages ?? 0), 0);
    const allLoaded = state.files.every((e) => e.pages !== null);

    dom.statFiles.textContent = totalFiles;
    dom.statSize.textContent = formatSize(totalSize);
    dom.statPages.textContent = totalFiles === 0
        ? '—'
        : allLoaded
            ? totalPages
            : `~${totalPages}`;
}

/* ============================================================
   9. RENDER: PDF CARD LIST
   ============================================================ */

/** Re-render the visible list based on current search + sort. */
function renderList() {
    const query = state.searchQuery.toLowerCase().trim();
    const sortKey = state.sortKey;

    // Filter
    let visible = query
        ? state.files.filter((e) => e.name.toLowerCase().includes(query))
        : [...state.files];

    // Sort
    visible = sortEntries(visible, sortKey);

    // Render cards
    dom.pdfList.innerHTML = '';
    visible.forEach((entry) => {
        dom.pdfList.appendChild(buildCard(entry));
    });

    // No-results message
    dom.noResultsMsg.hidden = !(query && visible.length === 0);

    // Update merge button state
    updateMergeBtn();
}

/**
 * Build a single PDF card <li> element.
 * @param {PdfEntry} entry
 * @returns {HTMLLIElement}
 */
function buildCard(entry) {
    const li = document.createElement('li');
    li.className = 'pdf-card';
    li.dataset.id = entry.id;
    li.tabIndex = 0;
    li.setAttribute('role', 'listitem');
    li.setAttribute('aria-label', `${entry.name}, ${formatSize(entry.size)}${entry.pages ? `, ${entry.pages} pages` : ''}`);
    li.setAttribute('draggable', 'true');

    if (state.selectedId === entry.id) li.classList.add('selected');

    const pagesHtml = entry.pages !== null
        ? `<span class="card-pages">📄 ${entry.pages}p</span>`
        : `<span class="card-pages" aria-label="Loading page count">…</span>`;

    li.innerHTML = `
    <div class="card-left">
      <div class="drag-handle" aria-hidden="true" title="Drag to reorder">
        <span></span><span></span><span></span>
      </div>
      <span class="order-badge" aria-label="Position ${entry.order}">${entry.order}</span>
    </div>
    <div class="file-icon" aria-hidden="true">📕</div>
    <div class="card-body">
      <p class="card-name" title="${escapeHtml(entry.name)}">${escapeHtml(truncateName(entry.name, 48))}</p>
      <div class="card-meta">
        <span>${formatSize(entry.size)}</span>
        <span class="card-meta-dot" aria-hidden="true"></span>
        ${pagesHtml}
      </div>
    </div>
    <div class="card-right">
      <button
        class="btn-remove"
        aria-label="Remove ${escapeHtml(entry.name)}"
        data-id="${entry.id}"
        title="Remove file"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>`;

    // Select on click (for keyboard Delete)
    li.addEventListener('click', (e) => {
        if (e.target.closest('.btn-remove')) return; // handled separately
        selectCard(entry.id);
    });

    // Keyboard: Enter = select, Space = select
    li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            selectCard(entry.id);
        }
    });

    // Remove button
    li.querySelector('.btn-remove').addEventListener('click', (e) => {
        e.stopPropagation();
        removeFile(entry.id);
    });

    // Drag-and-drop reorder
    attachDragHandlers(li, entry.id);

    return li;
}

/** Mark a card as selected (highlights it, enables Delete key). */
function selectCard(id) {
    state.selectedId = (state.selectedId === id) ? null : id;
    // Update visual selection without full re-render
    document.querySelectorAll('.pdf-card').forEach((card) => {
        card.classList.toggle('selected', card.dataset.id === state.selectedId);
    });
}

/* ============================================================
   10. SEARCH & SORT
   ============================================================ */

dom.searchInput.addEventListener('input', (e) => {
    state.searchQuery = e.target.value;
    renderList();
});

dom.sortSelect.addEventListener('change', (e) => {
    state.sortKey = e.target.value;
    renderList();
});

/**
 * Sort a copy of entries by the given key.
 * 'order' preserves original insertion sequence.
 * @param {PdfEntry[]} entries
 * @param {string} key
 * @returns {PdfEntry[]}
 */
function sortEntries(entries, key) {
    const copy = [...entries];
    switch (key) {
        case 'name':
            return copy.sort((a, b) => a.name.localeCompare(b.name));
        case 'size':
            return copy.sort((a, b) => b.size - a.size);
        case 'time':
            return copy.sort((a, b) => b.uploadedAt - a.uploadedAt);
        case 'order':
        default:
            return copy.sort((a, b) => a.order - b.order);
    }
}

/* ============================================================
   11. DRAG-AND-DROP REORDER  (HTML5 draggable API)
   ============================================================ */

let dragSrcId = null; // id of the card being dragged

/**
 * Attach drag event listeners to a card element.
 * @param {HTMLElement} li
 * @param {string} id — entry id
 */
function attachDragHandlers(li, id) {
    li.addEventListener('dragstart', (e) => {
        dragSrcId = id;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', id); // required by Firefox
    });

    li.addEventListener('dragend', () => {
        dragSrcId = null;
        li.classList.remove('dragging');
        // Clean up any lingering over-target highlights
        document.querySelectorAll('.drag-over-target').forEach((el) =>
            el.classList.remove('drag-over-target')
        );
    });

    li.addEventListener('dragover', (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        if (dragSrcId && dragSrcId !== id) {
            li.classList.add('drag-over-target');
        }
    });

    li.addEventListener('dragleave', () => {
        li.classList.remove('drag-over-target');
    });

    li.addEventListener('drop', (e) => {
        e.preventDefault();
        li.classList.remove('drag-over-target');

        if (!dragSrcId || dragSrcId === id) return;

        // Reorder state.files array
        const srcIndex = state.files.findIndex((f) => f.id === dragSrcId);
        const destIndex = state.files.findIndex((f) => f.id === id);
        if (srcIndex === -1 || destIndex === -1) return;

        // Splice src out and insert before/after dest
        const [moved] = state.files.splice(srcIndex, 1);
        state.files.splice(destIndex, 0, moved);

        reindexOrder();
        renderList();
        showToast('Reordered', `"${moved.name}" moved to position ${destIndex + 1}.`, 'info', 2200);
    });
}

/* ============================================================
   12. REMOVE FILE / REMOVE ALL
   ============================================================ */

/**
 * Remove a single file from state and animate its card out.
 * @param {string} id
 */
function removeFile(id) {
    const entry = state.files.find((e) => e.id === id);
    if (!entry) return;

    // Animate exit first, then remove from state
    const card = dom.pdfList.querySelector(`[data-id="${id}"]`);
    if (card) {
        card.classList.add('card-exit');
        card.addEventListener('animationend', () => {
            state.files = state.files.filter((e) => e.id !== id);
            if (state.selectedId === id) state.selectedId = null;
            reindexOrder();
            renderList();
            updateStats();
            syncUIVisibility();
        }, { once: true });
    } else {
        state.files = state.files.filter((e) => e.id !== id);
        reindexOrder();
        renderList();
        updateStats();
        syncUIVisibility();
    }

    showToast('Removed', `"${entry.name}" removed.`, 'info', 2500);
}

/** Remove all files after user confirmation. */
function removeAll() {
    if (state.files.length === 0) return;
    const confirmed = window.confirm(
        `Remove all ${state.files.length} file${state.files.length > 1 ? 's' : ''}? This cannot be undone.`
    );
    if (!confirmed) return;

    state.files = [];
    state.selectedId = null;
    dom.searchInput.value = '';
    state.searchQuery = '';

    renderList();
    updateStats();
    syncUIVisibility();
    showToast('Cleared', 'All files removed.', 'info');
}

dom.removeAllBtn.addEventListener('click', removeAll);

/* ============================================================
   13. MERGE & DOWNLOAD
   ============================================================ */

/**
 * Merge all PDFs in current display order using pdf-lib,
 * then trigger browser download of the result.
 */
async function mergePdfs() {
    if (state.merging) return;
    if (state.files.length < 2) {
        showToast('Too few files', 'Add at least 2 PDFs to merge.', 'warning');
        return;
    }

    // Determine merge order (respects current sort, but always use display order)
    const orderedFiles = sortEntries(state.files, state.sortKey);

    state.merging = true;
    dom.mergeBtn.disabled = true;
    dom.mergeBtn.setAttribute('aria-disabled', 'true');

    showLoadingOverlay(true);
    setProgress(0, 'Starting merge…');

    try {
        const mergedPdf = await PDFLib.PDFDocument.create();
        const total = orderedFiles.length;

        for (let i = 0; i < total; i++) {
            const entry = orderedFiles[i];
            const pct = Math.round(((i) / total) * 90); // save last 10% for save step

            setProgress(pct, `Adding "${truncateName(entry.name, 32)}" (${i + 1}/${total})…`);

            let buffer;
            try {
                buffer = await entry.file.arrayBuffer();
            } catch (readErr) {
                throw new Error(`Could not read "${entry.name}". The file may have been moved or deleted.`);
            }

            let srcPdf;
            try {
                srcPdf = await PDFLib.PDFDocument.load(buffer, { ignoreEncryption: true });
            } catch (parseErr) {
                throw new Error(`"${entry.name}" appears to be corrupted or encrypted and cannot be merged.`);
            }

            const pageCount = srcPdf.getPageCount();
            if (pageCount === 0) {
                showToast('Empty PDF', `"${entry.name}" has no pages and was skipped.`, 'warning');
                continue;
            }

            const indices = Array.from({ length: pageCount }, (_, k) => k);

            const copiedPages = await mergedPdf.copyPages(srcPdf, indices);

            for (const page of copiedPages) {
                mergedPdf.addPage(page);
            }
        }

        setProgress(90, 'Saving merged PDF…');

        if (mergedPdf.getPageCount() === 0) {
            throw new Error('The merged PDF has no pages. All source files may be empty or unreadable.');
        }

        const pdfBytes = await mergedPdf.save();
        setProgress(100, 'Done!');

        // Trigger download
        const filename = sanitiseFilename(dom.outputFilename.value.trim() || 'Merged-PDF');
        downloadBytes(pdfBytes, `${filename}.pdf`, 'application/pdf');

        showToast(
            'Merge complete!',
            `${mergedPdf.getPageCount()} pages saved as "${filename}.pdf"`,
            'success',
            5000
        );

    } catch (err) {
        console.error('[PDF Merger] Merge failed:', err);
        showToast('Merge failed', err.message || 'An unexpected error occurred.', 'error', 7000);
    } finally {
        // Short pause so user sees 100% before overlay fades
        await sleep(600);
        showLoadingOverlay(false);
        state.merging = false;
        updateMergeBtn();
    }
}

dom.mergeBtn.addEventListener('click', mergePdfs);

/**
 * Trigger a file download from a Uint8Array.
 * @param {Uint8Array} bytes
 * @param {string} filename
 * @param {string} mimeType
 */
function downloadBytes(bytes, filename, mimeType) {
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Revoke after a short delay to ensure download starts
    setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ============================================================
   14. LOADING OVERLAY & PROGRESS
   ============================================================ */

/**
 * Show or hide the loading overlay.
 * @param {boolean} visible
 */
function showLoadingOverlay(visible) {
    dom.loadingOverlay.classList.toggle('active', visible);
    dom.loadingOverlay.setAttribute('aria-hidden', String(!visible));
}

/**
 * Update progress bar and status text.
 * @param {number} pct   — 0–100
 * @param {string} label — status message
 */
function setProgress(pct, label) {
    dom.progressBar.style.width = `${pct}%`;
    dom.progressPercent.textContent = `${pct}%`;
    dom.loadingStatus.textContent = label;
}

/* ============================================================
   15. KEYBOARD SHORTCUTS
   ============================================================ */

document.addEventListener('keydown', (e) => {
    const tag = (e.target.tagName || '').toLowerCase();
    const inInput = tag === 'input' || tag === 'select' || tag === 'textarea';

    // Esc — close modal, deselect card
    if (e.key === 'Escape') {
        if (dom.shortcutsModal.classList.contains('open')) {
            closeModal();
            return;
        }
        if (state.selectedId) {
            state.selectedId = null;
            document.querySelectorAll('.pdf-card.selected').forEach((c) =>
                c.classList.remove('selected')
            );
        }
        return;
    }

    // Ctrl+O — open file picker (prevent browser default)
    if (e.ctrlKey && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        dom.fileInput.click();
        return;
    }

    // Ctrl+M — merge
    if (e.ctrlKey && e.key.toLowerCase() === 'm') {
        e.preventDefault();
        if (!dom.mergeBtn.disabled) mergePdfs();
        return;
    }

    // Delete — remove selected card (only when not typing in a field)
    if (e.key === 'Delete' && !inInput) {
        if (state.selectedId) {
            removeFile(state.selectedId);
        }
        return;
    }

    // ? — open shortcuts modal (only when not typing)
    if (e.key === '?' && !inInput) {
        openModal();
    }
});

/* ============================================================
   16. DROP ZONE — file picker & drag-drop from OS
   ============================================================ */

// Click / Enter / Space on drop zone
dom.dropZone.addEventListener('click', () => dom.fileInput.click());
dom.dropZone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        dom.fileInput.click();
    }
});

// File input change
dom.fileInput.addEventListener('change', async (e) => {
    if (e.target.files && e.target.files.length) {
        await addFiles(e.target.files);
    }
    // Reset so the same file can be re-selected if removed
    dom.fileInput.value = '';
});

// OS drag-over drop zone
dom.dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    dom.dropZone.classList.add('drag-over');
});

dom.dropZone.addEventListener('dragleave', (e) => {
    // Only remove if leaving the zone entirely (not entering a child)
    if (!dom.dropZone.contains(e.relatedTarget)) {
        dom.dropZone.classList.remove('drag-over');
    }
});

dom.dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dom.dropZone.classList.remove('drag-over');
    const files = e.dataTransfer?.files;
    if (files && files.length) await addFiles(files);
});

// Prevent browser from opening files when dragged outside the zone
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', (e) => e.preventDefault());

/* ============================================================
   UTILITIES
   ============================================================ */

/** Generate a unique ID string. */
function generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Reassign sequential 1-based order numbers to state.files (in-place). */
function reindexOrder() {
    state.files.forEach((entry, i) => { entry.order = i + 1; });
}

/**
 * Format bytes into human-readable string.
 * @param {number} bytes
 * @returns {string}
 */
function formatSize(bytes) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Truncate a filename, preserving the extension.
 * @param {string} name
 * @param {number} max — max total chars
 * @returns {string}
 */
function truncateName(name, max = 40) {
    if (name.length <= max) return name;
    const ext = name.lastIndexOf('.');
    const base = ext > 0 ? name.slice(0, ext) : name;
    const suffix = ext > 0 ? name.slice(ext) : '';
    const keep = max - suffix.length - 1;
    return `${base.slice(0, keep)}…${suffix}`;
}

/**
 * Strip characters that are unsafe in filenames across platforms.
 * @param {string} name
 * @returns {string}
 */
function sanitiseFilename(name) {
    return name.replace(/[/\\?%*:|"<>]/g, '-').trim() || 'Merged-PDF';
}

/**
 * Escape HTML special characters to prevent XSS.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/** Promise-based delay. */
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/* ============================================================
   UI VISIBILITY — show/hide sections based on file count
   ============================================================ */

/** Toggle visibility of stats, controls, list, and merge sections. */
function syncUIVisibility() {
    const hasFiles = state.files.length > 0;
    dom.statsBar.hidden = !hasFiles;
    dom.controlsBar.hidden = !hasFiles;
    dom.pdfListSection.hidden = !hasFiles;
    dom.mergeSection.hidden = !hasFiles;
}

/** Enable/disable the Merge button based on file count and merge state. */
function updateMergeBtn() {
    const canMerge = state.files.length >= 2 && !state.merging;
    dom.mergeBtn.disabled = !canMerge;
    dom.mergeBtn.setAttribute('aria-disabled', String(!canMerge));
    dom.mergeHint.textContent = state.files.length < 2
        ? 'Add at least 2 PDF files to enable merging.'
        : `Ready to merge ${state.files.length} files in the current order.`;
}

/* ============================================================
   BOOTSTRAP — run on DOMContentLoaded
   ============================================================ */

function init() {
    initTheme();
    syncUIVisibility();
    updateStats();
    updateMergeBtn();

    // Welcome toast after a short delay
    setTimeout(() => {
        showToast('Ready', 'Drop or select PDF files to get started. Press ? for shortcuts.', 'info', 4500);
    }, 800);
}

// Entry point
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
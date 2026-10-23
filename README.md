# 📓 BrightBoard — Smart Whiteboard & Notebook Web App

[![Repository](https://img.shields.io/badge/Repository-GitHub-2EA44F?style=for-the-badge&logo=github)](https://github.com/rabit314/brightboard)
[![Version](https://img.shields.io/badge/Version-v1.8.1-E4572E?style=for-the-badge)](https://github.com/rabit314/brightboard)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue?style=for-the-badge)](LICENSE)

A blazing-fast, responsive, multi-page vector whiteboard and notebook web application built with pure HTML5 Canvas and vanilla JavaScript. Designed with a warm classroom paper aesthetic (`#FCFAF3`), persimmon accents (`#E4572E`), zero external framework bloat, and 100% offline-ready embedded vector icons.

**Deployment**: Tested commits pushed to `main` update the website automatically through the connected Netlify deployment.

---

## 🌟 Key Features

### 📱 v1.8.0 Mobile & Tablet Support
- **Touch Layout**: Scrollable bottom tool dock, accessible page thumbnails, larger touch controls, and a compact Board options menu for backgrounds, zoom, export, backup and help. Landscape phones place tools and pages side by side to preserve drawing space. Layouts respect display cutouts and home indicators.
- **Touch Navigation & Selection**: Two fingers pan and pinch to zoom; one finger draws with the active tool or pans with Hand. Touch selection and resize/rotate handles have wider hit areas. Starting a pinch with Paint Bucket leaves the drawing untouched.
- **Keyboard-Aware Editing**: Text and sticky notes stay within the visible screen when the on-screen keyboard opens. A Done button commits the draft and closes the keyboard; drawing controls return after editing. Small text is enlarged for editing to avoid input zoom.
- **Fit to Available Canvas**: Fit content and selection actions account for the toolbar and bottom docks.

### ✍️ Intelligent Vector Drawing Tools
- **Velocity-Tapered Pen**: Freehand drawing with smooth quadratic Bézier interpolation and speed-dependent stroke tapering for a natural pen-on-paper feel.
- **Multiply-Blend Highlighter**: Authentic fluorescent marker that multiplies underneath black ink, preserving line contrast.
- **35-Shape Drawer**: An icon-only grid with the Paint-style set first: line, S-curve, oval, rectangle, rounded rectangle, concave polygon, triangles, diamond, pentagon, hexagon, right/left/up/down arrows, three stars, rectangular/oval/cloud callouts, heart and lightning. The other shapes remain available, including capsules, octagons, trapezoids, parallelograms, pluses, crosses, chevrons, double-headed arrows, clouds, semicircles and arcs. Drag to size each preset. Closed shapes support tint fill; all shapes support selection, resizing, rotation, grouping, locks, export and JSON backups. Hold `Shift` to constrain proportions. Existing line, rectangle, ellipse and arrow shortcuts still work; new shapes need no shortcuts.
- **Quick & Expanded Colors**: White in the quick-access palette, a color choosing icon for 60 shades, and the custom color picker placed beside it.
- **Handwritten Sticky Notes**: Warm pastel sticky notes (Caveat font) with automatic multi-paragraph word wrapping, custom color palettes, and inline editing.
- **Inline Text Boxes**: Direct typographic annotation (Nunito font) with adjustable font sizes and real-time canvas alignment.
- **Continuous Sweep Eraser**: Swept-circle path collision algorithm that instantly erases entire strokes and objects without leaving jagged artifacts.
- **Laser Pointer**: Luminous, self-decaying (750ms trail) red laser for lectures, meetings, presentations, and screen sharing.
- **Brush Size Preview**: Pen and highlighter cursors show their actual footprint at the current zoom, with immediate size and colour updates.
- **Paint Bucket (`B`)**: Fill the connected colour region you click on the visible canvas, including closed freehand outlines. Notebook grids are ignored. Fills support Undo/Redo, export, and backup/restore.

### 🎯 Multi-Selection, Marquee Tool & Rotation
- **Dedicated Rotation Blob Handle**: Grab the dedicated circular rotation handle extending cleanly above the selection box to smoothly rotate drawings, shapes, text, stickies, and images. Corners remain dedicated to clean, friction-free resizing.
- **Angle Alignment & Snapping**: Hold <kbd>Shift</kbd> while rotating to snap precisely to 15° intervals ($0^\circ, 15^\circ, 30^\circ, 45^\circ, 60^\circ, 75^\circ, 90^\circ$, etc.) with a live degree HUD badge!
- **Marquee Selection**: In the Select tool (`V`), click and drag on empty canvas to draw a selection rectangle that selects multiple objects simultaneously.
- **Multi-Object Manipulation**: Move, rotate, resize, duplicate (`Alt`+drag or `Ctrl+D`), delete, and layer-reorder multiple objects together.
- **Lock / Unlock**: Select an item and use the lock button or `Ctrl+Shift+L` (`Cmd+Shift+L` on Mac). Locked items remain selectable for unlocking, but cannot be moved, resized, rotated, erased, deleted or restyled. Clear page still clears the entire page.
- **Group / Ungroup**: Select multiple items and use the group buttons, `Ctrl+G` or `Ctrl+Shift+G` (also `Cmd` on Mac). Clicking or marquee-selecting any member selects its whole group. Groups move, resize, rotate and duplicate together; copies form independent groups. Grouping existing groups combines them into one group. Ungroup to edit a member's text. Locks and groups survive autosave, Undo/Redo and JSON backups.
- **Live Toolbar Sync**: Selecting objects dynamically updates toolbar swatches, stroke sliders, and font pickers; tweaking controls updates all selected objects in real time!
- **Keyboard Nudging**: Arrow keys nudge selected items by 3px (`Shift` + Arrow for 12px jumps).

### 🔍 Intuitive Navigation & Scrolling
- **Vertical Scroll**: Standard mouse wheel scrolls up and down (`panY`).
- **Horizontal Scroll**: `Shift` + mouse wheel scrolls left and right (`panX`).
- **Zoom**: `Ctrl` / `Cmd` + mouse wheel zooms in and out centered at the cursor.
- **Stroke & Font Wheel Scroll**: Hover over the Stroke or Font controls in the top bar and scroll the mouse wheel to rapidly adjust size (`Shift` for 5× step).

### 📄 Multi-Page Notebook & Instant Safety
- **Cross Button on All Pages**: Every page thumbnail (including single page) features an instant cross button.
- **Zero-Friction Clear & Delete**: Clearing a page (via top-bar trash button or thumbnail cross) or deleting pages happens instantly without annoying modal prompts.
- **Full `Ctrl+Z` Recovery**: Pressing `Ctrl+Z` immediately restores accidentally cleared pages or deleted pages with all drawings, shapes, and text intact!
- **Independent Page Backgrounds**: Choose between **Blank**, **Dotted Grid**, **Square Grid**, and **Ruled Lines** on a per-page basis.
- **Clean Arrow Tips**: Arrows end in a sharp point, with no rounded shaft protruding through the head, including when thick or enlarged. Arrow selection follows the corrected outline. The curved layer-order icons, 35-shape hover drawer and adaptive high-resolution PNG exports remain available.

### 📋 Universal Clipboard & Media Import
- **Multi-Object Copy/Paste**: `Ctrl+C` and `Ctrl+V` clone any selection of elements with automatic offset.
- **System Clipboard Paste**: Direct pasting of screenshots/images or external text from your operating system clipboard directly onto the canvas.
- **Drag & Drop**: Drop image files (`.png`, `.jpg`, `.webp`, `.svg`) directly onto the board.

### 💾 Autosave, Export & Portable JSON Backup
- **Automatic Persistence**: Debounced `localStorage` autosave, including text drafts, with brief bottom-left save confirmations, persistent failure messages, and retry after storage failures. Images needed by Undo/Redo remain available.
- **Adaptive High-Resolution PNG Export**: Render from vector content at 3.125× to 4×, increasing with drawing size, and embed 300–384 DPI print metadata. Exports retain their aspect ratio and padding, up to 16,000 pixels per side and 64 megapixels (32 megapixels on devices reporting 4 GB RAM or less). Browsers that cannot encode the full image automatically retry at lower resolutions. Filename timestamps and content cropping are preserved.
- **JSON Backup & Restore**: Export your entire notebook as a `.json` backup file with date & time timestamps or import existing backups across devices.
- **Upgrade Recovery**: Older saves with missing image sources retain their other contents and show image placeholders. Original damaged data is preserved and can be downloaded from Backup & Restore; if recovery storage is full, the original save stays protected until downloaded.

### 🏷️ Discreet Version Badge
- **Location**: Pinned in the **bottom-right corner** (`v1.8.1`) with a translucent glassmorphic backdrop. Clicking displays version and status information.

---

## ⌨️ Keyboard Shortcuts Reference

| Key / Shortcut | Tool / Action | Description |
|---|---|---|
| <kbd>V</kbd> | **Select Tool** | Click & drag marquee for multi-selection, move, resize |
| <kbd>P</kbd> | **Pen** | Natural velocity-tapered handwriting |
| <kbd>H</kbd> | **Highlighter** | Semi-transparent text marker |
| <kbd>E</kbd> | **Eraser** | Swept-circle object eraser |
| <kbd>B</kbd> | **Paint Bucket** | Fill the clicked connected colour region |
| <kbd>L</kbd> | **Line** | Straight vector line |
| <kbd>R</kbd> | **Rectangle** | Rectangle (Hold <kbd>Shift</kbd> for square) |
| <kbd>O</kbd> | **Ellipse** | Ellipse (Hold <kbd>Shift</kbd> for circle) |
| <kbd>A</kbd> | **Arrow** | Vector arrow with directional head |
| <kbd>T</kbd> | **Text** | Place editable text box |
| <kbd>N</kbd> | **Sticky Note** | Place sticky note |
| <kbd>K</kbd> | **Laser Pointer** | Glowing laser trail for presentations |
| <kbd>Space</kbd> *(hold)* | **Pan Canvas** | Pan the canvas with any active tool |
| <kbd>Scroll</kbd> | **Scroll Up/Down** | Pan canvas vertically |
| <kbd>Shift</kbd> + <kbd>Scroll</kbd> | **Scroll Left/Right** | Pan canvas horizontally |
| <kbd>Ctrl</kbd> + <kbd>Scroll</kbd> | **Zoom In/Out** | Zoom canvas centered at cursor |
| <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>+</kbd> / <kbd>−</kbd> | **Zoom In/Out** | Zoom the board with the keyboard |
| <kbd>Ctrl</kbd> + <kbd>Z</kbd> | **Undo** | Undo last edit, clear, or deleted page |
| <kbd>Ctrl</kbd> + <kbd>Y</kbd> / <kbd>Ctrl</kbd> + <kbd>Shift</kbd> + <kbd>Z</kbd> | **Redo** | Redo last canvas action |
| <kbd>Ctrl</kbd> + <kbd>A</kbd> | **Select All** | Select all objects on the current page |
| <kbd>Ctrl</kbd> + <kbd>C</kbd> | **Copy** | Copy selected objects to clipboard |
| <kbd>Ctrl</kbd> + <kbd>V</kbd> | **Paste** | Paste copied objects, image, or text |
| <kbd>Ctrl</kbd> + <kbd>D</kbd> | **Duplicate** | Duplicate current selection |
| <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>G</kbd> | **Group** | Combine selected items into one group |
| <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>G</kbd> | **Ungroup** | Separate the selected groups |
| <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> + <kbd>Shift</kbd> + <kbd>L</kbd> | **Lock / Unlock** | Protect or unlock selected items |
| <kbd>Alt</kbd> + Drag | **Quick Duplicate** | Clone selected objects while moving |
| <kbd>[</kbd> / <kbd>]</kbd> | **Z-Order** | Send to Back / Bring to Front |
| <kbd>Shift</kbd> *(while rotating)* | **Snap Rotation** | Align rotation angle to 15° steps |
| <kbd>Arrow Keys</kbd> | **Nudge** | Move selection (Hold <kbd>Shift</kbd> for 4× step) |
| <kbd>Del</kbd> / <kbd>Backspace</kbd> | **Delete** | Remove selected objects |
| <kbd>Ctrl</kbd> + <kbd>S</kbd> | **Manual Save** | Immediately trigger local storage save |
| <kbd>?</kbd> | **Help** | Toggle shortcut cheat sheet |
| <kbd>Esc</kbd> | **Deselect / Cancel** | Deselect active objects or dismiss modal |

---

## 🏗️ Project Architecture

```
brightboard/
├── index.html         # Semantic HTML5 entry point with embedded offline SVGs
├── css/
│   └── style.css      # Warm classroom design system & responsive media queries
├── js/
│   └── app.js         # Complete vector canvas engine, multi-selection, & state
├── .gitignore         # Git ignore configuration
├── LICENSE            # MIT License
└── README.md          # Project documentation
```

---

## 🚀 Local Development

No Node build tools or heavy dependencies required!

Validate with `node -c js/app.js` and `node --test tests/*.test.cjs`. For real-browser mobile checks, run `node tests/mobile-browser.cjs` with Chrome installed (or set `CHROME_BIN` to its executable). The browser check uses an isolated profile, emulated touch input, phone/tablet/desktop viewports, and writes screenshots to the ignored `.cache/mobile-review/` directory. Physical Safari/iOS and Android keyboard behavior should also be checked on devices when available.

### Option 1: Python Built-in Server
```bash
# Python 3
python -m http.server 8080
```
Visit `http://localhost:8080` in your browser.

### Option 2: Node.js `npx serve`
```bash
npx serve .
```

### Option 3: Direct File Opening
Double-click `index.html` to open in any browser directly.

---

## 🌐 Netlify Deployment

The website deploys automatically from this repository's `main` branch through Netlify:

1. Validate JavaScript with `node -c js/app.js`, run the regression suite with `node --test tests/*.test.cjs`, and check the affected browser flows.
2. Commit the verified change and push to `origin main`.
3. Netlify publishes the repository root as the static site; no build command is required.
4. Check the connected site's deploy status in Netlify before relying on the new version.

Repository: [rabit314/brightboard](https://github.com/rabit314/brightboard).
`Start Here.txt` is a historical single-file prototype; the maintained application is `index.html`, `css/style.css`, and `js/app.js`.

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).

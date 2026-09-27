# Syntax Studio — Compiler Design

A responsive, browser-based learning workspace for Soumi. It uses plain HTML, CSS and JavaScript; no package installation is required.

## Run it

Open `index.html` in a browser, or serve this folder with an editor's Live Server extension. State is stored in that browser's local storage.

## Learning path

The current topic map follows the course brief and the PDF filenames:

1. **Lexical Analysis** — scanner role, tokens and lexemes, token patterns, regular expressions and finite automata.
2. **Syntax Analysis** — context-free grammars, productions, parse trees, derivations, ambiguity and shift-reduce parsing.
3. **LR Parsing** — LR(0) items, closure/goto, parsing tables and conflicts; SLR(1) reductions using FOLLOW sets; CLR(1) lookahead items and the method trade-offs.

The learning path includes the LR(0) and SLR(1) topics and worked grammar exercises transcribed from the supplied Lecture 8 and Lecture 9 class notes.

## Included interactions

- An image-derived walkthrough for 18 lecture questions. It builds LR(0) automata with labeled GOTO edges as the learner advances, or builds concept maps for non-grammar slides. The source screenshots are not shown in the interface.
- The Assignments page includes the supplied class notes as openable and downloadable PDFs.
- Topic lessons with a quick check and saved completion state.
- A password-gated admin portal to upload assignment question PDFs, create/lock/unlock tasks, set deadlines, review written answers and preview submitted PDFs/images, and manage exam questions.
- Assignment question PDFs and learner uploads up to 5 MB are stored in the browser's IndexedDB. Uploaded PDFs are purged after 10 days when the app is open or next opened.
- A configurable, timed exam with automatically saved answers, automatic submission and a built-in calculator.
- A mobile bottom navigation bar with touch-sized controls and stacked exam layouts.
- PDF exam import for selectable-text MCQs: extracted questions and options appear in a review form, and the admin sets the correct answer before adding them to the exam.

PDF question extraction uses [Mozilla PDF.js](https://mozilla.github.io/pdf.js/getting_started/) loaded from a CDN. The PDF must contain selectable text; scanned image-only papers require OCR and are not auto-converted.

On first use, select **Admin portal** and create a password for that browser. This is a front-end prototype: the password and course data stay in that browser profile, and the password gate is not secure authentication. GitHub Pages cannot share assignments, uploaded work or exam settings between Soumi's device and the admin's device. The 10-day PDF cleanup is also browser-side, so it cannot run while the browser is closed or remove copies stored on another device. Cross-device accounts, shared submissions and server-enforced retention need a backend service.

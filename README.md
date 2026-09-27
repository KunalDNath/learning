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
- Teacher mode to create, lock and unlock assignments, set deadlines, and review submitted answers and attachments.
- A configurable exam window with a countdown, automatic submission, saved selections and a built-in calculator.

This is a front-end prototype: learner and teacher data live in one browser profile. Cross-device accounts, shared submissions, and secure server-side exam enforcement require a backend service.

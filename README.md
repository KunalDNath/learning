# Syntax Studio — Compiler Design

A responsive, browser-based learning workspace for Soumi. It uses plain HTML, CSS and JavaScript; no package installation is required.

## Run it

Serve this folder with an editor's Live Server extension or publish it as a static site. Learner progress and submissions stay in the browser; shared course assignments can use Google Drive after the setup below.

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
- A password-gated admin portal to create assignments using typed questions, an attached image/PDF, or both; set deadlines; review student answers; and manage exam questions.
- Students can submit written answers, a PDF answer sheet, or a JPG/PNG photo, up to 5 MB. With Google Drive connected, submissions are stored privately in Drive and admins can review them from another browser.
- Question images/PDFs have direct download buttons as well as an in-browser preview. In browser-only mode, attachments use IndexedDB; PDFs are purged after 10 days when the app is open or next opened.
- A configurable, timed exam with automatically saved answers, automatic submission and a built-in calculator.
- A mobile bottom navigation bar with touch-sized controls and stacked exam layouts.
- PDF exam import for text and scanned MCQs: scanned pages use browser OCR, then extracted questions and options appear in a review form for correction before adding to the exam.

PDF question extraction uses [Mozilla PDF.js](https://mozilla.github.io/pdf.js/getting_started/) and [Tesseract.js](https://github.com/naptha/tesseract.js), loaded from CDNs when needed. OCR runs in the browser; it may misread math symbols, question boundaries, or answer choices, so review every extracted question and select its correct answer before importing.

## Store shared assignments in Google Drive

The `drive-backend/Code.gs` Google Apps Script stores assignment metadata, exam settings, question attachments, and student submissions in your Drive. It runs as your Google account, so no Cloudflare account, GitHub token, or OAuth client is needed.

1. Open [script.google.com](https://script.google.com/) while signed in to the Google account whose Drive should hold the data. Create a project and replace its `Code.gs` with the contents of `drive-backend/Code.gs`.
2. In the Apps Script project, open **Project Settings → Script Properties** and add `ADMIN_PASSWORD` with a strong password. Keep this password private; it authorizes changes to assignments/exams and access to student submissions.
3. Choose **Deploy → New deployment → Web app**. Set **Execute as** to **Me** and **Who has access** to **Anyone**, then deploy and approve the Google Drive permissions. Copy the web app URL ending in `/exec`.
4. Paste that URL into `window.SYNTAX_STUDIO_DRIVE_URL` in `cloud-config.js`, publish the site, and open it from the published URL.
5. Open **Admin portal**, enter the same password, and create an assignment. The first save creates a `Syntax Studio shared data` folder in your Drive. Other browsers can then see the shared assignments by opening the published site and visiting Tasks.

After editing `Code.gs`, the deployed `/exec` URL keeps running its previously deployed version until you publish an update. Use **Deploy → Manage deployments → Edit → Version: New version → Deploy**. To check the read endpoint, open `<your /exec URL>?action=state` in a new browser; it should return JSON containing the shared `assignments` list.

The web app must be reachable by anyone so the learner can read course data; admin writes and submission review require the admin password. Question attachments and submitted answer files are stored privately in Drive and served through the script. The admin password is held in the current browser tab's session storage. On first admin sign-in, assignments already saved in that browser are copied to Drive if the shared assignment list is empty.

Learning progress remains in each learner browser's local storage. With the Drive URL configured, assignment submissions sync to Drive; without it, submissions stay in that browser. If neither backend URL is configured, assignments are browser-local too. The earlier Cloudflare Worker can share assignments and exam settings, but not learner submissions. The exam answer key is delivered to the client for scoring, so this app is not suitable for a high-stakes or proctored exam.

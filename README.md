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

## Shared admin storage setup

The site source is the GitHub repository `KunalDNath/learning` (`https://github.com/KunalDNath/learning.git`). The optional Cloudflare Worker connects the static site to shared storage. Assignment metadata and exam settings are committed to a separate private GitHub repository. This separation keeps admin data and exam answers out of the website's source repository. PDFs are stored in Cloudflare R2, not Git history, and the Worker removes expired objects once an hour after their 10-day retention period.

1. Create a **private** GitHub repository named `learning-private-data` under the configured owner, initialized with a README on the `main` branch. Create a fine-grained GitHub token with **Contents: Read and write** access to that repository.
2. Install Wrangler and sign in to Cloudflare. From the `worker` directory, create the bucket with `npx wrangler r2 bucket create learning-soumi-pdfs`.
3. Set the exact public website origin in `worker/wrangler.toml` (`ALLOWED_ORIGIN`; for GitHub Pages the origin is `https://kunaldnath.github.io`). Check the `DATA_REPO` owner/repository values too.
4. In `worker`, add Worker secrets with `npx wrangler secret put GITHUB_TOKEN`, `npx wrangler secret put ADMIN_PASSWORD`, and `npx wrangler secret put SESSION_SECRET`. Use a long random session secret. Do not put these values in this repository or in chat.
5. Deploy from `worker` with `npx wrangler deploy`. Copy the resulting `workers.dev` URL into `cloud-config.js` as `window.SYNTAX_STUDIO_API_URL`, commit and publish the site.

The admin password is configured once as a Worker secret; it is not saved in the browser or GitHub. A signed 30-day admin session is saved in the browser, so reopening the portal in that browser does not prompt again while the session is valid. Admins on another device sign in with the same Worker password. Assignments and exam settings then load from the shared private repo. The GitHub token stays server-side in the Worker.

Learner uploads/submissions and learner progress are still browser-local in this version. Only assignments, question PDFs and exam settings sync across devices. Exam questions and answers are served to this client-side app for scoring, so the answer key is not suitable for a high-stakes or proctored exam.

Without the Worker URL configured, the site continues to use browser-only storage. PDFs in that local mode are purged when the app is open or next opened. In cloud mode, the Worker Cron Trigger handles PDF deletion independently of browser use.

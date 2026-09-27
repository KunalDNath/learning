# Site updates

## Google Drive storage

- Added a Google Apps Script backend that stores shared assignment and exam configuration data plus question PDFs in the owner's Drive.
- Added Drive reads and password-protected admin writes, with one-time migration of assignments already saved in that browser.
- Added deployment instructions and a Drive URL setting in `cloud-config.js`.

## Learning and exams

- Added compiler design lessons on lexical analysis, syntax analysis, and LR parsing, including LR(0), SLR(1), and CLR(1).
- Added interactive walkthroughs for the supplied lecture questions and grammar exercises.
- Added a timed exam with saved answers, automatic submission, and an in-exam calculator.
- Added an admin exam setup form and PDF question-paper import. Selectable-text MCQs can be extracted for review; the admin edits the questions and selects correct answers before adding them to the exam.
- Added browser OCR fallback for scanned question-paper PDFs, with progress and a review step before importing recognized questions.

## Assignments and PDFs

- Added an admin portal for creating, locking, unlocking, and deleting assignments, setting due dates, and attaching question-paper PDFs.
- Added online PDF viewing for question papers and admin previews for submitted answers.
- Added a 5 MB upload limit and browser-side PDF cleanup after 10 days.
- Prepared a Cloudflare R2 storage path for question PDFs, with an hourly Worker cleanup that removes objects after their 10-day expiry.

## Mobile and time display

- Added mobile navigation and responsive layouts for lessons, assignments, and exams.
- Replaced the fixed greeting and date with an India-time greeting, current date, and live clock. The greeting changes between morning, afternoon, and evening.

## Shared admin storage (prepared, not deployed)

- Added a Cloudflare Worker that stores assignment data and exam settings in a separate private GitHub repository.
- Added password-based admin sign-in with a 30-day browser session. When the Worker is deployed and configured, the admin portal reuses a valid session instead of asking for the password each time.
- Added `cloud-config.js` for the deployed Worker URL and `worker/wrangler.toml` for the Worker, R2 bucket binding, and hourly cleanup schedule.
- Added deployment instructions in `README.md`.
- Cloud sync is not active until the private repository, GitHub token, Cloudflare secrets, R2 bucket, and Worker deployment are configured. Without that setup, the app uses browser-local storage.
- Learner submissions and progress remain browser-local. Exam settings/questions sync when cloud storage is configured; answers are included for client-side scoring, so this is not suitable for a high-stakes exam.

## Verification

- JavaScript syntax checks passed for `app.js` and `worker/src/index.js`.

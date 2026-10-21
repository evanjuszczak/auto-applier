# Project Spec: Handshake Quick-Apply Chrome Extension

## 0. Instructions for the Claude Agent (read first)

You are building a Google Chrome extension (Manifest V3) that automates applying to jobs on Handshake **only when the application is a fast, resume-only, in-platform application**. It must never submit external applications or applications that require extra documents or questions.

**Placeholders:** This spec uses placeholders like `{{SELECTOR_APPLY_BUTTON}}` wherever a real DOM selector, URL, or text label is needed. The user has not provided these yet.

- Put **every** placeholder in a single config file (`src/config/selectors.js`) so they can be filled in one place.
- Before you finish the first working build, **stop and ask the user for each placeholder value**. Give them a short checklist (see Section 9) and tell them how to find each one (right-click the element → Inspect → copy a stable attribute like `data-hook`, `aria-label`, `data-testid`, or button text).
- Prefer selectors in this order: `data-*` test/hook attributes → `aria-label` / `role` → visible button text → class names (last resort; Handshake class names are often auto-generated and change).
- Do not guess selectors and hard-code them silently. If you need to assume something to keep moving, mark it with `// TODO(ask-user):` and list it in your final summary.

Build in the order given in Section 10 and check in with the user after milestone 2 (dry-run mode working) before enabling real submissions.

---

## 1. Goal

From a Handshake job search results page, the extension should:

1. Read the list of job postings on the page.
2. Open each posting one at a time.
3. Determine whether it is a **quick, resume-only, internal** application.
4. If yes: click **Apply** → in the apply modal, confirm the resume is selected → click **Submit Application** → confirm success → close modal.
5. If no (external link, extra documents required, custom questions, already applied, etc.): skip it and log why.
6. Move to the next posting. When the visible list is exhausted, scroll / paginate to load more.
7. Repeat until there are no more postings, or the user hits **Stop**, or a configured max-applications limit is reached.
8. Show a summary: applied, skipped (with reasons), errors.

---

## 2. Scope & Non-Goals

**In scope**
- Handshake job search / postings list pages (URL pattern: `{{HANDSHAKE_JOBS_URL_PATTERN}}`, e.g. `https://*.joinhandshake.com/stu/postings*` or `https://app.joinhandshake.com/job-search*` — confirm with user).
- Applications where the only requirement is a resume already uploaded to the user's Handshake profile.

**Out of scope / must never do**
- Never click "Apply externally" / any button that leaves Handshake or opens an employer site.
- Never upload files, fill free-text answers, or answer screening questions.
- Never submit if the modal requires a cover letter, transcript, other document, or any required field beyond resume.
- Never enter credentials or handle login. The user must already be logged in.
- Never bypass CAPTCHAs or bot checks. If one appears, pause and alert the user.

---

## 3. Tech Stack & Structure

- Chrome Extension, **Manifest V3**
- Plain JavaScript (ES modules) — no build step required unless you find it necessary. If you add one, use Vite and keep it minimal.
- `chrome.storage.local` for settings, run state, and logs.

```
handshake-quick-apply/
├── manifest.json
├── src/
│   ├── config/
│   │   └── selectors.js        # ALL placeholders live here
│   ├── content/
│   │   ├── content.js          # main runner injected into Handshake pages
│   │   ├── dom-utils.js        # waitForElement, safeClick, scroll helpers, sleep
│   │   ├── classifier.js       # decides apply vs skip
│   │   └── runner.js           # state machine
│   ├── background/
│   │   └── service-worker.js   # message relay, badge updates, notifications
│   └── popup/
│       ├── popup.html
│       ├── popup.css
│       └── popup.js            # Start / Pause / Stop / settings / summary
├── icons/ (16, 48, 128 png — simple placeholder icons are fine)
└── README.md
```

### manifest.json requirements
- `manifest_version: 3`
- `permissions`: `storage`, `activeTab`, `scripting`, `notifications`
- `host_permissions`: `{{HANDSHAKE_HOST_PATTERN}}` (e.g. `https://*.joinhandshake.com/*`)
- `content_scripts` matching the Handshake host, `run_at: document_idle`
- `action` with the popup
- `background.service_worker`

---

## 4. Selector Config (placeholders)

Create `src/config/selectors.js` exactly like this, leaving placeholders until the user supplies values:

```js
export const SELECTORS = {
  // --- Job list page ---
  JOB_LIST_CONTAINER:      "{{SELECTOR_JOB_LIST_CONTAINER}}",   // scrollable list wrapper
  JOB_CARD:                "{{SELECTOR_JOB_CARD}}",             // each posting in the list
  JOB_CARD_TITLE:          "{{SELECTOR_JOB_CARD_TITLE}}",       // title text inside card
  JOB_CARD_COMPANY:        "{{SELECTOR_JOB_CARD_COMPANY}}",     // company name inside card
  JOB_CARD_APPLIED_BADGE:  "{{SELECTOR_JOB_CARD_APPLIED_BADGE}}", // "Applied" indicator, if any
  NEXT_PAGE_BUTTON:        "{{SELECTOR_NEXT_PAGE_BUTTON}}",     // if paginated rather than infinite scroll
  LOADING_SPINNER:         "{{SELECTOR_LOADING_SPINNER}}",

  // --- Job detail pane / page ---
  JOB_DETAIL_CONTAINER:    "{{SELECTOR_JOB_DETAIL_CONTAINER}}",
  APPLY_BUTTON:            "{{SELECTOR_APPLY_BUTTON}}",         // internal "Apply" button
  EXTERNAL_APPLY_BUTTON:   "{{SELECTOR_EXTERNAL_APPLY_BUTTON}}",// "Apply externally" button/link
  ALREADY_APPLIED_MARKER:  "{{SELECTOR_ALREADY_APPLIED_MARKER}}",

  // --- Apply modal ---
  APPLY_MODAL:             "{{SELECTOR_APPLY_MODAL}}",
  MODAL_RESUME_SECTION:    "{{SELECTOR_MODAL_RESUME_SECTION}}",
  MODAL_RESUME_SELECTED:   "{{SELECTOR_MODAL_RESUME_SELECTED}}",// confirms a resume is chosen
  MODAL_REQUIRED_SECTION:  "{{SELECTOR_MODAL_REQUIRED_SECTION}}",// any section (cover letter, transcript, questions)
  MODAL_SUBMIT_BUTTON:     "{{SELECTOR_MODAL_SUBMIT_BUTTON}}",
  MODAL_CLOSE_BUTTON:      "{{SELECTOR_MODAL_CLOSE_BUTTON}}",
  MODAL_SUCCESS_MARKER:    "{{SELECTOR_MODAL_SUCCESS_MARKER}}", // confirmation toast/text after submit
  MODAL_ERROR_MARKER:      "{{SELECTOR_MODAL_ERROR_MARKER}}",
};

// Text-based fallbacks (case-insensitive match on button/label text)
export const TEXT = {
  APPLY:            "{{TEXT_APPLY}}",            // e.g. "Apply"
  APPLY_EXTERNALLY: "{{TEXT_APPLY_EXTERNALLY}}", // e.g. "Apply externally"
  SUBMIT:           "{{TEXT_SUBMIT}}",           // e.g. "Submit Application"
  APPLIED:          "{{TEXT_APPLIED}}",          // e.g. "Applied"
  REQUIRED_DOC_KEYWORDS: ["cover letter", "transcript", "other document", "writing sample"], // confirm with user
};

export const URLS = {
  JOBS_URL_PATTERN: "{{HANDSHAKE_JOBS_URL_PATTERN}}",
};
```

Write a small `isPlaceholder(value)` helper. On start, if any **required** selector is still a placeholder, the runner must refuse to start and the popup must list which ones are missing.

---

## 5. Core Logic

### 5.1 State machine (`runner.js`)

States:
```
IDLE → SCANNING_LIST → OPENING_JOB → CLASSIFYING → APPLYING → CONFIRMING → NEXT_JOB
                                          ↓ (skip)                 ↓ (fail)
                                       NEXT_JOB  ←───────────────  LOG_ERROR
NEXT_JOB → (more cards?) OPENING_JOB : LOADING_MORE → (new cards?) SCANNING_LIST : DONE
Any state → PAUSED (user) / STOPPED (user) / HALTED (captcha, logged out, repeated errors)
```

- Persist current state + processed job IDs to `chrome.storage.local` after every job so a page reload or crash can resume without re-processing.
- Track processed jobs by a stable ID (job posting ID from the card link `href`, e.g. `/jobs/12345`). Fall back to `title + company` hash.

### 5.2 Classifier (`classifier.js`)

For the opened job, return `{ decision: "apply" | "skip", reason }`. Checks, in order:

1. Already applied marker present → `skip: already_applied`
2. External apply button present / apply button links off-site / opens new tab → `skip: external`
3. No internal apply button found → `skip: no_apply_button`
4. After opening the modal (step done in APPLYING, then re-classified):
   - Any required section other than resume (cover letter, transcript, other docs, screening questions, required inputs left empty) → close modal, `skip: requires_more_than_resume`
   - Resume not selected / no resume available → close modal, `skip: no_resume_selected`
5. Otherwise → `apply`

**Default to skip when unsure.** If any check throws or times out, skip and log.

### 5.3 Apply flow

1. Click job card → wait for `JOB_DETAIL_CONTAINER` to show the matching job (verify title matches card, to avoid acting on a stale pane).
2. Run pre-modal classifier checks.
3. Click `APPLY_BUTTON` → wait for `APPLY_MODAL`.
4. Run modal checks (5.2 step 4).
5. If **dry-run mode** is on: log "would submit", close modal, continue. **Dry-run is ON by default.**
6. Otherwise click `MODAL_SUBMIT_BUTTON` → wait for `MODAL_SUCCESS_MARKER` or `MODAL_ERROR_MARKER` (timeout ~10s).
7. Record result. Close modal if still open.

### 5.4 Loading more postings

- Detect whether the list uses **infinite scroll** or **pagination** (ask the user; support both behind a setting `listMode: "scroll" | "paginate"`).
- Scroll: scroll `JOB_LIST_CONTAINER` (or window if it's the page) to bottom, wait for spinner to disappear and for card count to increase. If count doesn't change after 3 attempts → DONE.
- Paginate: click `NEXT_PAGE_BUTTON` if present and enabled; wait for new cards; otherwise DONE.
- Use a `MutationObserver` + timeout rather than fixed sleeps where possible.

### 5.5 DOM utilities (`dom-utils.js`)

- `waitForElement(selector, { timeout, root, visible })` — MutationObserver-based, rejects on timeout.
- `findByText(tag, text, root)` — text fallback for buttons.
- `safeClick(el)` — scroll into view, check visible/enabled, dispatch real click; never click hidden elements.
- `humanDelay(min, max)` — random delay between actions.
- `scrollToBottom(container)`.

---

## 6. Safety, Pacing & Account Protection

- **Randomized delays** between every action (default 1.5–4s) and between jobs (default 5–12s). Configurable.
- **Max applications per run** (default 25) and an optional daily cap tracked in storage.
- **Halt conditions**: CAPTCHA/verification detected (`{{SELECTOR_CAPTCHA}}` + keyword check), redirected to login page, 3 consecutive errors, or unexpected URL change. On halt: stop, fire a Chrome notification, show reason in popup.
- **Never open new tabs or follow external links.** If a click would navigate off the Handshake host, cancel and skip.
- Only run on the active tab the user started it from.
- Add a short note in README: automated activity may conflict with Handshake's Terms of Service and could put the account at risk; the user runs it at their own discretion and should keep volumes reasonable.

---

## 7. Popup UI

Simple, clean popup with:

- Status line (Idle / Running / Paused / Stopped / Halted: reason / Done)
- Buttons: **Start**, **Pause/Resume**, **Stop**
- Toggles/inputs: Dry-run (default on), Max applications per run, Min/max delay, List mode (scroll/paginate)
- Optional filters: keyword include list, keyword exclude list (matched against title/company), skip companies list
- Live counters: Applied / Skipped / Errors
- "View log" section: last ~50 entries (timestamp, title, company, decision, reason)
- **Export log as CSV** button
- Warning banner if any required selectors are still placeholders

Popup ↔ content script communication via `chrome.runtime` / `chrome.tabs.sendMessage`. The content script owns the run; the popup only sends commands and reads state.

---

## 8. Logging

Each job produces a log entry:
```json
{ "id": "12345", "title": "...", "company": "...", "url": "...",
  "decision": "applied|skipped|error|dry_run",
  "reason": "external|already_applied|requires_more_than_resume|...",
  "timestamp": "ISO-8601" }
```
Store in `chrome.storage.local` (cap at ~2000 entries, drop oldest). Also `console.log` with a `[HS-QuickApply]` prefix for debugging.

---

## 9. Placeholder Checklist — ASK THE USER FOR THESE

When you reach this point, send the user this list and wait for answers:

1. Exact URL of the job search page they'll run it on (and host pattern)
2. Does the list load more by **infinite scroll** or **pagination**?
3. Selector (or HTML snippet) for: job list container, a single job card, title and company inside a card
4. Selector for the "Applied" badge on cards (if one exists)
5. Selector/text for the internal **Apply** button
6. Selector/text for the **Apply externally** button
7. Selector for the apply modal, the resume section, and how a "selected resume" looks
8. What the modal looks like when it asks for more (cover letter / transcript / questions) — an HTML snippet of one example is ideal
9. Selector/text for **Submit Application**
10. What appears after a successful submit (toast text / element)
11. Modal close button selector
12. Next-page button selector (if paginated)
13. Loading spinner selector

**Tip to give the user:** the easiest way is to right-click each element → Inspect → right-click the highlighted HTML → Copy → Copy outerHTML, and paste it. Ask for one example card, one detail pane, and one full apply modal (both a resume-only one and one requiring extra documents).

---

## 10. Build Milestones

1. **Scaffold**: manifest, folder structure, config with placeholders, popup shell, message passing working, placeholder-check warning.
2. **Dry-run**: list scanning, opening each job, classifier, modal open/inspect/close, logging, scrolling/pagination — **no submits**. → **Check in with user; ask for selectors (Section 9) if not already provided; have them test dry-run on a real page.**
3. **Live submit**: enable submit path behind dry-run toggle, success/error detection.
4. **Hardening**: halt conditions, resume-after-reload, consecutive-error handling, daily cap, CSV export.
5. **Polish**: README with install steps (chrome://extensions → Developer mode → Load unpacked), screenshots optional, troubleshooting section for "selectors changed".

---

## 11. Acceptance Criteria

- Refuses to start while required placeholders are unfilled, and says which.
- In dry-run, correctly logs apply vs skip for every visible posting and loads additional postings until none remain.
- Never clicks external apply, never leaves Handshake, never opens new tabs.
- Skips anything requiring more than a resume.
- Live mode submits resume-only applications and confirms success.
- Stop/Pause respond within one action step.
- Survives a page reload mid-run without re-applying to the same job.
- Halts and notifies on CAPTCHA, logout, or repeated errors.

## 12. Deliverable

A loadable unpacked extension folder plus README. In your final message to the user, list: what was built, any remaining `TODO(ask-user)` items, and how to install and test in dry-run first.

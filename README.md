# Handshake Quick Apply

Handshake Quick Apply is a Chrome Manifest V3 extension for inspecting job listings and optionally submitting resume-only applications.

Automated activity may conflict with Handshake's Terms of Service and could put your account at risk. Use the extension at your own discretion and keep activity reasonable. It does not bypass CAPTCHAs, handle credentials, answer questions, upload documents, or apply externally.

## Install

1. Open `chrome://extensions` in Chrome.
2. Enable **Developer mode**.
3. Select **Load unpacked** and choose this repository folder.
4. Sign in to Handshake yourself and open your job search page.
5. If the tab was already open when you loaded or reloaded the extension, the first popup command injects and verifies the page runner. If Chrome still reports no receiver, reload the extension and refresh the Handshake tab.

## Dry-run and live apply

Dry-run is the default. Select the listing mode, maximum potential applies, and action delay, then choose **Start dry-run** to inspect jobs without submitting. To submit, check **Submit eligible applications** and confirm the prompt; only applications with the selected resume and no other required sections are submitted. If Handshake does not confirm a submission, the runner halts to avoid risking a duplicate.

Selectors were verified against the logged-in `uwgb.joinhandshake.com` page, including the **Quick apply** button and resume-only modal shown in the supplied screenshot. The URL pattern accepts Handshake school subdomains. Key observed selectors:

| Element | Selector |
| --- | --- |
| Job list | `[data-hook="left-content"][aria-label="Jobs List"]` |
| Listing card | `[data-hook^="job-result-card |"]` |
| Card title | `[role="region"] [id][aria-label]` |
| Card company | `img[alt]` |
| Detail pane | `[data-hook="right-content"]` |
| Quick apply button | Button whose visible text is exactly `Quick apply` |
| Pagination | `nav[data-hook="job-search-pagination"] button[aria-label="next page"]` |
| Application modal | `div[role="dialog"][aria-labelledby^="apply-modal-title-"]` |
| Resume heading | `[data-hook="apply-modal-content"] h4` (first heading) |
| Selected resume | `[data-hook="apply-modal-content"] [role="status"][aria-label="alert positive"]` |
| Modal close | `button[data-hook="apply-modal-close-button"]` |

The list has a next-page control; the runner defaults to pagination. It opens one card at a time and waits for the detail title to match, while keeping the list open and selecting the next unprocessed card in place. It does not use browser Back between jobs, which can reset Handshake's listing position. If Handshake removes the list during processing, the runner halts instead of navigating back and unexpectedly restarting at the first listing. Quick apply detection accepts visible button text or accessible labels and briefly retries while controls load; an explicit **Quick apply** control takes precedence over unrelated off-site links. Every Quick apply listing is considered regardless of location or work arrangement. External applications are skipped only when a Quick apply control is unavailable and an external apply control is present. After reloading an updated extension, previous `external`, `no_apply_button`, `outside_wisconsin`, and hidden/disabled click skips are retried; already-applied records remain processed. A Quick apply modal is eligible only when a resume is selected and no extra required sections are present. The inspected Pace Mayo modal had a selected resume **and** a cover-letter section and is skipped; the Johns Disposal modal shown in the supplied screenshot had only the selected resume and is eligible. Extra document sections and required fields are treated conservatively as skip reasons. Selectors and text labels are centralized in `src/config/selectors.js`.

The popup status shows why a run ended: reaching the configured potential-application limit, exhausting pagination, or failing to load the next page. The default limit is 25 eligible applications; skipped listings do not count toward it.

## Current limitations

- The inspected job's modal asked for a cover letter in addition to its already-selected resume, so the dry-run classifier should skip that job.
- The live DOM did not expose an applied badge, success marker, loading indicator, or CAPTCHA marker; optional selector slots for those remain unconfigured. Generic text detection is used for external-apply and applied indicators.
- Test manually in dry-run on a small number of postings first. Live submission is opt-in and requires confirming a prompt before it starts.

## Troubleshooting: "Receiving end does not exist"

The popup checks for a page-script receiver before each command. If the Handshake tab predates the extension load/reload, it injects the configured content scripts and pings the receiver before sending Start/Pause/Resume/Stop. If that still fails, open `chrome://extensions`, reload this extension, refresh the Handshake tab, and reopen the popup. Confirm Chrome shows the extension as enabled and the active tab is an HTTPS `*.joinhandshake.com` page.

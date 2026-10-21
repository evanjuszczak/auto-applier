(function () {
  const SELECTORS = {
    JOB_LIST_CONTAINER: '[data-hook="left-content"][aria-label="Jobs List"]',
    JOB_CARD: '[data-hook^="job-result-card |"]',
    JOB_CARD_TITLE: '[role="region"] [id][aria-label]',
    JOB_CARD_COMPANY: 'img[alt]',
    JOB_CARD_APPLIED_BADGE: "{{SELECTOR_JOB_CARD_APPLIED_BADGE}}",
    NEXT_PAGE_BUTTON: 'nav[data-hook="job-search-pagination"] button[aria-label="next page"]',
    LOADING_SPINNER: "{{SELECTOR_LOADING_SPINNER}}",
    JOB_DETAIL_CONTAINER: '[data-hook="right-content"]',
    JOB_DETAIL_TITLE: '[data-hook="right-content"] h1',
    APPLY_BUTTON: 'button[aria-label="Quick apply"]',
    EXTERNAL_APPLY_BUTTON: "{{SELECTOR_EXTERNAL_APPLY_BUTTON}}",
    ALREADY_APPLIED_MARKER: "{{SELECTOR_ALREADY_APPLIED_MARKER}}",
    APPLY_MODAL: 'div[role="dialog"][aria-labelledby^="apply-modal-title-"]',
    MODAL_RESUME_SECTION: '[data-hook="apply-modal-content"] h4',
    MODAL_RESUME_SELECTED: '[data-hook="apply-modal-content"] [role="status"][aria-label="alert positive"]',
    MODAL_REQUIRED_SECTION: '[data-hook="apply-modal-content"] h4, [required], [aria-required="true"]',
    MODAL_SUBMIT_BUTTON: 'button',
    MODAL_CLOSE_BUTTON: 'button[data-hook="apply-modal-close-button"]',
    MODAL_SUCCESS_MARKER: "{{SELECTOR_MODAL_SUCCESS_MARKER}}",
    MODAL_ERROR_MARKER: "{{SELECTOR_MODAL_ERROR_MARKER}}",
    CAPTCHA: "{{SELECTOR_CAPTCHA}}"
  };

  const TEXT = {
    APPLY: "Quick apply",
    APPLY_FALLBACK: "Apply",
    APPLY_EXTERNALLY: "Apply externally",
    SUBMIT: "Submit Application",
    APPLIED: "Applied",
    REQUIRED_DOC_KEYWORDS: [
      "cover letter",
      "transcript",
      "other document",
      "writing sample",
      "screening question",
      "question"
    ]
  };

  const URLS = {
    JOBS_URL_PATTERN: "https://*.joinhandshake.com/job-search*"
  };

  const REQUIRED_SELECTORS = [
    "JOB_LIST_CONTAINER",
    "JOB_CARD",
    "JOB_CARD_TITLE",
    "JOB_CARD_COMPANY",
    "JOB_DETAIL_CONTAINER",
    "APPLY_BUTTON",
    "APPLY_MODAL",
    "MODAL_RESUME_SECTION",
    "MODAL_RESUME_SELECTED",
    "MODAL_REQUIRED_SECTION",
    "MODAL_CLOSE_BUTTON"
  ];

  const OPTIONAL_SELECTORS = [
    "JOB_CARD_APPLIED_BADGE",
    "NEXT_PAGE_BUTTON",
    "LOADING_SPINNER",
    "ALREADY_APPLIED_MARKER",
    "MODAL_SUBMIT_BUTTON",
    "MODAL_SUCCESS_MARKER",
    "MODAL_ERROR_MARKER",
    "CAPTCHA"
  ];

  function isPlaceholder(value) {
    return typeof value !== "string" || value.includes("{{") || !value.trim();
  }

  function missingRequiredSelectors() {
    return REQUIRED_SELECTORS.filter((key) => isPlaceholder(SELECTORS[key]))
      .concat(isPlaceholder(URLS.JOBS_URL_PATTERN) ? ["JOBS_URL_PATTERN"] : []);
  }

  window.HSQuickApply = window.HSQuickApply || {};
  Object.assign(window.HSQuickApply, {
    SELECTORS,
    TEXT,
    URLS,
    REQUIRED_SELECTORS,
    OPTIONAL_SELECTORS,
    isPlaceholder,
    missingRequiredSelectors
  });
})();

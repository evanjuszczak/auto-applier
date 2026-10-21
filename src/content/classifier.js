(function () {
  const api = window.HSQuickApply;
  const { SELECTORS, TEXT } = api;

  function hasText(element, expected) {
    return element && api.text(element).toLocaleLowerCase().includes(expected.toLocaleLowerCase());
  }

  function labels(element) {
    return [api.text(element), element.getAttribute("aria-label"), element.getAttribute("title")]
      .filter(Boolean)
      .map((label) => label.replace(/\s+/g, " ").trim().toLocaleLowerCase());
  }

  function hasLabel(element, expected) {
    return labels(element).some((label) => label === expected.toLocaleLowerCase());
  }

  function findQuickApply(detail) {
    return api.queryAll(SELECTORS.APPLY_BUTTON, detail).find(api.isVisible) ||
      api.queryAll("button,[role='button'],a[role='button']", detail).find((element) =>
        api.isVisible(element) && hasLabel(element, TEXT.APPLY)
      ) ||
      null;
  }

  function classifyJob(detail) {
    const applied = api.query(SELECTORS.ALREADY_APPLIED_MARKER, detail) ||
      api.query('[aria-label="Applied"]', detail);
    const appliedText = TEXT.APPLIED && !api.isPlaceholder(TEXT.APPLIED)
      ? api.findByText("button,[role='status']", TEXT.APPLIED, detail)
      : null;
    if (applied || appliedText) {
      return { decision: "skip", reason: "already_applied" };
    }

    const quickApply = findQuickApply(detail);
    if (quickApply) {
      return { decision: "inspect_modal", reason: "internal_apply_available", applyButton: quickApply };
    }

    const externalText = TEXT.APPLY_EXTERNALLY && !api.isPlaceholder(TEXT.APPLY_EXTERNALLY)
      ? api.queryAll("a[href],button,[role='button']", detail).find((element) =>
        api.isVisible(element) &&
        labels(element).some((label) => label.includes(TEXT.APPLY_EXTERNALLY.toLocaleLowerCase()))
      )
      : null;
    const externalControl = api.queryAll("a[href],button,[role='button']", detail).find((element) => {
      const target = new URL(element.href, location.href);
      const externalDestination = target.hostname !== "joinhandshake.com" &&
        !target.hostname.endsWith(".joinhandshake.com");
      return externalDestination && labels(element).some((label) =>
        /^(apply|apply now|apply on company site)$/.test(label)
      );
    });
    const external = api.query(SELECTORS.EXTERNAL_APPLY_BUTTON, detail) || externalText || externalControl;
    if (external) return { decision: "skip", reason: "external" };

    const apply = api.queryAll("button,[role='button'],a[role='button']", detail).find((element) =>
      api.isVisible(element) && hasLabel(element, TEXT.APPLY_FALLBACK)
    );
    if (!apply) return { decision: "skip", reason: "no_apply_button" };

    const destination = apply.getAttribute("href") || apply.closest("a")?.getAttribute("href");
    if (destination) {
      const target = new URL(destination, location.href);
      if (target.hostname !== "joinhandshake.com" &&
        !target.hostname.endsWith(".joinhandshake.com")) {
        return { decision: "skip", reason: "external" };
      }
    }

    return { decision: "inspect_modal", reason: "internal_apply_available", applyButton: apply };
  }

  function classifyModal(modal) {
    const resume = api.query(SELECTORS.MODAL_RESUME_SECTION, modal);
    const selectedResume = api.query(SELECTORS.MODAL_RESUME_SELECTED, modal);
    if (!resume || !selectedResume || !api.isVisible(selectedResume)) {
      return { decision: "skip", reason: "no_resume_selected" };
    }

    const requiredSections = api.queryAll(SELECTORS.MODAL_REQUIRED_SECTION, modal)
      .filter(api.isVisible);
    if (requiredSections.some((section) => section !== resume && !resume.contains(section))) {
      return { decision: "skip", reason: "requires_more_than_resume" };
    }

    if (TEXT.REQUIRED_DOC_KEYWORDS.some((keyword) => hasText(modal, keyword))) {
      return { decision: "skip", reason: "requires_more_than_resume" };
    }

    return { decision: "eligible", reason: "resume_only_quick_apply" };
  }

  Object.assign(api, { classifyJob, classifyModal, findQuickApply });
})();

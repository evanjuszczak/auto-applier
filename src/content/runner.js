(function () {
  const api = window.HSQuickApply;
  const { SELECTORS } = api;
  const STORAGE_KEY = "hsQuickApply";
  const LOG_LIMIT = 2000;
  const EXTERNAL_CLASSIFICATION_VERSION = 5;

  class Runner {
    constructor() {
      this.status = "idle";
      this.stopRequested = false;
      this.pauseRequested = false;
      this.processedIds = new Set();
      this.counts = { applied: 0, skipped: 0, errors: 0, dryRun: 0 };
      this.runEligibleCount = 0;
      this.runPromise = null;
      this.runMode = "dry-run";
      this.finishReason = "";
    }

    async load() {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const saved = stored[STORAGE_KEY] || {};
      this.processedIds = new Set(saved.processedIds || []);
      if (saved.externalClassificationVersion !== EXTERNAL_CLASSIFICATION_VERSION) {
        const latestById = new Map();
        for (const entry of saved.log || []) {
          if (entry.id) latestById.set(entry.id, entry);
        }
        for (const [id, entry] of latestById) {
          if ((entry.decision === "skipped" &&
            ["external", "no_apply_button", "outside_wisconsin"].includes(entry.reason)) ||
            (entry.decision === "error" &&
              entry.reason === "Refused to click a hidden or disabled element.")) {
            this.processedIds.delete(id);
          }
        }
      }
      this.counts = { ...this.counts, ...(saved.counts || {}) };
      if (saved.status) this.status = saved.status;
      this.runMode = saved.runMode || "dry-run";
      // A run saved as active but not running in this page was cut off (e.g. a page reload).
      if (!this.runPromise && (saved.status === "running" || saved.status === "paused")) {
        this.status = "stopped";
        this.finishReason = "The previous run was interrupted (page reloaded or navigated). Start again to continue.";
        await this.save();
        return { ...saved, status: this.status, finishReason: this.finishReason };
      }
      return saved;
    }

    async save(extra = {}) {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const saved = stored[STORAGE_KEY] || {};
      const value = {
        ...saved,
        ...extra,
        status: this.status,
        runMode: this.runMode,
        finishReason: this.finishReason,
        externalClassificationVersion: EXTERNAL_CLASSIFICATION_VERSION,
        processedIds: Array.from(this.processedIds),
        counts: this.counts,
        updatedAt: new Date().toISOString()
      };
      await chrome.storage.local.set({ [STORAGE_KEY]: value });
      chrome.runtime.sendMessage({ type: "hs-status", state: value }).catch(() => {});
    }

    async log(job, decision, reason) {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      const saved = stored[STORAGE_KEY] || {};
      const entry = {
        id: job.id,
        title: job.title,
        company: job.company,
        url: job.url,
        decision,
        reason,
        timestamp: new Date().toISOString()
      };
      const log = [...(saved.log || []), entry].slice(-LOG_LIMIT);
      if (decision === "dry_run") {
        this.counts.dryRun++;
        this.runEligibleCount++;
      } else if (decision === "skipped") this.counts.skipped++;
      else if (decision === "applied") {
        this.counts.applied++;
        this.runEligibleCount++;
      }
      else if (decision === "error") this.counts.errors++;
      console.info(`[HS-QuickApply] ${decision}: ${reason} — ${job.title} (${job.company})`);
      await this.save({ log });
    }

    async waitIfPaused() {
      while (this.pauseRequested && !this.stopRequested) {
        await api.sleep(250);
      }
    }

    makeJob(card) {
      const title = api.text(api.query(SELECTORS.JOB_CARD_TITLE, card));
      const companyElement = api.query(SELECTORS.JOB_CARD_COMPANY, card);
      const company = companyElement?.getAttribute("alt") || api.text(companyElement);
      const anchor = card.matches("a[href^='/job-search/']") ? card :
        card.querySelector("a[role='button'][href^='/job-search/'], a[href^='/job-search/']");
      const url = anchor ? new URL(anchor.getAttribute("href"), location.href).href : location.href;
      const hookId = card.getAttribute("data-hook")?.match(/job-result-card\s*\|\s*(\d+)/i)?.[1];
      const id = hookId || url.match(/\/(?:jobs|postings|job-search)\/([^/?#]+)/i)?.[1] ||
        `${title.toLocaleLowerCase()}|${company.toLocaleLowerCase()}`;
      return { id, title, company, url };
    }

    async processCard(card, settings) {
      const job = this.makeJob(card);
      if (this.processedIds.has(job.id)) return;
      await this.waitIfPaused();
      if (this.stopRequested) return;

      try {
        if (this.isHaltedPage()) {
          throw new Error("CAPTCHA or sign-in check detected; stopped for manual review.");
        }
        // A leftover apply modal or post-apply popup blocks the next job.
        if (!(await this.dismissDialogs())) {
          throw new Error("A popup on the page could not be closed; stopped for manual review.");
        }
        const cardApplied = api.query(SELECTORS.JOB_CARD_APPLIED_BADGE, card) ||
          api.findByText("[data-hook], [role='status'], span", api.TEXT.APPLIED, card);
        if (cardApplied) {
          await this.log(job, "skipped", "already_applied");
          this.processedIds.add(job.id);
          await this.save();
          return;
        }

        const cardLink = card.querySelector("a[role='button'][href^='/job-search/']");
        if (!cardLink && !api.isVisible(card)) {
          throw new Error("The job card is no longer visible in the current listing.");
        }
        api.safeClick(cardLink || card);
        const detail = await this.waitForJobDetail(job.title);

        const classification = await this.waitForJobClassification(job.title, detail);
        if (classification.decision === "skip") {
          await this.log(job, "skipped", classification.reason);
        } else {
          await api.randomDelay(settings.minDelayMs, settings.maxDelayMs);
          const refreshedClassification = await this.waitForJobClassification(job.title);
          if (refreshedClassification.decision === "skip") {
            await this.log(job, "skipped", refreshedClassification.reason);
          } else {
            await this.clickQuickApply(job.title, refreshedClassification);
            const modal = await api.waitForElement(SELECTORS.APPLY_MODAL, { timeout: 8000 });
            const modalResult = api.classifyModal(modal);
            if (modalResult.decision !== "eligible") {
              await this.log(job, "skipped", modalResult.reason);
              const close = api.query(SELECTORS.MODAL_CLOSE_BUTTON, modal);
              if (close) api.safeClick(close);
            } else if (settings.dryRun !== false) {
              await this.log(job, "dry_run", modalResult.reason);
              const close = api.query(SELECTORS.MODAL_CLOSE_BUTTON, modal);
              if (close) api.safeClick(close);
            } else {
              const submitButton = api.findByText(
                SELECTORS.MODAL_SUBMIT_BUTTON,
                api.TEXT.SUBMIT,
                modal
              );
              if (!submitButton || submitButton.matches(":disabled,[aria-disabled='true']")) {
                throw new Error("Resume-only modal did not have an enabled Submit Application button.");
              }
              await api.randomDelay(settings.minDelayMs, settings.maxDelayMs);
              const previousPageText = document.body?.innerText || "";
              api.safeClick(submitButton);
              const result = await this.waitForSubmissionResult(modal, previousPageText);
              if (result.success) {
                await this.log(job, "applied", result.reason);
                // Handshake can leave the modal open or show a follow-up popup after applying.
                await this.dismissDialogs();
              } else {
                await this.log(job, "error", result.reason);
                this.stopRequested = true;
                this.status = "halted";
                await this.save({ haltReason: "Application result was not confirmed; stopped to avoid duplicate submissions." });
              }
            }
          }
        }

        this.processedIds.add(job.id);
        await this.save();
      } catch (error) {
        await this.log(job, "error", error.message || "inspection_failed");
        this.processedIds.add(job.id);
        if (error.message?.includes("CAPTCHA or sign-in")) {
          this.stopRequested = true;
          this.status = "halted";
          await this.save({ haltReason: error.message });
        } else if (settings.dryRun === false) {
          this.stopRequested = true;
          this.status = "halted";
          await this.save({
            haltReason: "A live application step failed; stopped to avoid skipping or duplicating an application."
          });
        }
        await this.save();
      }
    }

    async waitForSubmissionResult(modal, previousPageText) {
      const successSelector = SELECTORS.MODAL_SUCCESS_MARKER;
      const successPattern = /\b(application (?:has been )?submitted|application sent|successfully applied|application successful|application complete|you applied|your application has been received)\b/i;
      const deadline = Date.now() + 15000;
      let modalClosedAt = null;
      while (Date.now() < deadline) {
        const marker = api.query(successSelector);
        if (marker && api.isVisible(marker)) {
          return { success: true, reason: "success_marker" };
        }
        const pageText = document.body?.innerText || "";
        if (successPattern.test(pageText) && !successPattern.test(previousPageText)) {
          return { success: true, reason: "success_confirmation" };
        }
        const detail = api.query(SELECTORS.JOB_DETAIL_CONTAINER);
        const appliedButton = detail && api.findByText("button,[role='button']", "Applied", detail);
        if (appliedButton) {
          return { success: true, reason: "applied_status" };
        }
        if (!api.isVisible(modal)) {
          // The modal can close a moment before the "Applied" status renders.
          modalClosedAt ??= Date.now();
          if (Date.now() - modalClosedAt > 4000) {
            return { success: false, reason: "submission_unconfirmed_modal_closed" };
          }
        }
        await api.sleep(200);
      }
      return { success: false, reason: "submission_unconfirmed_timeout" };
    }

    openDialogs() {
      const list = api.query(SELECTORS.JOB_LIST_CONTAINER);
      const detail = api.query(SELECTORS.JOB_DETAIL_CONTAINER);
      return api.queryAll("[role='dialog'], [role='alertdialog'], dialog[open]")
        .filter((dialog) => api.isVisible(dialog) &&
          !(list && dialog.contains(list)) &&
          !(detail && dialog.contains(detail)));
    }

    findDismissButton(dialog) {
      const close = api.query(SELECTORS.MODAL_CLOSE_BUTTON, dialog);
      if (close && api.isVisible(close)) return close;
      const dismissLabel = /^(close|close modal|close dialog|dismiss|done|not now|no thanks|maybe later|got it|ok|×|x)$/i;
      return api.queryAll("button, [role='button']", dialog).find((element) => {
        if (!api.isVisible(element) || element.matches(":disabled,[aria-disabled='true']")) return false;
        return [element.getAttribute("aria-label"), api.text(element)]
          .some((label) => label && dismissLabel.test(label.replace(/\s+/g, " ").trim()));
      }) || null;
    }

    async dismissDialogs(timeout = 6000) {
      const deadline = Date.now() + timeout;
      while (Date.now() < deadline) {
        const dialogs = this.openDialogs();
        if (!dialogs.length) return true;
        for (const dialog of dialogs) {
          const button = this.findDismissButton(dialog);
          if (button) {
            try {
              api.safeClick(button);
            } catch {
              // Fall through to Escape below.
            }
          } else {
            api.pressEscape(dialog);
          }
        }
        await api.sleep(400);
      }
      return this.openDialogs().length === 0;
    }

    async waitForJobDetail(expectedTitle) {
      const deadline = Date.now() + 8000;
      while (Date.now() < deadline) {
        const detail = api.query(SELECTORS.JOB_DETAIL_CONTAINER);
        const title = api.text(api.query(SELECTORS.JOB_DETAIL_TITLE, detail));
        if (detail && title && title.toLocaleLowerCase().includes(expectedTitle.toLocaleLowerCase())) {
          return detail;
        }
        await api.sleep(100);
      }
      throw new Error(`Job detail did not load for "${expectedTitle}".`);
    }

    async waitForJobClassification(expectedTitle, initialDetail = null) {
      const deadline = Date.now() + 1800;
      let detail = initialDetail;
      let classification;
      do {
        detail = await this.waitForJobDetail(expectedTitle);
        classification = api.classifyJob(detail);
        if (classification.decision !== "skip" ||
          !["external", "no_apply_button"].includes(classification.reason)) {
          return classification;
        }
        await api.sleep(200);
      } while (Date.now() < deadline);
      return classification;
    }

    async clickQuickApply(expectedTitle, classification) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const latest = attempt === 0
          ? classification
          : await this.waitForJobClassification(expectedTitle);
        if (latest.decision !== "inspect_modal") {
          throw new Error(`Quick apply control disappeared for "${expectedTitle}".`);
        }
        try {
          api.safeClick(latest.applyButton);
          return;
        } catch (error) {
          if (attempt === 1 || !error.message?.includes("hidden or disabled")) throw error;
          await api.sleep(150);
        }
      }
    }

    isHaltedPage() {
      if (api.query(SELECTORS.CAPTCHA)) return true;
      const pageText = document.body?.innerText?.toLocaleLowerCase() || "";
      return ["verify you are human", "checking your browser", "sign in to continue"]
        .some((phrase) => pageText.includes(phrase));
    }

    async start(settings = {}) {
      const missing = api.missingRequiredSelectors();
      if (missing.length) {
        this.status = "idle";
        await this.save({ missingSelectors: missing });
        return { success: false, error: "Missing required selectors.", missing };
      }

      if (location.hostname !== "joinhandshake.com" &&
        !location.hostname.endsWith(".joinhandshake.com")) {
        return { success: false, error: "Open a Handshake page before starting." };
      }
      const urlPattern = api.URLS.JOBS_URL_PATTERN;
      const urlRegex = new RegExp(`^${urlPattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*")}$`);
      if (!urlRegex.test(location.href)) {
        return { success: false, error: "This page does not match the configured Handshake jobs URL." };
      }
      if (this.runPromise && (this.status === "running" || this.status === "paused")) {
        return { success: false, error: "A run is already active." };
      }

      const saved = await this.load();
      const requestedMode = settings.dryRun === false ? "live" : "dry-run";
      const previousMode = saved.runMode ||
        ((saved.counts?.dryRun || 0) > 0 ? "dry-run" : null);
      if (previousMode && previousMode !== requestedMode) {
        this.processedIds.clear();
      }
      if (!api.query(SELECTORS.JOB_LIST_CONTAINER)) {
        return { success: false, error: "Open the Handshake job-search listings page before starting." };
      }
      this.stopRequested = false;
      this.pauseRequested = false;
      this.runEligibleCount = 0;
      this.runMode = requestedMode;
      this.finishReason = "";
      this.status = "running";
      await this.save({
        missingSelectors: [],
        runMode: requestedMode,
        finishReason: "",
        haltReason: "",
        maxApplications: Math.max(1, Number(settings.maxApplications) || 25)
      });

      this.runPromise = this.run(settings).catch(async (error) => {
        console.error("[HS-QuickApply] Run failed:", error);
        this.status = "halted";
        await this.save({ haltReason: error.message || "Unexpected runner error." });
      });
      return { success: true, status: this.status };
    }

    async run(settings) {
      const maxApplications = Math.max(1, Number(settings.maxApplications) || 25);
      let noGrowthAttempts = 0;
      let completionReason = "";

      while (!this.stopRequested && this.runEligibleCount < maxApplications) {
        if (this.isHaltedPage()) {
          this.status = "halted";
          this.stopRequested = true;
          await this.save({ haltReason: "CAPTCHA or sign-in check detected; stopped for manual review." });
          break;
        }
        await this.waitIfPaused();
        if (this.stopRequested) break;
        const currentList = api.query(SELECTORS.JOB_LIST_CONTAINER);
        if (!currentList) {
          this.status = "halted";
          this.stopRequested = true;
          await this.save({
            haltReason: "The job list disappeared while processing; stopped without navigating back and resetting the listing."
          });
          break;
        }
        const cards = api.queryAll(SELECTORS.JOB_CARD, currentList).filter(api.isVisible);
        const nextCard = cards.find((card) => !this.processedIds.has(this.makeJob(card).id));
        if (nextCard) {
          await this.processCard(nextCard, settings);
          await api.randomDelay(settings.minDelayMs, settings.maxDelayMs);
          continue;
        }

        if (settings.listMode === "paginate") {
          const next = api.query(SELECTORS.NEXT_PAGE_BUTTON);
          if (!next || next.matches(":disabled,[aria-disabled='true']")) {
            completionReason = "No next page is available.";
            break;
          }
          const seenBeforePage = new Set(
            cards.map((card) => this.makeJob(card).id)
          );
          api.safeClick(next);
          const pageChangeDeadline = Date.now() + 10000;
          let cardsAfterPage = [];
          while (Date.now() < pageChangeDeadline) {
            await api.sleep(100);
            cardsAfterPage = api.queryAll(
              SELECTORS.JOB_CARD,
              api.query(SELECTORS.JOB_LIST_CONTAINER) || document
            );
            if (cardsAfterPage.some((card) => !seenBeforePage.has(this.makeJob(card).id))) break;
          }
          const hasNewJobs = cardsAfterPage.some((card) => !seenBeforePage.has(this.makeJob(card).id));
          if (!hasNewJobs) {
            completionReason = "Pagination did not load new job listings within 10 seconds.";
            break;
          }
          noGrowthAttempts = 0;
          continue;
        }

        api.scrollToBottom(currentList);
        await api.sleep(1200);
        // Only count visible cards; hidden unprocessed cards would otherwise loop forever.
        const newCards = api.queryAll(SELECTORS.JOB_CARD, api.query(SELECTORS.JOB_LIST_CONTAINER) || document)
          .filter((card) => api.isVisible(card) && !this.processedIds.has(this.makeJob(card).id));
        noGrowthAttempts = newCards.length ? 0 : noGrowthAttempts + 1;
        if (noGrowthAttempts >= 3) {
          completionReason = "No additional listings loaded after three scroll attempts.";
          break;
        }
      }

      if (this.status !== "halted") {
        this.status = this.stopRequested ? "stopped" : "done";
        this.finishReason = this.status === "stopped"
          ? "Stopped by user."
          : this.runEligibleCount >= maxApplications
            ? `Reached the configured maximum of ${maxApplications} potential applications.`
            : completionReason || "Run completed.";
        await this.save({ finishReason: this.finishReason });
      }
    }

    async pause() {
      if (this.status !== "running") return { success: false, error: "No active run to pause." };
      this.pauseRequested = true;
      this.status = "paused";
      await this.save();
      return { success: true, status: this.status };
    }

    async resume() {
      if (this.status !== "paused") return { success: false, error: "No paused run to resume." };
      this.pauseRequested = false;
      this.status = "running";
      await this.save();
      return { success: true, status: this.status };
    }

    async stop() {
      if (this.status !== "running" && this.status !== "paused") {
        return { success: false, error: "No active run to stop." };
      }
      this.stopRequested = true;
      this.pauseRequested = false;
      this.status = "stopped";
      await this.save();
      return { success: true, status: this.status };
    }
  }

  api.runner = new Runner();
})();

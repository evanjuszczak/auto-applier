(function () {
  const api = window.HSQuickApply;

  function selectorIsConfigured(selector) {
    return typeof selector === "string" && selector.trim() && !selector.includes("{{");
  }

  function query(selector, root = document) {
    if (!selectorIsConfigured(selector) || typeof root?.querySelector !== "function") return null;
    try {
      return root.querySelector(selector);
    } catch (error) {
      console.error("[HS-QuickApply] Invalid selector:", selector, error);
      return null;
    }
  }

  function queryAll(selector, root = document) {
    if (!selectorIsConfigured(selector) || typeof root?.querySelectorAll !== "function") return [];
    try {
      return Array.from(root.querySelectorAll(selector));
    } catch (error) {
      console.error("[HS-QuickApply] Invalid selector:", selector, error);
      return [];
    }
  }

  function isVisible(element) {
    if (!(element instanceof Element)) return false;
    const style = getComputedStyle(element);
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      element.getClientRects().length > 0;
  }

  function waitForElement(selector, { timeout = 5000, root = document, visible = true } = {}) {
    return new Promise((resolve, reject) => {
      const find = () => {
        const element = query(selector, root);
        return element && (!visible || isVisible(element)) ? element : null;
      };

      const existing = find();
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = find();
        if (element) finish(resolve, element);
      });
      const timer = setTimeout(() => finish(reject, new Error(`Timed out waiting for selector: ${selector}`)), timeout);

      function finish(callback, value) {
        observer.disconnect();
        clearTimeout(timer);
        callback(value);
      }

      observer.observe(root === document ? document.documentElement : root, {
        childList: true,
        subtree: true,
        attributes: true
      });
    });
  }

  function text(element) {
    return (element?.innerText || element?.textContent || "").trim();
  }

  function findByText(selector, expected, root = document) {
    const normalized = (expected || "").trim().toLocaleLowerCase();
    if (!normalized) return null;
    return queryAll(selector, root).find((element) =>
      isVisible(element) && text(element).toLocaleLowerCase() === normalized
    ) || null;
  }

  function safeClick(element) {
    if (!isVisible(element) || element.matches(":disabled,[aria-disabled='true']")) {
      throw new Error("Refused to click a hidden or disabled element.");
    }
    element.scrollIntoView({ block: "center", inline: "nearest" });
    element.click();
  }

  function pressEscape(target = document.activeElement || document.body) {
    for (const type of ["keydown", "keyup"]) {
      target.dispatchEvent(new KeyboardEvent(type, {
        key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true
      }));
    }
  }

  function sleep(milliseconds) {
    return new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  function randomDelay(min, max) {
    const lower = Math.max(0, Number(min) || 0);
    const upper = Math.max(lower, Number(max) || lower);
    return sleep(lower + Math.random() * (upper - lower));
  }

  function scrollToBottom(container) {
    if (container && container !== document.body && container !== document.documentElement) {
      container.scrollTop = container.scrollHeight;
    } else {
      window.scrollTo(0, document.documentElement.scrollHeight);
    }
  }

  Object.assign(api, {
    query,
    queryAll,
    isVisible,
    waitForElement,
    text,
    findByText,
    safeClick,
    pressEscape,
    sleep,
    randomDelay,
    scrollToBottom
  });
})();

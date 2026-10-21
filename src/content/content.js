(function () {
  const api = window.HSQuickApply;

  if (!api.messageListener) {
    api.messageListener = (message, sender, sendResponse) => {
      const runner = window.HSQuickApply?.runner;
      if (message.action === "ping") {
        sendResponse({ success: true, ready: !!runner });
        return false;
      }
      if (!runner) {
        sendResponse({ success: false, error: "The page runner is not initialized." });
        return false;
      }

      const actions = {
        start: () => runner.start(message.settings),
        pause: () => runner.pause(),
        resume: () => runner.resume(),
        stop: () => runner.stop(),
        getState: () => runner.load().then((state) => ({ success: true, state }))
      };
      const action = actions[message.action];
      if (!action) return false;
      action().then(sendResponse).catch((error) => {
        console.error("[HS-QuickApply] Command failed:", error);
        sendResponse({ success: false, error: error.message || "Command failed." });
      });
      return true;
    };
  }

  if (!chrome.runtime.onMessage.hasListener(api.messageListener)) {
    chrome.runtime.onMessage.addListener(api.messageListener);
  }
})();

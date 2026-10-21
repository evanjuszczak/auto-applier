chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "hs-status" && message.state?.status === "halted") {
    chrome.notifications.create({
      type: "basic",
      iconUrl: chrome.runtime.getURL("icon.png"),
      title: "Handshake Quick Apply paused",
      message: message.state.haltReason || "The run needs your attention."
    });
  }
});

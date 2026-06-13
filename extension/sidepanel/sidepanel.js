function sendToBackground(action, payload = {}, tabId) {
  return new Promise((resolve, reject) => {
    const message = { _target: "background", action, payload };

    if (tabId !== undefined) {
      message.tabId = tabId;
    }

    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[YT Deep-Dive] sendToBackground error:",
          chrome.runtime.lastError.message
        );
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

async function relayToActiveTab(relayPayload) {
  return sendToBackground("RELAY_TO_TAB", {
    tabId: null,
    payload: relayPayload,
  });
}

window.sendToBackground = sendToBackground;
window.relayToActiveTab = relayToActiveTab;

let transcriptLoadGeneration = 0;

function getTranscriptContainer() {
  return document.getElementById("transcript-container");
}

function getFooterMessageElement() {
  return document.getElementById("footer-message");
}

function clearContainer(container) {
  while (container.firstChild) {
    container.removeChild(container.firstChild);
  }
}

function createStatusMessage(text, isError = false) {
  const message = document.createElement("p");
  message.className = isError
    ? "transcript-status transcript-status--error"
    : "transcript-status";
  message.textContent = text;
  return message;
}

function showLoading(container) {
  clearContainer(container);
  container.appendChild(createStatusMessage("Loading transcript…"));
}

function showMessage(container, text, isError = false) {
  clearContainer(container);
  container.appendChild(createStatusMessage(text, isError));
}

function showRetry(container, message, retryCallback) {
  clearContainer(container);
  container.appendChild(createStatusMessage(message, true));

  const retryButton = document.createElement("button");
  retryButton.type = "button";
  retryButton.className = "transcript-retry";
  retryButton.textContent = "Try Again";
  retryButton.addEventListener("click", retryCallback);
  container.appendChild(retryButton);
}

function renderTranscript(container, transcript) {
  clearContainer(container);

  for (const segment of transcript) {
    const line = document.createElement("div");
    line.className = "transcript-line";

    const timestamp = document.createElement("span");
    timestamp.className = "transcript-line__timestamp";
    timestamp.textContent = segment.timestamp || "00:00";

    const text = document.createElement("span");
    text.className = "transcript-line__text";
    text.textContent = segment.text || "";

    line.appendChild(timestamp);
    line.appendChild(text);
    container.appendChild(line);
  }
}

function updateFooterMessage(response) {
  const footerMessage = getFooterMessageElement();
  if (!footerMessage) {
    return;
  }

  if (response?.success) {
    footerMessage.textContent = "Showing raw transcript for the active video.";
    return;
  }

  if (response?.error === "Navigate to a YouTube video to get started.") {
    footerMessage.textContent =
      "Open a YouTube watch page in this browser window.";
    return;
  }

  footerMessage.textContent =
    "Transcript could not be loaded for this video.";
}

function getDisplayErrorMessage(response) {
  if (response?.error === "Navigate to a YouTube video to get started.") {
    return response.error;
  }

  return "Transcript unavailable";
}

async function resolveYouTubeTabId() {
  const focusedWindow = await chrome.windows.getLastFocused({
    windowTypes: ["normal"],
  });

  if (focusedWindow?.id) {
    const windowTabs = await chrome.tabs.query({
      windowId: focusedWindow.id,
      url: ["*://www.youtube.com/watch*", "*://youtube.com/watch*"],
    });

    const activeTab = windowTabs.find((tab) => tab.active);
    if (activeTab?.id) {
      return activeTab.id;
    }

    if (windowTabs[0]?.id) {
      return windowTabs[0].id;
    }
  }

  const youtubeTabs = await chrome.tabs.query({
    url: ["*://www.youtube.com/watch*", "*://youtube.com/watch*"],
  });

  return youtubeTabs.find((tab) => tab.active)?.id ?? youtubeTabs[0]?.id ?? null;
}

async function loadTranscript() {
  const container = getTranscriptContainer();
  if (!container) {
    return;
  }

  const loadGeneration = ++transcriptLoadGeneration;
  showLoading(container);

  try {
    const tabId = await resolveYouTubeTabId();

    if (!tabId) {
      updateFooterMessage({
        success: false,
        error: "Navigate to a YouTube video to get started.",
      });
      showMessage(
        container,
        "Navigate to a YouTube video to get started.",
        true
      );
      return;
    }

    const response = await sendToBackground("GET_TRANSCRIPT", { tabId });

    if (loadGeneration !== transcriptLoadGeneration) {
      return;
    }

    if (response?.debug) {
      console.log("[YT Deep-Dive] Transcript debug:", response.debug);
    }

    updateFooterMessage(response);

    if (response?.success && Array.isArray(response.data?.transcript)) {
      renderTranscript(container, response.data.transcript);
      return;
    }

    showRetry(container, getDisplayErrorMessage(response), () => {
      loadTranscript();
    });
  } catch (error) {
    if (loadGeneration !== transcriptLoadGeneration) {
      return;
    }

    updateFooterMessage({ success: false });
    showRetry(container, "Transcript unavailable", () => {
      loadTranscript();
    });
    console.error("[YT Deep-Dive] loadTranscript error:", error.message);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?._target !== "sidepanel") {
    return false;
  }

  console.log(
    "[YT Deep-Dive] Sidepanel received message:",
    message.payload ?? message
  );
  sendResponse({ success: true });
  return true;
});

document.addEventListener("DOMContentLoaded", () => {
  console.log("[YT Deep-Dive] Sidepanel ready");
  loadTranscript();
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    loadTranscript();
  }
});

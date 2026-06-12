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
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!tab?.id) {
    throw new Error("No active tab found");
  }

  return sendToBackground("RELAY_TO_TAB", {
    tabId: tab.id,
    payload: relayPayload,
  });
}

window.sendToBackground = sendToBackground;
window.relayToActiveTab = relayToActiveTab;

let transcriptLoadGeneration = 0;

function getTranscriptContainer() {
  return document.getElementById("transcript-container");
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

function isYouTubeWatchUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return (
      parsedUrl.hostname.includes("youtube.com") &&
      parsedUrl.pathname === "/watch"
    );
  } catch {
    return false;
  }
}

async function loadTranscript() {
  const container = getTranscriptContainer();
  if (!container) {
    return;
  }

  const loadGeneration = ++transcriptLoadGeneration;
  showLoading(container);

  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (loadGeneration !== transcriptLoadGeneration) {
      return;
    }

    if (!tab?.url || !isYouTubeWatchUrl(tab.url)) {
      showMessage(container, "Navigate to a YouTube video to get started.");
      return;
    }

    const response = await sendToBackground("GET_TRANSCRIPT", { tabId: tab.id });

    if (loadGeneration !== transcriptLoadGeneration) {
      return;
    }

    if (response?.success && Array.isArray(response.data?.transcript)) {
      renderTranscript(container, response.data.transcript);
      return;
    }

    showRetry(container, "Transcript unavailable", () => {
      loadTranscript();
    });
  } catch (error) {
    if (loadGeneration !== transcriptLoadGeneration) {
      return;
    }

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

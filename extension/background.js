/**
 * Message Protocol
 *
 * Router-bound message shape:
 *   { _target: "background", action: string, payload: object, tabId?: number }
 *
 * Sidepanel delivery shape:
 *   { _target: "sidepanel", payload: object }
 *
 * Standard response shape:
 *   { success: boolean, data?: object, error?: string }
 *
 * PING exception response:
 *   { status: "PONG" }
 */

chrome.runtime.onInstalled.addListener(() => {
  console.log("[YT Deep-Dive] Service worker registered");
  configureSidePanel();
});

function configureSidePanel() {
  chrome.sidePanel
    .setPanelBehavior({ openPanelOnActionClick: true })
    .catch((error) => {
      console.error(
        "[YT Deep-Dive] Failed to configure side panel:",
        error.message
      );
    });
}

configureSidePanel();

function sendMessageToTab(tabId, payload) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, payload, (response) => {
      if (chrome.runtime.lastError) {
        console.error(
          "[YT Deep-Dive] sendMessageToTab error:",
          chrome.runtime.lastError.message
        );
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      resolve(response);
    });
  });
}

function sendMessageToSidepanel(payload) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { _target: "sidepanel", payload },
      (response) => {
        if (chrome.runtime.lastError) {
          console.error(
            "[YT Deep-Dive] sendMessageToSidepanel error:",
            chrome.runtime.lastError.message
          );
          reject(new Error(chrome.runtime.lastError.message));
          return;
        }
        resolve(response);
      }
    );
  });
}

function isRouterMessage(message) {
  return Boolean(message && typeof message.action === "string");
}

async function routeMessage(message, sendResponse) {
  try {
    switch (message.action) {
      case "PING":
        sendResponse({ status: "PONG" });
        break;

      case "RELAY_TO_TAB": {
        const { tabId, payload: relayPayload } = message.payload || {};

        if (!tabId || !relayPayload) {
          sendResponse({
            success: false,
            error: "RELAY_TO_TAB requires tabId and payload",
          });
          return;
        }

        const tabResponse = await sendMessageToTab(tabId, relayPayload);
        sendResponse({ success: true, data: tabResponse });
        break;
      }

      case "RELAY_TO_SIDEPANEL": {
        const sidepanelPayload = message.payload ?? {};
        const sidepanelResponse = await sendMessageToSidepanel(sidepanelPayload);
        sendResponse({ success: true, data: sidepanelResponse });
        break;
      }

      case "GET_TRANSCRIPT": {
        let targetTabId = message.payload?.tabId ?? message.tabId;

        if (!targetTabId) {
          const [activeTab] = await chrome.tabs.query({
            active: true,
            currentWindow: true,
          });
          targetTabId = activeTab?.id;
        }

        if (!targetTabId) {
          sendResponse({ success: false, error: "No active tab found" });
          return;
        }

        const tabResponse = await sendMessageToTab(targetTabId, {
          action: "GET_TRANSCRIPT",
        });

        if (!tabResponse?.success) {
          sendResponse({
            success: false,
            error: tabResponse?.error || "TRANSCRIPT_UNAVAILABLE",
          });
          return;
        }

        sendResponse({ success: true, data: tabResponse.data });
        break;
      }

      default:
        console.error("[YT Deep-Dive] Unknown action:", message.action);
        sendResponse({
          success: false,
          error: `Unknown action: ${message.action}`,
        });
    }
  } catch (error) {
    console.error("[YT Deep-Dive] routeMessage error:", error.message);
    sendResponse({ success: false, error: error.message });
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?._target === "sidepanel") {
    return false;
  }

  if (!isRouterMessage(message)) {
    return false;
  }

  if (message._target && message._target !== "background") {
    return false;
  }

  routeMessage(message, sendResponse);
  return true;
});

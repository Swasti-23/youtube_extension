console.log("[YT Deep-Dive] Content script injected");

let extractionGeneration = 0;

document.addEventListener("yt-navigate-finish", () => {
  extractionGeneration += 1;
});

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

window.sendToBackground = sendToBackground;

function getPlayerResponse() {
  if (window.ytInitialPlayerResponse) {
    return window.ytInitialPlayerResponse;
  }

  const player = document.querySelector("#movie_player");
  if (player?.getVideoData) {
    try {
      const data = player.getVideoData();
      if (data?.player_response) {
        return data.player_response;
      }
    } catch {
      // Fall through to script parsing.
    }
  }

  for (const script of document.scripts) {
    const text = script.textContent;
    if (!text || !text.includes("ytInitialPlayerResponse")) {
      continue;
    }

    const match = text.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\});/s);
    if (!match) {
      continue;
    }

    try {
      return JSON.parse(match[1]);
    } catch {
      // Try next script tag.
    }
  }

  return null;
}

function getCaptionTracks(playerResponse) {
  return (
    playerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks ??
    null
  );
}

function formatTimestamp(totalMs) {
  const totalSeconds = Math.floor(totalMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const paddedMinutes = String(minutes).padStart(2, "0");
  const paddedSeconds = String(seconds).padStart(2, "0");

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${paddedMinutes}:${paddedSeconds}`;
  }

  return `${paddedMinutes}:${paddedSeconds}`;
}

function parseJson3Captions(captionJson) {
  const segments = [];

  for (const event of captionJson.events || []) {
    if (!event.segs) {
      continue;
    }

    const text = event.segs
      .map((segment) => segment.utf8 || "")
      .join("")
      .replace(/\n/g, " ")
      .trim();

    if (!text) {
      continue;
    }

    segments.push({
      timestamp: formatTimestamp(event.tStartMs || 0),
      text,
    });
  }

  return segments;
}

async function fetchTranscriptFromCaptions(captionTrack, isAborted) {
  const url = new URL(captionTrack.baseUrl);
  url.searchParams.set("fmt", "json3");

  const response = await fetch(url.toString());

  if (isAborted()) {
    return { aborted: true };
  }

  if (!response.ok) {
    return { error: "TRANSCRIPT_UNAVAILABLE" };
  }

  const captionJson = await response.json();

  if (isAborted()) {
    return { aborted: true };
  }

  const segments = parseJson3Captions(captionJson);
  return segments.length > 0 ? { segments } : { error: "TRANSCRIPT_UNAVAILABLE" };
}

async function extractTranscriptFromPlayerResponse(isAborted) {
  const playerResponse = getPlayerResponse();
  const captionTracks = getCaptionTracks(playerResponse);

  if (!captionTracks || captionTracks.length === 0) {
    return { error: "TRANSCRIPT_UNAVAILABLE" };
  }

  const firstTrack = captionTracks[0];
  return fetchTranscriptFromCaptions(firstTrack, isAborted);
}

function findShowTranscriptButton() {
  const selectors = [
    'button[aria-label="Show transcript"]',
    'button[aria-label="Open transcript"]',
    'ytd-video-description-transcript-section-renderer button',
  ];

  for (const selector of selectors) {
    const button = document.querySelector(selector);
    if (button) {
      return button;
    }
  }

  for (const button of document.querySelectorAll("button")) {
    const label = (
      button.getAttribute("aria-label") ||
      button.textContent ||
      ""
    ).trim();

    if (/show transcript|open transcript/i.test(label)) {
      return button;
    }
  }

  return null;
}

function expandVideoDescription() {
  const expandSelectors = [
    "#expand",
    'tp-yt-paper-button#expand',
    'ytd-text-inline-expander #expand',
    'button[aria-label="Show more"]',
  ];

  for (const selector of expandSelectors) {
    const button = document.querySelector(selector);
    if (button) {
      button.click();
      return;
    }
  }
}

function openTranscriptPanel() {
  const transcriptTab = document.querySelector(
    'ytd-engagement-panel-tab-header-renderer[target-id="engagement-panel-transcript"]'
  );

  if (transcriptTab) {
    transcriptTab.click();
    return true;
  }

  expandVideoDescription();

  const showTranscriptButton = findShowTranscriptButton();
  if (!showTranscriptButton) {
    return false;
  }

  showTranscriptButton.click();
  return true;
}

function parseDomTranscript() {
  const segmentElements = document.querySelectorAll(
    "ytd-transcript-segment-renderer, ytd-transcript-segment-list-renderer ytd-transcript-segment-renderer"
  );
  const segments = [];

  segmentElements.forEach((segmentElement) => {
    const timestampElement =
      segmentElement.querySelector(".segment-timestamp") ||
      segmentElement.querySelector('[class*="timestamp"]');
    const textElement =
      segmentElement.querySelector(".segment-text yt-formatted-string") ||
      segmentElement.querySelector(".segment-text") ||
      segmentElement.querySelector("yt-formatted-string");

    const timestamp = timestampElement?.textContent?.trim() || "00:00";
    const text = textElement?.textContent?.trim() || "";

    if (text) {
      segments.push({ timestamp, text });
    }
  });

  return segments;
}

function waitForTranscriptDom(isAborted, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const existingSegments = parseDomTranscript();
    if (existingSegments.length > 0) {
      resolve(existingSegments);
      return;
    }

    let settled = false;

    const finish = (segments) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeoutId);
      observer.disconnect();
      resolve(segments);
    };

    const timeoutId = setTimeout(() => {
      finish([]);
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      if (isAborted()) {
        finish([]);
        return;
      }

      const segments = parseDomTranscript();
      if (segments.length > 0) {
        finish(segments);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });
  });
}

async function extractTranscriptFromDom(isAborted) {
  const opened = openTranscriptPanel();

  if (!opened) {
    return { error: "TRANSCRIPT_UNAVAILABLE" };
  }

  await new Promise((resolve) => setTimeout(resolve, 150));

  if (isAborted()) {
    return { aborted: true };
  }

  const segments = await waitForTranscriptDom(isAborted);

  if (isAborted()) {
    return { aborted: true };
  }

  return segments.length > 0
    ? { segments }
    : { error: "TRANSCRIPT_UNAVAILABLE" };
}

async function extractTranscript() {
  const generation = extractionGeneration;
  const isAborted = () => generation !== extractionGeneration;

  if (!window.location.pathname.includes("/watch")) {
    return { error: "TRANSCRIPT_UNAVAILABLE" };
  }

  try {
    const playerResult = await extractTranscriptFromPlayerResponse(isAborted);

    if (playerResult.aborted) {
      return { error: "TRANSCRIPT_UNAVAILABLE" };
    }

    if (playerResult.segments?.length > 0) {
      return playerResult.segments;
    }

    if (isAborted()) {
      return { error: "TRANSCRIPT_UNAVAILABLE" };
    }

    const domResult = await extractTranscriptFromDom(isAborted);

    if (domResult.aborted) {
      return { error: "TRANSCRIPT_UNAVAILABLE" };
    }

    if (domResult.segments?.length > 0) {
      return domResult.segments;
    }

    return { error: "TRANSCRIPT_UNAVAILABLE" };
  } catch (error) {
    console.error("[YT Deep-Dive] extractTranscript error:", error.message);
    return { error: "TRANSCRIPT_UNAVAILABLE" };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?._target === "sidepanel" || message?._target === "background") {
    return false;
  }

  if (!sender.tab) {
    return false;
  }

  console.log("[YT Deep-Dive] Content script received message:", message);

  if (!message || typeof message.action !== "string") {
    sendResponse({ success: false, error: "Unrecognized message" });
    return true;
  }

  if (message.action === "GET_TRANSCRIPT") {
    extractTranscript()
      .then((result) => {
        if (result?.error) {
          sendResponse({ success: false, error: result.error });
          return;
        }

        sendResponse({ success: true, data: { transcript: result } });
      })
      .catch((error) => {
        sendResponse({ success: false, error: error.message });
      });
    return true;
  }

  if (message.action === "TRIGGER_SIDEPANEL_RELAY") {
    sendToBackground(
      "RELAY_TO_SIDEPANEL",
      message.payload ?? {
        action: "TEST",
        payload: { from: "content" },
      }
    )
      .then((response) => sendResponse({ success: true, data: response }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  sendResponse({ success: true });
  return true;
});

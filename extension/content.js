(() => {
  if (globalThis.__ytDeepDiveContentScriptLoaded) {
    return;
  }

  globalThis.__ytDeepDiveContentScriptLoaded = true;

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

function extractJsonObjectAfter(text, marker) {
  const markerIndex = text.indexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const start = text.indexOf("{", markerIndex);
  if (start === -1) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (character === "\\") {
        isEscaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
      continue;
    }

    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, index + 1));
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

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

    const playerResponse = extractJsonObjectAfter(
      text,
      "ytInitialPlayerResponse"
    );
    if (playerResponse) {
      return playerResponse;
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

function parseXmlCaptions(xmlText) {
  const segments = [];
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const textNodes = doc.querySelectorAll("text");

  textNodes.forEach((node) => {
    const startMs = Number(node.getAttribute("start") || 0) * 1000;
    const text = (node.textContent || "").replace(/\n/g, " ").trim();

    if (!text) {
      return;
    }

    segments.push({
      timestamp: formatTimestamp(startMs),
      text,
    });
  });

  return segments;
}

async function fetchTranscriptFromCaptions(captionTrack, isAborted) {
  const baseUrl = new URL(captionTrack.baseUrl);

  try {
    const jsonUrl = new URL(baseUrl.toString());
    jsonUrl.searchParams.set("fmt", "json3");

    const jsonResponse = await fetch(jsonUrl.toString(), {
      credentials: "include",
    });

    if (isAborted()) {
      return { aborted: true };
    }

    if (jsonResponse.ok) {
      const responseText = await jsonResponse.text();

      if (responseText.trim()) {
        try {
          const captionJson = JSON.parse(responseText);
          const jsonSegments = parseJson3Captions(captionJson);

          if (jsonSegments.length > 0) {
            return { segments: jsonSegments };
          }
        } catch {
          // Fall through to XML parsing.
        }
      }
    }
  } catch {
    // Fall through to XML parsing.
  }

  try {
    const xmlResponse = await fetch(baseUrl.toString(), {
      credentials: "include",
    });

    if (isAborted()) {
      return { aborted: true };
    }

    if (!xmlResponse.ok) {
      return { error: "TRANSCRIPT_UNAVAILABLE" };
    }

    const xmlText = await xmlResponse.text();
    const xmlSegments = parseXmlCaptions(xmlText);

    return xmlSegments.length > 0
      ? { segments: xmlSegments }
      : { error: "TRANSCRIPT_UNAVAILABLE" };
  } catch {
    return { error: "TRANSCRIPT_UNAVAILABLE" };
  }
}

async function extractTranscriptFromPlayerResponse(isAborted) {
  const playerResponse = getPlayerResponse();
  const captionTracks = getCaptionTracks(playerResponse);

  if (!captionTracks || captionTracks.length === 0) {
    return { error: "TRANSCRIPT_UNAVAILABLE" };
  }

  for (const captionTrack of captionTracks) {
    const result = await fetchTranscriptFromCaptions(captionTrack, isAborted);

    if (result.aborted) {
      return { aborted: true };
    }

    if (result.segments?.length > 0) {
      return result;
    }
  }

  return { error: "TRANSCRIPT_UNAVAILABLE" };
}

function getTranscriptPanelElement() {
  const selectors = [
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]',
    'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-transcript"]',
    "ytd-transcript-renderer",
    "ytd-video-description-transcript-section-renderer",
    "#panels ytd-engagement-panel-section-list-renderer",
  ];

  for (const selector of selectors) {
    const element = document.querySelector(selector);
    if (element) {
      return element;
    }
  }

  return null;
}

function isTranscriptPanelVisible() {
  const panel = getTranscriptPanelElement();
  if (!panel) {
    return false;
  }

  const visibility = panel.getAttribute("visibility") || "";
  if (visibility.includes("HIDDEN")) {
    return false;
  }

  if (visibility.includes("EXPANDED")) {
    return true;
  }

  return Boolean(parseTranscriptFromInnerText().length);
}

function parseTranscriptFromInnerText() {
  const panel = getTranscriptPanelElement();
  if (!panel) {
    return [];
  }

  const lines = (panel.innerText || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const segments = [];
  const timestampRegex = /^(\d{1,2}:\d{2}(?::\d{2})?)$/;

  for (let index = 0; index < lines.length; index += 1) {
    const timestampMatch = lines[index].match(timestampRegex);
    if (!timestampMatch) {
      continue;
    }

    const timestamp = timestampMatch[1];
    const textLines = [];

    for (let textIndex = index + 1; textIndex < lines.length; textIndex += 1) {
      if (timestampRegex.test(lines[textIndex])) {
        break;
      }

      if (/^(transcript|search|scroll for details)$/i.test(lines[textIndex])) {
        continue;
      }

      textLines.push(lines[textIndex]);
    }

    const text = textLines.join(" ").trim();
    if (text) {
      segments.push({ timestamp, text });
    }
  }

  return segments;
}

function parseSegmentElement(segmentElement) {
  const timestampElement =
    segmentElement.querySelector(".segment-timestamp") ||
    segmentElement.querySelector('[class*="timestamp"]');
  const textElement =
    segmentElement.querySelector(".segment-text yt-formatted-string") ||
    segmentElement.querySelector(".segment-text .yt-core-attributed-string") ||
    segmentElement.querySelector(".segment-text") ||
    segmentElement.querySelector(".yt-core-attributed-string") ||
    segmentElement.querySelector("yt-formatted-string");

  const timestamp = timestampElement?.textContent?.trim() || "";
  const text = textElement?.textContent?.trim() || "";

  if (!timestamp || !text) {
    return null;
  }

  return { timestamp, text };
}

function readTranscriptSegments() {
  const innerTextSegments = parseTranscriptFromInnerText();
  if (innerTextSegments.length > 0) {
    return innerTextSegments;
  }

  return parseDomTranscript();
}

async function readTranscriptFromHiddenPanel() {
  const panel = getTranscriptPanelElement();
  if (!panel) {
    return [];
  }

  const previousVisibility = panel.getAttribute("visibility") || "";
  const wasHidden = previousVisibility.includes("HIDDEN");

  if (wasHidden) {
    panel.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED");
  }

  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const segments = readTranscriptSegments();
      if (segments.length > 0) {
        return segments;
      }

      if (!wasHidden) {
        break;
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  } finally {
    if (wasHidden) {
      panel.setAttribute(
        "visibility",
        previousVisibility || "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN"
      );
    }
  }

  return [];
}

function collectTranscriptSegments() {
  if (!isTranscriptPanelVisible()) {
    return [];
  }

  return readTranscriptSegments();
}

function parseDomTranscript() {
  const panel = getTranscriptPanelElement();
  const segmentSelectors = [
    "ytd-transcript-segment-renderer",
    "transcript-segment-view-model",
  ];
  const segments = [];
  const seen = new Set();
  let segmentElements = [];

  for (const selector of segmentSelectors) {
    segmentElements = panel
      ? panel.querySelectorAll(selector)
      : document.querySelectorAll(selector);

    if (segmentElements.length > 0) {
      break;
    }
  }

  segmentElements.forEach((segmentElement) => {
    const segment = parseSegmentElement(segmentElement);
    if (!segment) {
      return;
    }

    const key = `${segment.timestamp}:${segment.text}`;
    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    segments.push(segment);
  });

  return segments;
}

async function extractTranscriptFromDom(isAborted) {
  let segments = collectTranscriptSegments();
  if (segments.length > 0) {
    return { segments };
  }

  if (isAborted()) {
    return { aborted: true };
  }

  segments = await readTranscriptFromHiddenPanel();
  if (segments.length > 0) {
    return { segments };
  }

  return { error: "TRANSCRIPT_UNAVAILABLE" };
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

    let segments = collectTranscriptSegments();
    if (segments.length > 0) {
      return segments;
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

  console.log("[YT Deep-Dive] Content script received message:", message);

  if (!message || typeof message.action !== "string") {
    sendResponse({ success: false, error: "Unrecognized message" });
    return true;
  }

  if (message.action === "PING") {
    sendResponse({ success: true, data: { status: "PONG" } });
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
})();

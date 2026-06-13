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
        const errorMessage = chrome.runtime.lastError.message;

        if (
          errorMessage.includes("Receiving end does not exist") ||
          errorMessage.includes("Could not establish connection")
        ) {
          reject(new Error("CONTENT_SCRIPT_UNAVAILABLE"));
          return;
        }

        console.error(
          "[YT Deep-Dive] sendMessageToTab error:",
          errorMessage
        );
        reject(new Error(errorMessage));
        return;
      }
      resolve(response);
    });
  });
}

function isYouTubeWatchUrl(url) {
  if (!url) {
    return false;
  }

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

async function getTargetYouTubeTab(requestedTabId) {
  if (requestedTabId) {
    const requestedTab = await chrome.tabs.get(requestedTabId).catch(() => null);
    if (isYouTubeWatchUrl(requestedTab?.url)) {
      return requestedTab;
    }
  }

  const [activeTab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
    windowType: "normal",
  });

  if (isYouTubeWatchUrl(activeTab?.url)) {
    return activeTab;
  }

  const focusedWindow = await chrome.windows
    .getLastFocused({ windowTypes: ["normal"] })
    .catch(() => null);

  if (focusedWindow?.id) {
    const windowTabs = await chrome.tabs.query({
      active: true,
      windowId: focusedWindow.id,
    });
    const youtubeTab = windowTabs.find((tab) => isYouTubeWatchUrl(tab.url));
    if (youtubeTab) {
      return youtubeTab;
    }
  }

  const youtubeTabs = await chrome.tabs.query({
    url: ["*://www.youtube.com/watch*", "*://youtube.com/watch*"],
  });

  return (
    youtubeTabs.find((tab) => tab.active) ||
    youtubeTabs.sort(
      (left, right) => (right.lastAccessed || 0) - (left.lastAccessed || 0)
    )[0] ||
    null
  );
}

async function injectContentScript(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"],
    });
  } catch (error) {
    console.warn(
      "[YT Deep-Dive] injectContentScript:",
      error.message
    );
  }
}

async function ensureContentScript(tabId) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await sendMessageToTab(tabId, { action: "PING" });
      return true;
    } catch (error) {
      if (error.message !== "CONTENT_SCRIPT_UNAVAILABLE") {
        throw error;
      }

      if (attempt === 0) {
        await injectContentScript(tabId);
      }

      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  return false;
}

async function extractTranscriptInMainWorld(tabId) {
  try {
    const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    world: "MAIN",
    func: async () => {
      function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      function getVideoId() {
        return new URLSearchParams(window.location.search).get("v");
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

      function queryAllDeep(root, selector) {
        const results = [];

        function walk(node) {
          if (!node) {
            return;
          }

          if (node.querySelectorAll) {
            node.querySelectorAll(selector).forEach((element) => {
              results.push(element);
            });

            node.querySelectorAll("*").forEach((element) => {
              if (element.shadowRoot) {
                walk(element.shadowRoot);
              }
            });
          }
        }

        walk(root);
        return results;
      }

      function parseDomTranscript() {
        const segments = [];
        const seen = new Set();
        const segmentSelectors = [
          "ytd-transcript-segment-renderer",
          "transcript-segment-view-model",
        ];

        let segmentElements = [];
        const panel = getTranscriptPanelElement();

        for (const selector of segmentSelectors) {
          if (panel) {
            segmentElements = panel.querySelectorAll(selector);
          } else {
            segmentElements = document.querySelectorAll(selector);
          }

          if (segmentElements.length > 0) {
            break;
          }
        }

        if (segmentElements.length === 0) {
          segmentElements = queryAllDeep(document, "ytd-transcript-segment-renderer");
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

      function getCaptionTracks() {
        const sources = [
          window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer
            ?.captionTracks,
          window.ytplayer?.config?.args?.raw_player_response?.captions
            ?.playerCaptionsTracklistRenderer?.captionTracks,
          document.getElementById("movie_player")?.getPlayerResponse?.()?.captions
            ?.playerCaptionsTracklistRenderer?.captionTracks,
        ];

        for (const tracks of sources) {
          if (Array.isArray(tracks) && tracks.length > 0) {
            return tracks;
          }
        }

        return null;
      }

      function sortCaptionTracks(tracks) {
        return [...tracks].sort((left, right) => {
          if (left.kind === "asr" && right.kind !== "asr") {
            return 1;
          }

          if (left.kind !== "asr" && right.kind === "asr") {
            return -1;
          }

          return 0;
        });
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

      async function fetchTrackSegments(track) {
        const referer = getVideoId()
          ? `https://www.youtube.com/watch?v=${getVideoId()}`
          : window.location.href;
        const requestInit = {
          credentials: "include",
          headers: {
            Referer: referer,
          },
        };

        try {
          const jsonUrl = new URL(track.baseUrl);
          jsonUrl.searchParams.set("fmt", "json3");
          const jsonResponse = await fetch(jsonUrl.toString(), requestInit);

          if (jsonResponse.ok) {
            const responseText = await jsonResponse.text();
            if (responseText.trim()) {
              const captionJson = JSON.parse(responseText);
              const jsonSegments = parseJson3Captions(captionJson);
              if (jsonSegments.length > 0) {
                return jsonSegments;
              }
            }
          }
        } catch {
          // Fall through to XML.
        }

        try {
          const xmlResponse = await fetch(track.baseUrl, requestInit);

          if (xmlResponse.ok) {
            const xmlSegments = parseXmlCaptions(await xmlResponse.text());
            if (xmlSegments.length > 0) {
              return xmlSegments;
            }
          }
        } catch {
          // No segments from this track.
        }

        return [];
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

        const deepMatches = queryAllDeep(
          document,
          'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"], ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-transcript"]'
        );

        return deepMatches[0] || null;
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

      function findDeepGetTranscriptParams(value, seen = new Set()) {
        if (!value || typeof value !== "object") {
          return null;
        }

        if (seen.has(value)) {
          return null;
        }

        seen.add(value);

        if (typeof value.getTranscriptEndpoint?.params === "string") {
          return value.getTranscriptEndpoint.params;
        }

        if (Array.isArray(value)) {
          for (const item of value) {
            const found = findDeepGetTranscriptParams(item, seen);
            if (found) {
              return found;
            }
          }

          return null;
        }

        for (const item of Object.values(value)) {
          const found = findDeepGetTranscriptParams(item, seen);
          if (found) {
            return found;
          }
        }

        return null;
      }

      function getInnertubeTranscriptParamsFromScripts() {
        const patterns = [
          /getTranscriptEndpoint"\s*:\s*\{\s*"params"\s*:\s*"([^"\\]+(?:\\.[^"\\]*)*)"/,
          /"getTranscriptEndpoint":\{"params":"([^"]+)"/,
        ];

        for (const script of document.scripts) {
          const text = script.textContent;
          if (!text || !text.includes("getTranscript")) {
            continue;
          }

          for (const pattern of patterns) {
            const match = text.match(pattern);
            if (match?.[1]) {
              return match[1]
                .replace(/\\u0026/g, "&")
                .replace(/\\"/g, '"')
                .replace(/\\\\/g, "\\");
            }
          }
        }

        return null;
      }

      function getInnertubeTranscriptParams() {
        const panelGroups = [
          window.ytInitialData?.engagementPanels?.engagementPanelSectionListRenderer
            ?.content?.engagementPanelSectionListRenderer?.contents,
          window.ytInitialPlayerResponse?.engagementPanels,
        ];

        for (const panels of panelGroups) {
          if (!Array.isArray(panels)) {
            continue;
          }

          for (const panel of panels) {
            const renderer = panel?.engagementPanelSectionListRenderer;
            if (
              renderer?.targetId !== "engagement-panel-transcript" &&
              renderer?.targetId !== "engagement-panel-searchable-transcript"
            ) {
              continue;
            }

            const params =
              renderer?.content?.transcriptSearchPanelRenderer?.body
                ?.transcriptBodyRenderer?.content?.transcriptSegmentListRenderer
                ?.continuations?.[0]?.getTranscriptEndpoint?.params;

            if (params) {
              return params;
            }
          }
        }

        const deepSearchRoots = [
          window.ytInitialData,
          window.ytInitialPlayerResponse,
          window.ytplayer?.config?.args?.raw_player_response,
        ];

        for (const root of deepSearchRoots) {
          const params = findDeepGetTranscriptParams(root);
          if (params) {
            return params;
          }
        }

        return getInnertubeTranscriptParamsFromScripts();
      }

      function collectTranscriptSegmentRenderers(value, results = []) {
        if (!value || typeof value !== "object") {
          return results;
        }

        if (value.transcriptSegmentRenderer) {
          results.push(value.transcriptSegmentRenderer);
        }

        if (Array.isArray(value)) {
          value.forEach((item) => collectTranscriptSegmentRenderers(item, results));
          return results;
        }

        Object.values(value).forEach((item) =>
          collectTranscriptSegmentRenderers(item, results)
        );
        return results;
      }

      function collectTranscriptCues(value, results = []) {
        if (!value || typeof value !== "object") {
          return results;
        }

        if (value.transcriptCueRenderer) {
          results.push(value.transcriptCueRenderer);
        }

        if (Array.isArray(value)) {
          value.forEach((item) => collectTranscriptCues(item, results));
          return results;
        }

        Object.values(value).forEach((item) => collectTranscriptCues(item, results));
        return results;
      }

      function parseInnertubeTranscriptResponse(data) {
        const segments = [];
        const seen = new Set();

        const addSegment = (startMs, text) => {
          const normalizedText = (text || "").replace(/\n/g, " ").trim();
          if (!normalizedText) {
            return;
          }

          const timestamp = formatTimestamp(Number(startMs || 0));
          const key = `${timestamp}:${normalizedText}`;
          if (seen.has(key)) {
            return;
          }

          seen.add(key);
          segments.push({ timestamp, text: normalizedText });
        };

        for (const renderer of collectTranscriptSegmentRenderers(data)) {
          const startMs = Number(renderer.startMs || renderer.startTimeMs || 0);
          const text = (renderer.snippet?.runs || [])
            .map((run) => run.text || "")
            .join("");

          addSegment(startMs, text);
        }

        for (const cue of collectTranscriptCues(data)) {
          const startMs = Number(cue.startOffsetMs || cue.startMs || 0);
          const text =
            cue.cue?.simpleText ||
            (cue.snippet?.runs || []).map((run) => run.text || "").join("");

          addSegment(startMs, text);
        }

        segments.sort((left, right) => {
          return left.timestamp.localeCompare(right.timestamp);
        });

        return segments;
      }

      function getInnertubeClientContext() {
        const visitorData =
          window.ytcfg?.data_?.VISITOR_DATA ||
          window.ytcfg?.data_?.INNERTUBE_CONTEXT?.client?.visitorData;

        const client = {
          clientName:
            window.ytcfg?.data_?.INNERTUBE_CONTEXT_CLIENT_NAME ||
            window.ytcfg?.data_?.INNERTUBE_CLIENT_NAME ||
            "WEB",
          clientVersion:
            window.ytcfg?.data_?.INNERTUBE_CLIENT_VERSION ||
            "2.20240101.00.00",
          hl: window.ytcfg?.data_?.HL || "en",
          gl: window.ytcfg?.data_?.GL || "US",
        };

        if (visitorData) {
          client.visitorData = visitorData;
        }

        return { client };
      }

      async function fetchTranscriptViaInnertube() {
        const apiKey = window.ytcfg?.data_?.INNERTUBE_API_KEY;
        const params = getInnertubeTranscriptParams();

        if (!apiKey || !params) {
          return [];
        }

        try {
          const response = await fetch(
            `https://www.youtube.com/youtubei/v1/get_transcript?key=${encodeURIComponent(apiKey)}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "include",
              body: JSON.stringify({
                context: getInnertubeClientContext(),
                params,
              }),
            }
          );

          if (!response.ok) {
            return [];
          }

          return parseInnertubeTranscriptResponse(await response.json());
        } catch {
          return [];
        }
      }

      function readTranscriptSegments() {
        const strategies = [parseTranscriptFromInnerText, parseDomTranscript];

        for (const strategy of strategies) {
          const segments = strategy();
          if (segments.length > 0) {
            return segments;
          }
        }

        return [];
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
            let segments = readTranscriptSegments();
            if (segments.length > 0) {
              return segments;
            }

            if (wasHidden && attempt % 4 === 3) {
              segments = await fetchTranscriptViaInnertube();
              if (segments.length > 0) {
                return segments;
              }

              segments = await fetchTranscriptViaCaptions();
              if (segments.length > 0) {
                return segments;
              }
            }

            if (!wasHidden) {
              break;
            }

            await sleep(250);
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

      function collectSegments() {
        if (!isTranscriptPanelVisible()) {
          return [];
        }

        return readTranscriptSegments();
      }

      async function fetchTranscriptViaCaptions() {
        const captionTracks = getCaptionTracks();
        if (!captionTracks?.length) {
          return [];
        }

        for (const track of sortCaptionTracks(captionTracks)) {
          const segments = await fetchTrackSegments(track);
          if (segments.length > 0) {
            return segments;
          }
        }

        return [];
      }

      if (!window.location.pathname.includes("/watch")) {
        return { error: "TRANSCRIPT_UNAVAILABLE" };
      }

      let segments = await fetchTranscriptViaInnertube();
      if (segments.length > 0) {
        return { transcript: segments, source: "innertube" };
      }

      segments = await fetchTranscriptViaCaptions();
      if (segments.length > 0) {
        return { transcript: segments, source: "captions" };
      }

      segments = collectSegments();
      if (segments.length > 0) {
        return { transcript: segments, source: "dom" };
      }

      segments = await readTranscriptFromHiddenPanel();
      if (segments.length > 0) {
        return { transcript: segments, source: "dom-silent-expand" };
      }

      return {
        error: "TRANSCRIPT_UNAVAILABLE",
        debug: {
          href: window.location.href,
          directSegmentCount: document.querySelectorAll(
            "ytd-transcript-segment-renderer"
          ).length,
          innerTextSegmentCount: parseTranscriptFromInnerText().length,
          panelTextPreview: getTranscriptPanelElement()?.innerText?.slice(0, 120),
          captionTrackCount: getCaptionTracks()?.length ?? 0,
          hasInnertubeParams: Boolean(getInnertubeTranscriptParams()),
          panelVisible: isTranscriptPanelVisible(),
          hasTranscriptPanel: Boolean(getTranscriptPanelElement()),
        },
      };
    },
  });

    return injection?.result ?? { error: "TRANSCRIPT_UNAVAILABLE" };
  } catch (error) {
    console.error(
      "[YT Deep-Dive] extractTranscriptInMainWorld error:",
      error.message
    );
    return {
      error: "TRANSCRIPT_UNAVAILABLE",
      debug: { scriptError: error.message },
    };
  }
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
        const targetTab = await getTargetYouTubeTab(tabId);

        if (!targetTab?.id || !relayPayload) {
          sendResponse({
            success: false,
            error: "RELAY_TO_TAB requires tabId and payload",
          });
          return;
        }

        const tabResponse = await sendMessageToTab(targetTab.id, relayPayload);
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
        const targetTab = await getTargetYouTubeTab(
          message.payload?.tabId ?? message.tabId
        );

        if (!targetTab?.id) {
          sendResponse({
            success: false,
            error: "Navigate to a YouTube video to get started.",
          });
          return;
        }

        console.log("[YT Deep-Dive] GET_TRANSCRIPT tab:", targetTab.url);

        const mainWorldResult = await extractTranscriptInMainWorld(targetTab.id);
        console.log("[YT Deep-Dive] Main world result:", mainWorldResult);

        if (Array.isArray(mainWorldResult?.transcript)) {
          sendResponse({
            success: true,
            data: { transcript: mainWorldResult.transcript },
          });
          return;
        }

        sendResponse({
          success: false,
          error: mainWorldResult?.error || "TRANSCRIPT_UNAVAILABLE",
          debug: mainWorldResult?.debug,
        });
        return;
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

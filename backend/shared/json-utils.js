export function extractJsonFromText(text) {
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("LLM returned an empty response");
  }

  const trimmed = text.trim();

  try {
    return JSON.parse(trimmed);
  } catch {
    // Fall through to boundary extraction.
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch?.[1]) {
    return JSON.parse(fencedMatch[1].trim());
  }

  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");

  if (start === -1 || end <= start) {
    throw new Error("LLM returned invalid response");
  }

  return JSON.parse(trimmed.slice(start, end + 1));
}

export function normalizeDryRunInput(params = {}) {
  if (Array.isArray(params.input)) {
    return params.input.map((value) => String(value).trim()).filter(Boolean);
  }

  if (typeof params.input === "string") {
    return params.input
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }

  return [];
}

export function validateDryRunParams(params = {}) {
  const elements = normalizeDryRunInput(params);

  if (elements.length === 0) {
    return { ok: false, error: "params.input is required for simulate_dry_run_trace" };
  }

  if (elements.length > 8) {
    return { ok: false, error: "params.input supports a maximum of 8 elements" };
  }

  const tooLong = elements.find((element) => element.length > 15);
  if (tooLong) {
    return {
      ok: false,
      error: "Each params.input element must be 15 characters or fewer",
    };
  }

  return { ok: true, elements };
}

const MAX_TRANSCRIPT_CHARS = 80_000;

const STRUCTURED_NOTES_SCHEMA = `{
  "core_concepts": [
    {
      "timestamp": "MM:SS",
      "concept_title": "string",
      "summary_bullets": ["string"]
    }
  ],
  "problem_solving_rationale": {
    "problem_statement": "string",
    "why_this_approach": "string"
  },
  "key_takeaways": ["string"]
}`;

const MATH_LOGIC_SCHEMA = `{
  "has_math": true,
  "math_blocks": [
    {
      "description": "string",
      "latex_expression": "string using explicit LaTeX, e.g. $$f(x) = \\\\sigma(W^T x + b)$$"
    }
  ],
  "has_logic": true,
  "logic_blocks": [
    {
      "block_title": "string",
      "pseudocode": "string"
    }
  ]
}`;

const DRY_RUN_SCHEMA = `{
  "input_received": "string",
  "variable_tracking_headers": ["Step", "Variable1", "Variable2"],
  "trace_steps": [
    ["1", "value1", "value2"]
  ],
  "final_state_summary": "string"
}`;

const JSON_ONLY_RULE =
  "Respond with valid JSON only. No markdown fences, no explanation, no wrapping text.";

function truncateTranscript(transcript) {
  if (typeof transcript !== "string") {
    return { text: "", truncated: false };
  }

  if (transcript.length <= MAX_TRANSCRIPT_CHARS) {
    return { text: transcript, truncated: false };
  }

  return {
    text: transcript.slice(0, MAX_TRANSCRIPT_CHARS),
    truncated: true,
  };
}

function formatUserInput(params = {}) {
  if (Array.isArray(params.input)) {
    return params.input.map(String).join(", ");
  }

  if (params.input !== undefined && params.input !== null) {
    return String(params.input);
  }

  return "";
}

function buildStructuredNotesPrompt(transcript, params) {
  const { text, truncated } = truncateTranscript(transcript);

  const system = [
    "You are a technical learning assistant for long-form YouTube educational videos.",
    "Extract a structural smart summary from the transcript.",
    "Organize content into core concepts with timestamps, algorithmic rationale, and key takeaways.",
    JSON_ONLY_RULE,
    "Output must match this exact JSON shape:",
    STRUCTURED_NOTES_SCHEMA,
  ].join("\n");

  const userParts = [
    "Transcript:",
    text,
  ];

  if (truncated) {
    userParts.push(
      "",
      `[Note: transcript truncated to ${MAX_TRANSCRIPT_CHARS} characters.]`
    );
  }

  if (params?.focus) {
    userParts.push("", `Focus area requested by user: ${String(params.focus)}`);
  }

  return { system, user: userParts.join("\n") };
}

function buildMathLogicPrompt(transcript, params) {
  const { text, truncated } = truncateTranscript(transcript);

  const system = [
    "You are a math and logic extraction engine for technical video transcripts.",
    "Identify formulas and algorithmic logic blocks from the transcript.",
    "Formulas must use explicit LaTeX in latex_expression (display-style when appropriate).",
    "Logic must use clean, language-agnostic pseudocode.",
    "Set has_math to false and return an empty math_blocks array when no math is present.",
    "Set has_logic to false and return an empty logic_blocks array when no logic is present.",
    JSON_ONLY_RULE,
    "Output must match this exact JSON shape:",
    MATH_LOGIC_SCHEMA,
  ].join("\n");

  const userParts = ["Transcript:", text];

  if (truncated) {
    userParts.push(
      "",
      `[Note: transcript truncated to ${MAX_TRANSCRIPT_CHARS} characters.]`
    );
  }

  return { system, user: userParts.join("\n") };
}

function buildDryRunPrompt(transcript, params) {
  const { text, truncated } = truncateTranscript(transcript);
  const userInput = formatUserInput(params);

  const system = [
    "You are an interactive step-by-step dry run tracer for algorithms taught in video transcripts.",
    "Simulate execution while tracking variable state across steps.",
    "Use an absolute markdown-table-friendly row format in trace_steps.",
    "variable_tracking_headers must start with \"Step\" followed by one column per tracked variable.",
    "Each trace_steps row must align with variable_tracking_headers column count.",
    JSON_ONLY_RULE,
    "Output must match this exact JSON shape:",
    DRY_RUN_SCHEMA,
  ].join("\n");

  const userParts = [
    `User dry-run input (max 8 elements, max 15 chars each): ${userInput || "(none provided)"}`,
    "",
    "Transcript:",
    text,
  ];

  if (truncated) {
    userParts.push(
      "",
      `[Note: transcript truncated to ${MAX_TRANSCRIPT_CHARS} characters.]`
    );
  }

  return { system, user: userParts.join("\n") };
}

const PROMPT_BUILDERS = {
  generate_structured_notes: buildStructuredNotesPrompt,
  extract_math_and_logic: buildMathLogicPrompt,
  simulate_dry_run_trace: buildDryRunPrompt,
};

export function getPromptForSkill(skillName, transcript, params = {}) {
  const builder = PROMPT_BUILDERS[skillName];

  if (!builder) {
    throw new Error(`Unknown skill: ${skillName}`);
  }

  return builder(transcript, params);
}

export { MAX_TRANSCRIPT_CHARS };

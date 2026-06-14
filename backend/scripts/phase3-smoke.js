import {
  applyCorsToResponse,
  createJsonResponse,
  enforceRequestGuards,
  VALID_SKILLS,
} from "../shared/http.js";
import {
  validateDryRunTrace,
  validateMathLogic,
  validateStructuredNotes,
} from "../shared/schemas.js";
import { validateDryRunParams } from "../shared/json-utils.js";

process.env.ALLOWED_ORIGIN = "chrome-extension://test-extension";
process.env.API_AUTH_TOKEN = "test-token";

const corsHeaders = {
  origin: process.env.ALLOWED_ORIGIN,
  authorization: "Bearer test-token",
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function runSchemaTests() {
  const structured = validateStructuredNotes({
    core_concepts: [
      {
        timestamp: "04:12",
        concept_title: "Dynamic Programming",
        summary_bullets: ["Break problems into subproblems"],
      },
    ],
    problem_solving_rationale: {
      problem_statement: "Optimize recursive overlap",
      why_this_approach: "Memoization avoids recomputation",
    },
    key_takeaways: ["Use tabulation or memoization"],
  });
  assert(structured.valid, "structured notes schema should pass");

  const math = validateMathLogic({
    has_math: true,
    math_blocks: [{ description: "Sigmoid", latex_expression: "$$\\sigma(x)$$" }],
    has_logic: false,
    logic_blocks: [],
  });
  assert(math.valid, "math/logic schema should pass");

  const dryRun = validateDryRunTrace({
    input_received: "1,2,3",
    variable_tracking_headers: ["Step", "i", "sum"],
    trace_steps: [
      ["1", "0", "0"],
      ["2", "1", "1"],
    ],
    final_state_summary: "sum equals 3",
  });
  assert(dryRun.valid, "dry run schema should pass");

  const dryRunParams = validateDryRunParams({ input: ["a", "b", "c"] });
  assert(dryRunParams.ok, "dry run params should pass");

  const tooMany = validateDryRunParams({ input: "1,2,3,4,5,6,7,8,9" });
  assert(!tooMany.ok, "dry run params should reject more than 8 elements");
}

async function runHttpTests() {
  assert(VALID_SKILLS.length === 3, "skill allowlist should contain 3 skills");

  const missingAuth = await enforceRequestGuards({
    method: "POST",
    headers: { origin: process.env.ALLOWED_ORIGIN },
  });

  assert(missingAuth.handled, "missing auth should be handled");
  assert(missingAuth.response.status === 401, "missing auth should return 401");

  const blockedOrigin = await enforceRequestGuards({
    method: "POST",
    headers: {
      origin: "https://evil.example",
      authorization: "Bearer test-token",
    },
  });

  assert(blockedOrigin.handled, "blocked origin should be handled");
  assert(blockedOrigin.response.status === 403, "wrong origin should return 403");

  const responseText = JSON.stringify(missingAuth.response.body);
  assert(!responseText.includes("test-token"), "auth token must not leak");

  const options = await enforceRequestGuards({
    method: "OPTIONS",
    headers: corsHeaders,
  });

  assert(options.handled, "OPTIONS should be handled");
  assert(options.response.status === 204, "OPTIONS should return 204");
}

async function runHandlerTests() {
  let extractHandler;
  let syncHandler;

  try {
    ({ handler: extractHandler } = await import("../api/extract.js"));
    ({ handler: syncHandler } = await import("../api/sync.js"));
  } catch (error) {
    console.warn(
      "Skipping handler integration tests (run `npm install` in backend/ first):",
      error.message
    );
    return;
  }

  const unknownSkill = await extractHandler({
    method: "POST",
    headers: corsHeaders,
    body: JSON.stringify({ skill: "unknown", transcript: "hello" }),
  });
  assert(unknownSkill.status === 400, "unknown skill should return 400");

  const syncGet = await syncHandler({
    method: "GET",
    headers: corsHeaders,
  });
  assert(syncGet.status === 501, "sync GET should return 501");

  const syncPost = await syncHandler({
    method: "POST",
    headers: corsHeaders,
    body: JSON.stringify({
      videoId: "abc123",
      skill: "generate_structured_notes",
      data: { ok: true },
    }),
  });
  assert(syncPost.status === 501, "sync POST should return 501 until Phase 4");
}

async function run() {
  await runSchemaTests();
  await runHttpTests();
  await runHandlerTests();
  console.log("Phase 3 smoke tests passed");
}

run().catch((error) => {
  console.error(error.message);
  process.exit(1);
});

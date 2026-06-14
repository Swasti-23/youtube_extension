import { extractJsonFromText } from "../shared/json-utils.js";
import {
  applyCorsToResponse,
  createJsonResponse,
  enforceRequestGuards,
  parseJsonBody,
  VALID_SKILLS,
} from "../shared/http.js";
import { callLlm } from "../shared/llm.js";
import { getSkillStrategy } from "../shared/skills.js";

async function executeSkillStrategy(strategy, transcript, params) {
  const paramsResult = strategy.validateParams(params);

  if (!paramsResult.ok) {
    return {
      ok: false,
      status: 400,
      body: {
        success: false,
        error: paramsResult.error,
      },
    };
  }

  const prompt = strategy.buildPrompt(transcript, params);
  let lastValidationErrors = [];

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const llmText = await callLlm(prompt);
      const parsed = extractJsonFromText(llmText);
      const validation = strategy.validateOutput(parsed);

      if (validation.valid) {
        return {
          ok: true,
          body: {
            success: true,
            data: parsed,
          },
        };
      }

      lastValidationErrors = validation.errors;
    } catch (error) {
      if (attempt === 1) {
        const message = error.message || "LLM returned invalid response";

        if (message.includes("LLM service unavailable")) {
          return {
            ok: false,
            status: 500,
            body: {
              success: false,
              error: "LLM service unavailable",
            },
          };
        }

        return {
          ok: false,
          status: 500,
          body: {
            success: false,
            error: lastValidationErrors.length
              ? "Schema validation failed"
              : message,
            ...(lastValidationErrors.length ? { details: lastValidationErrors } : {}),
          },
        };
      }
    }
  }

  return {
    ok: false,
    status: 500,
    body: {
      success: false,
      error: "Schema validation failed",
      details: lastValidationErrors,
    },
  };
}

export async function handler(request = {}) {
  try {
    const guardResult = await enforceRequestGuards(request);

    if (guardResult.handled) {
      return guardResult.response;
    }

    const { corsHeaders } = guardResult;

    if ((request.method || "POST").toUpperCase() !== "POST") {
      return applyCorsToResponse(
        createJsonResponse(405, {
          success: false,
          error: "Method not allowed",
        }),
        corsHeaders
      );
    }

    const bodyResult = await parseJsonBody(request);

    if (!bodyResult.ok) {
      return applyCorsToResponse(bodyResult.response, corsHeaders);
    }

    const { skill, transcript, params = {} } = bodyResult.body;

    if (!skill || typeof skill !== "string") {
      return applyCorsToResponse(
        createJsonResponse(400, {
          success: false,
          error: "skill is required",
        }),
        corsHeaders
      );
    }

    if (!VALID_SKILLS.includes(skill)) {
      return applyCorsToResponse(
        createJsonResponse(400, {
          success: false,
          error: `Unknown skill: ${skill}`,
        }),
        corsHeaders
      );
    }

    if (!transcript || typeof transcript !== "string" || !transcript.trim()) {
      return applyCorsToResponse(
        createJsonResponse(400, {
          success: false,
          error: "transcript is required",
        }),
        corsHeaders
      );
    }

    const strategy = getSkillStrategy(skill);

    if (!strategy) {
      return applyCorsToResponse(
        createJsonResponse(400, {
          success: false,
          error: `Unknown skill: ${skill}`,
        }),
        corsHeaders
      );
    }

    const executionResult = await executeSkillStrategy(
      strategy,
      transcript,
      params
    );

    return applyCorsToResponse(
      createJsonResponse(executionResult.status || 200, executionResult.body),
      corsHeaders
    );
  } catch (error) {
    console.error("[YT Deep-Dive] extract.handler error:", error.message);

    return createJsonResponse(500, {
      success: false,
      error: "Internal server error",
    });
  }
}

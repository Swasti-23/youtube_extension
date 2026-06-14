import {
  applyCorsToResponse,
  createJsonResponse,
  enforceRequestGuards,
  parseJsonBody,
  VALID_SKILLS,
} from "../shared/http.js";

function validateSyncWriteBody(body) {
  const errors = [];

  if (!body || typeof body !== "object") {
    return { ok: false, errors: ["Body must be an object"] };
  }

  if (!body.videoId || typeof body.videoId !== "string" || !body.videoId.trim()) {
    errors.push("videoId is required");
  }

  if (!body.skill || typeof body.skill !== "string" || !VALID_SKILLS.includes(body.skill)) {
    errors.push("skill must be one of the supported LLM skills");
  }

  if (body.data === undefined || body.data === null || typeof body.data !== "object") {
    errors.push("data must be an object");
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return { ok: true };
}

export async function handler(request = {}) {
  try {
    const guardResult = await enforceRequestGuards(request);

    if (guardResult.handled) {
      return guardResult.response;
    }

    const { corsHeaders } = guardResult;
    const method = (request.method || "GET").toUpperCase();

    if (method === "GET") {
      return applyCorsToResponse(
        createJsonResponse(501, {
          success: false,
          error: "L2 cache read is not implemented until Phase 4",
        }),
        corsHeaders
      );
    }

    if (method !== "POST") {
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

    const validation = validateSyncWriteBody(bodyResult.body);

    if (!validation.ok) {
      return applyCorsToResponse(
        createJsonResponse(400, {
          success: false,
          error: "Invalid sync payload",
          details: validation.errors,
        }),
        corsHeaders
      );
    }

    return applyCorsToResponse(
      createJsonResponse(501, {
        success: false,
        error: "L2 cache write is not implemented until Phase 4",
        accepted: {
          videoId: bodyResult.body.videoId,
          skill: bodyResult.body.skill,
        },
      }),
      corsHeaders
    );
  } catch (error) {
    console.error("[YT Deep-Dive] sync.handler error:", error.message);

    return createJsonResponse(500, {
      success: false,
      error: "Internal server error",
    });
  }
}

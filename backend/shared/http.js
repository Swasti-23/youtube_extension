export const MAX_BODY_BYTES = 100 * 1024;

export const VALID_SKILLS = [
  "generate_structured_notes",
  "extract_math_and_logic",
  "simulate_dry_run_trace",
];

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;
const rateLimitBuckets = new Map();

function getHeader(headers, name) {
  if (!headers) {
    return undefined;
  }

  const target = name.toLowerCase();
  const entry = Object.entries(headers).find(
    ([key]) => key.toLowerCase() === target
  );

  return entry?.[1];
}

export function getRequestOrigin(request) {
  return getHeader(request.headers, "origin");
}

export function buildCorsHeaders(origin) {
  const allowedOrigin = process.env.ALLOWED_ORIGIN;

  if (!allowedOrigin || origin !== allowedOrigin) {
    return null;
  }

  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
  };
}

export function createJsonResponse(status, body, corsHeaders = {}) {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders,
    },
    body,
  };
}

export function handleOptionsPreflight(request) {
  const corsHeaders = buildCorsHeaders(getRequestOrigin(request));

  if (!corsHeaders) {
    return createJsonResponse(403, {
      success: false,
      error: "Origin not allowed",
    });
  }

  return {
    status: 204,
    headers: corsHeaders,
    body: null,
  };
}

export function enforceCors(request) {
  const corsHeaders = buildCorsHeaders(getRequestOrigin(request));

  if (!corsHeaders) {
    return {
      ok: false,
      response: createJsonResponse(403, {
        success: false,
        error: "Origin not allowed",
      }),
    };
  }

  return { ok: true, corsHeaders };
}

export function verifyAuth(request) {
  const expectedToken = process.env.API_AUTH_TOKEN;

  if (!expectedToken) {
    return {
      ok: false,
      response: createJsonResponse(500, {
        success: false,
        error: "Server auth is not configured",
      }),
    };
  }

  const authorization = getHeader(request.headers, "authorization") || "";
  const expectedHeader = `Bearer ${expectedToken}`;

  if (authorization !== expectedHeader) {
    return {
      ok: false,
      response: createJsonResponse(401, {
        success: false,
        error: "Unauthorized",
      }),
    };
  }

  return { ok: true };
}

export function getClientIp(request) {
  const forwarded = getHeader(request.headers, "x-forwarded-for");

  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }

  return request.ip || "unknown";
}

export function checkRateLimit(request) {
  const ip = getClientIp(request);
  const now = Date.now();
  const bucket = rateLimitBuckets.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };

  if (now >= bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }

  bucket.count += 1;
  rateLimitBuckets.set(ip, bucket);

  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);

    return {
      ok: false,
      response: {
        status: 429,
        headers: {
          "Content-Type": "application/json",
          "Retry-After": String(retryAfterSeconds),
        },
        body: {
          success: false,
          error: "Too many requests",
        },
      },
    };
  }

  return { ok: true };
}

export async function parseJsonBody(request) {
  let rawBody = request.body;

  if (rawBody === undefined || rawBody === null) {
    return {
      ok: false,
      response: createJsonResponse(400, {
        success: false,
        error: "Request body is required",
      }),
    };
  }

  if (typeof rawBody === "object") {
    return { ok: true, body: rawBody };
  }

  if (typeof rawBody !== "string") {
    return {
      ok: false,
      response: createJsonResponse(400, {
        success: false,
        error: "Request body must be JSON",
      }),
    };
  }

  const bodyBytes = Buffer.byteLength(rawBody, "utf8");

  if (bodyBytes > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: createJsonResponse(413, {
        success: false,
        error: "Payload too large",
      }),
    };
  }

  try {
    return { ok: true, body: JSON.parse(rawBody) };
  } catch {
    return {
      ok: false,
      response: createJsonResponse(400, {
        success: false,
        error: "Invalid JSON body",
      }),
    };
  }
}

export function applyCorsToResponse(response, corsHeaders) {
  return {
    ...response,
    headers: {
      ...(response.headers || {}),
      ...corsHeaders,
    },
  };
}

export async function enforceRequestGuards(request, { requireAuth = true } = {}) {
  if ((request.method || "GET").toUpperCase() === "OPTIONS") {
    return { handled: true, response: handleOptionsPreflight(request) };
  }

  const corsResult = enforceCors(request);
  if (!corsResult.ok) {
    return { handled: true, response: corsResult.response };
  }

  if (requireAuth) {
    const authResult = verifyAuth(request);
    if (!authResult.ok) {
      return {
        handled: true,
        response: applyCorsToResponse(authResult.response, corsResult.corsHeaders),
      };
    }
  }

  const rateResult = checkRateLimit(request);
  if (!rateResult.ok) {
    return {
      handled: true,
      response: applyCorsToResponse(rateResult.response, corsResult.corsHeaders),
    };
  }

  return { handled: false, corsHeaders: corsResult.corsHeaders };
}

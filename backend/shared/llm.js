import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

function getProviderName() {
  return (process.env.LLM_PROVIDER || "openai").toLowerCase();
}

function assertLlmConfigured() {
  if (!process.env.LLM_API_KEY) {
    throw new Error("LLM service unavailable");
  }

  if (!process.env.LLM_MODEL) {
    throw new Error("LLM service unavailable");
  }
}

async function callOpenAi({ system, user }) {
  const client = new OpenAI({ apiKey: process.env.LLM_API_KEY });

  const response = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    temperature: 0.2,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: system },
      { role: "user", content: user },
    ],
  });

  const content = response.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error("LLM returned invalid response");
  }

  return content;
}

async function callGoogle({ system, user }) {
  const client = new GoogleGenerativeAI(process.env.LLM_API_KEY);
  const model = client.getGenerativeModel({
    model: process.env.LLM_MODEL,
    systemInstruction: system,
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "application/json",
    },
  });

  const result = await model.generateContent(user);
  const content = result.response.text();

  if (!content) {
    throw new Error("LLM returned invalid response");
  }

  return content;
}

export async function callLlm(prompt) {
  assertLlmConfigured();

  const provider = getProviderName();

  if (provider === "google") {
    return callGoogle(prompt);
  }

  if (provider === "openai") {
    return callOpenAi(prompt);
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}

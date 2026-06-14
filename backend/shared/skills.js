import { getPromptForSkill } from "./prompt-templates.js";
import {
  validateDryRunTrace,
  validateMathLogic,
  validateStructuredNotes,
} from "./schemas.js";
import { validateDryRunParams } from "./json-utils.js";

function createStrategy({ skillName, buildPrompt, validateOutput, validateParams }) {
  return {
    skillName,
    buildPrompt(transcript, params) {
      return buildPrompt(transcript, params);
    },
    validateOutput,
    validateParams: validateParams || (() => ({ ok: true })),
  };
}

export const skillStrategies = {
  generate_structured_notes: createStrategy({
    skillName: "generate_structured_notes",
    buildPrompt: (transcript, params) =>
      getPromptForSkill("generate_structured_notes", transcript, params),
    validateOutput: validateStructuredNotes,
  }),
  extract_math_and_logic: createStrategy({
    skillName: "extract_math_and_logic",
    buildPrompt: (transcript, params) =>
      getPromptForSkill("extract_math_and_logic", transcript, params),
    validateOutput: validateMathLogic,
  }),
  simulate_dry_run_trace: createStrategy({
    skillName: "simulate_dry_run_trace",
    buildPrompt: (transcript, params) =>
      getPromptForSkill("simulate_dry_run_trace", transcript, params),
    validateOutput: validateDryRunTrace,
    validateParams: validateDryRunParams,
  }),
};

export function getSkillStrategy(skillName) {
  return skillStrategies[skillName] || null;
}

export function listSkillNames() {
  return Object.keys(skillStrategies);
}

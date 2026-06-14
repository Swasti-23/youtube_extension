const TIMESTAMP_PATTERN = /^\d{1,2}:\d{2}(:\d{2})?$/;

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value, minLength = 1) {
  if (!Array.isArray(value) || value.length < minLength) {
    return false;
  }

  return value.every((item) => typeof item === "string");
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function validateStructuredNotes(data) {
  const errors = [];

  if (!isObject(data)) {
    return { valid: false, errors: ["Root value must be an object"] };
  }

  if (!Array.isArray(data.core_concepts) || data.core_concepts.length === 0) {
    errors.push("core_concepts must be a non-empty array");
  } else {
    data.core_concepts.forEach((concept, index) => {
      if (!isObject(concept)) {
        errors.push(`core_concepts[${index}] must be an object`);
        return;
      }

      if (!isNonEmptyString(concept.timestamp)) {
        errors.push(`core_concepts[${index}].timestamp must be a non-empty string`);
      } else if (!TIMESTAMP_PATTERN.test(concept.timestamp.trim())) {
        errors.push(
          `core_concepts[${index}].timestamp must match MM:SS or HH:MM:SS`
        );
      }

      if (!isNonEmptyString(concept.concept_title)) {
        errors.push(`core_concepts[${index}].concept_title must be a non-empty string`);
      }

      if (!isStringArray(concept.summary_bullets)) {
        errors.push(
          `core_concepts[${index}].summary_bullets must be a non-empty string array`
        );
      }
    });
  }

  if (!isObject(data.problem_solving_rationale)) {
    errors.push("problem_solving_rationale must be an object");
  } else {
    if (!isNonEmptyString(data.problem_solving_rationale.problem_statement)) {
      errors.push("problem_solving_rationale.problem_statement must be a non-empty string");
    }

    if (!isNonEmptyString(data.problem_solving_rationale.why_this_approach)) {
      errors.push("problem_solving_rationale.why_this_approach must be a non-empty string");
    }
  }

  if (!isStringArray(data.key_takeaways)) {
    errors.push("key_takeaways must be a non-empty string array");
  }

  return { valid: errors.length === 0, errors };
}

export function validateMathLogic(data) {
  const errors = [];

  if (!isObject(data)) {
    return { valid: false, errors: ["Root value must be an object"] };
  }

  if (typeof data.has_math !== "boolean") {
    errors.push("has_math must be a boolean");
  }

  if (typeof data.has_logic !== "boolean") {
    errors.push("has_logic must be a boolean");
  }

  if (!Array.isArray(data.math_blocks)) {
    errors.push("math_blocks must be an array");
  } else if (data.has_math === true && data.math_blocks.length === 0) {
    errors.push("math_blocks must contain at least one item when has_math is true");
  } else {
    data.math_blocks.forEach((block, index) => {
      if (!isObject(block)) {
        errors.push(`math_blocks[${index}] must be an object`);
        return;
      }

      if (!isNonEmptyString(block.description)) {
        errors.push(`math_blocks[${index}].description must be a non-empty string`);
      }

      if (!isNonEmptyString(block.latex_expression)) {
        errors.push(`math_blocks[${index}].latex_expression must be a non-empty string`);
      }
    });
  }

  if (!Array.isArray(data.logic_blocks)) {
    errors.push("logic_blocks must be an array");
  } else if (data.has_logic === true && data.logic_blocks.length === 0) {
    errors.push("logic_blocks must contain at least one item when has_logic is true");
  } else {
    data.logic_blocks.forEach((block, index) => {
      if (!isObject(block)) {
        errors.push(`logic_blocks[${index}] must be an object`);
        return;
      }

      if (!isNonEmptyString(block.block_title)) {
        errors.push(`logic_blocks[${index}].block_title must be a non-empty string`);
      }

      if (!isNonEmptyString(block.pseudocode)) {
        errors.push(`logic_blocks[${index}].pseudocode must be a non-empty string`);
      }
    });
  }

  return { valid: errors.length === 0, errors };
}

export function validateDryRunTrace(data) {
  const errors = [];

  if (!isObject(data)) {
    return { valid: false, errors: ["Root value must be an object"] };
  }

  if (!isNonEmptyString(data.input_received)) {
    errors.push("input_received must be a non-empty string");
  }

  if (!isStringArray(data.variable_tracking_headers, 2)) {
    errors.push(
      "variable_tracking_headers must be a string array with at least Step plus one variable column"
    );
  } else if (data.variable_tracking_headers[0] !== "Step") {
    errors.push('variable_tracking_headers[0] must be "Step"');
  }

  if (!Array.isArray(data.trace_steps) || data.trace_steps.length === 0) {
    errors.push("trace_steps must be a non-empty array");
  } else {
    const expectedColumns = data.variable_tracking_headers?.length ?? 0;

    data.trace_steps.forEach((step, index) => {
      if (!Array.isArray(step)) {
        errors.push(`trace_steps[${index}] must be an array`);
        return;
      }

      if (expectedColumns > 0 && step.length !== expectedColumns) {
        errors.push(
          `trace_steps[${index}] must have ${expectedColumns} columns to match variable_tracking_headers`
        );
      }

      if (!step.every((cell) => typeof cell === "string")) {
        errors.push(`trace_steps[${index}] must contain only strings`);
      }
    });
  }

  if (!isNonEmptyString(data.final_state_summary)) {
    errors.push("final_state_summary must be a non-empty string");
  }

  return { valid: errors.length === 0, errors };
}

export const SCHEMA_VALIDATORS = {
  generate_structured_notes: validateStructuredNotes,
  extract_math_and_logic: validateMathLogic,
  simulate_dry_run_trace: validateDryRunTrace,
};

export function validateSkillOutput(skillName, data) {
  const validator = SCHEMA_VALIDATORS[skillName];

  if (!validator) {
    return { valid: false, errors: [`Unknown skill: ${skillName}`] };
  }

  return validator(data);
}

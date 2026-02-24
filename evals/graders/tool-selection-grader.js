// Deterministic grader: checks that the advisor called the right tools.
//
// Expected vars (from dataset):
//   - expectedTools: array of tool names that SHOULD be called (order-independent)
//   - forbiddenTools: array of tool names that should NOT be called (optional)
//
// Supports partial credit: 2/3 correct expected tools = 0.67 score.
// Forbidden tool violations always reduce to 0.

module.exports = (output, context) => {
  try {
    const parsed = JSON.parse(output);
    const toolCalls = parsed.toolCalls || [];
    const calledTools = toolCalls.map((tc) => tc.name);

    const expectedTools = context.vars.expectedTools
      ? JSON.parse(context.vars.expectedTools)
      : [];
    const forbiddenTools = context.vars.forbiddenTools
      ? JSON.parse(context.vars.forbiddenTools)
      : [];

    // Check forbidden tools first — any violation is an immediate fail
    const forbiddenViolations = forbiddenTools.filter((t) => calledTools.includes(t));
    if (forbiddenViolations.length > 0) {
      return {
        pass: false,
        score: 0,
        reason: `Called forbidden tool(s): ${forbiddenViolations.join(', ')}. Called: [${calledTools.join(', ')}]`,
      };
    }

    // No expected tools means we expect NO tool calls
    if (expectedTools.length === 0) {
      if (calledTools.length === 0) {
        return {
          pass: true,
          score: 1,
          reason: 'Correctly made no tool calls.',
        };
      }
      return {
        pass: false,
        score: 0,
        reason: `Expected no tool calls but called: [${calledTools.join(', ')}]`,
      };
    }

    // Partial credit: proportion of expected tools that were called
    const hits = expectedTools.filter((t) => calledTools.includes(t));
    const score = hits.length / expectedTools.length;
    const pass = score >= 1.0;

    const missing = expectedTools.filter((t) => !calledTools.includes(t));
    const extra = calledTools.filter((t) => !expectedTools.includes(t));

    let reason = `Called ${hits.length}/${expectedTools.length} expected tools.`;
    if (missing.length > 0) reason += ` Missing: [${missing.join(', ')}].`;
    if (extra.length > 0) reason += ` Extra: [${extra.join(', ')}].`;
    reason += ` Called: [${calledTools.join(', ')}]`;

    return { pass, score, reason };
  } catch (e) {
    return {
      pass: false,
      score: 0,
      reason: `Grader error: ${e.message}. Output: ${String(output).slice(0, 200)}`,
    };
  }
};

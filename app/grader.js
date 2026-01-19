import { runPython } from "./runner.js";

export async function gradeAttempt(exercise, studentCode) {
  // Phase 0: deterministic grading by executing a tiny check harness.
  // This is intentionally simple; we’ll replace with test-report JSON soon.
  const harness = exercise.grading?.harness ?? "";

  const code = `
${studentCode}

${harness}
`;

  const runner = await runPython({ code });

  // Phase 0 contract
  const passed = runner.status?.ok === true && (runner.stdout || "").includes("__PASS__");

  return {
    passed,
    score: passed ? (exercise.grading?.points ?? 1) : 0,
    max_score: exercise.grading?.points ?? 1,
    runner
  };
}

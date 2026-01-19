import { runPython } from "./runner.js";

export async function gradeAttempt(exercise, studentCode) {
  const grading = exercise.grading || {};
  const type = grading.type || "harness_v1";

  if (type !== "harness_v1") {
    return {
      passed: false,
      score: 0,
      max_score: grading.points ?? 0,
      runner: { status: { ok: false, exception: "Unsupported grading type in MVP" }, stdout: "", stderr: "" }
    };
  }

  const harness = grading.harness?.inline ?? "";
  const needle = grading.pass_condition?.stdout_includes ?? "__PASS__";

  const code = `
${studentCode}

${harness}
`;

  const runner = await runPython({ code });

  const passed = runner.status?.ok === true && (runner.stdout || "").includes(needle);

  return {
    passed,
    score: passed ? (grading.points ?? 1) : 0,
    max_score: grading.points ?? 1,
    runner
  };
}

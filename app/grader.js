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

  const entrypoint = exercise.files?.entrypoint || "main.py";
  const harness = grading.harness?.inline ?? "";
  const needle = grading.pass_condition?.stdout_includes ?? "__PASS__";

  // Build a deterministic grading entrypoint that:
  // 1) executes student entrypoint
  // 2) executes harness
  const gradeEntrypoint = "__grade__.py";
  const gradeScript = `
import runpy
runpy.run_path(${JSON.stringify("/hydrae/" + entrypoint)}, run_name="__main__")
${harness}
`;

  const files = {
    [entrypoint]: studentCode,
    [gradeEntrypoint]: gradeScript
  };

  const runner = await runPython({
    files,
    entrypoint: gradeEntrypoint,
    stdin: exercise.runner?.stdin ?? ""
  });

  const passed = runner.status?.ok === true && (runner.stdout || "").includes(needle);

  return {
    passed,
    score: passed ? (grading.points ?? 1) : 0,
    max_score: grading.points ?? 1,
    runner
  };
}

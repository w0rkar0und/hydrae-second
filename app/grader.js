import { runPython } from "./runner.js";
import { JSON_START, JSON_END } from "./config.js";
import { fetchText, normalize, extractMarkedJson } from "./utils.js";

const testsCache = new Map(); // url.href -> code string

async function getTestsCode(testsUrl) {
  const key = String(testsUrl.href || testsUrl);
  if (testsCache.has(key)) return testsCache.get(key);
  const code = await fetchText(testsUrl);
  testsCache.set(key, code);
  return code;
}

export async function gradeAttempt(exercise, studentCode, exerciseBaseUrl) {
  const grading = exercise.grading || {};
  const type = grading.type || "harness_v1";

  if (type === "harness_v1") {
    const entrypoint = exercise.files?.entrypoint || "main.py";
    const harness = grading.harness?.inline ?? "";
    const needle = grading.pass_condition?.stdout_includes ?? "__PASS__";

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

    const runnerRaw = await runPython({
      files,
      entrypoint: gradeEntrypoint,
      stdin: exercise.runner?.stdin ?? ""
    });

    const runner = normalize(runnerRaw);
    const passed = runner?.status?.ok === true && String(runner?.stdout || "").includes(needle);

    return {
      passed,
      score: passed ? (grading.points ?? 1) : 0,
      max_score: grading.points ?? 1,
      checks: [],
      runner
    };
  }

  if (type === "tests_v1") {
    const entrypoint = exercise.files?.entrypoint || "main.py";
    const testsRelPath = grading.tests?.path;
    if (!testsRelPath) {
      return {
        passed: false,
        score: 0,
        max_score: grading.points ?? 0,
        checks: [],
        runner: { status: { ok: false, exception: "tests_v1 requires grading.tests.path" }, stdout: "", stderr: "" }
      };
    }

    const testsUrl = new URL(testsRelPath, exerciseBaseUrl);
    const testsCode = await getTestsCode(testsUrl);

    const gradeEntrypoint = "__grade__.py";
    const points = grading.points ?? 1;
    const passThreshold = grading.pass_threshold ?? points;

    const gradeScript = `
import json, runpy, traceback

JSON_START = ${JSON.stringify(JSON_START)}
JSON_END = ${JSON.stringify(JSON_END)}

def run_tests(tests_path):
  ns = runpy.run_path(tests_path, run_name="__tests__")
  tests = []
  for k, v in ns.items():
    if k.startswith("test_") and callable(v):
      tests.append((k, v))
  tests.sort(key=lambda t: t[0])

  checks = []
  passed_count = 0

  for name, fn in tests:
    try:
      fn()
      checks.append({"id": name, "name": name, "passed": True, "message": ""})
      passed_count += 1
    except AssertionError as e:
      msg = str(e) if str(e) else "Assertion failed"
      checks.append({"id": name, "name": name, "passed": False, "message": msg})
    except Exception:
      checks.append({"id": name, "name": name, "passed": False, "message": traceback.format_exc()})

  return {"total": len(tests), "passed": passed_count, "checks": checks}

report = run_tests(${JSON.stringify("/hydrae/tests/tests.py")})

print(JSON_START)
print(json.dumps(report))
print(JSON_END)
`;

    const files = {
      [entrypoint]: studentCode,
      "tests/tests.py": testsCode,
      [gradeEntrypoint]: gradeScript
    };

    const runnerRaw = await runPython({
      files,
      entrypoint: gradeEntrypoint,
      stdin: exercise.runner?.stdin ?? ""
    });

    const runner = normalize(runnerRaw);
    const report = extractMarkedJson(runner?.stdout || "");

    if (runner?.status?.ok !== true || !report || typeof report.total !== "number") {
      return {
        passed: false,
        score: 0,
        max_score: points,
        checks: report?.checks || [],
        runner
      };
    }

    const total = report.total || 0;
    const passedCount = report.passed || 0;

    const perTest = total > 0 ? points / total : 0;
    const score = Math.round((passedCount * perTest) * 1000) / 1000;

    const passed = score >= passThreshold;

    return {
      passed,
      score,
      max_score: points,
      checks: report.checks || [],
      runner
    };
  }

  return {
    passed: false,
    score: 0,
    max_score: grading.points ?? 0,
    checks: [],
    runner: { status: { ok: false, exception: `Unsupported grading type: ${type}` }, stdout: "", stderr: "" }
  };
}

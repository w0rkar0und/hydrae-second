import { runPython } from "./runner.js";

const JSON_START = "___HYDRAE_GRADE_JSON_START___";
const JSON_END = "___HYDRAE_GRADE_JSON_END___";

async function fetchText(url) {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch: ${url} (${res.status})`);
  return await res.text();
}

function extractGradeJson(stdout) {
  const s = String(stdout || "");
  const a = s.indexOf(JSON_START);
  const b = s.indexOf(JSON_END);
  if (a === -1 || b === -1 || b <= a) return null;

  const jsonText = s.slice(a + JSON_START.length, b).trim();
  try {
    return JSON.parse(jsonText);
  } catch (_) {
    return null;
  }
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
    const testsCode = await fetchText(testsUrl);

    const gradeEntrypoint = "__grade__.py";
    const points = grading.points ?? 1;
    const passThreshold = grading.pass_threshold ?? points;

    // Tiny deterministic test runner (no pytest).
    // - loads tests file with runpy.run_path to get dict
    // - runs callables named test_*
    // - records AssertionError vs other Exception
    // - emits JSON between stable markers
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

  return {
    "total": len(tests),
    "passed": passed_count,
    "checks": checks
  }

# Write student file already present; now run tests against it.
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

    const runner = await runPython({
      files,
      entrypoint: gradeEntrypoint,
      stdin: exercise.runner?.stdin ?? ""
    });

    const report = extractGradeJson(runner.stdout || "");

    // If runner crashed or report missing, fail deterministically.
    if (runner.status?.ok !== true || !report || typeof report.total !== "number") {
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
    const score = Math.round((passedCount * perTest) * 1000) / 1000; // stable-ish rounding

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

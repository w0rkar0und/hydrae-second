import { runPython } from "./runner.js";
import { JSON_START, JSON_END } from "./config.js";
import { stripMarkedBlock, fetchText } from "./utils.js";

/**
 * Path 2 grader:
 * - runs student once and captures stdout/stderr/error
 * - if student errors, blocks tests and returns a single student error
 * - otherwise runs tests and reports per-test failures
 *
 * Assumes runner writes files under /hydrae (as your runner currently does).
 */

const GRADE_WRAPPER_PY = `
import io, json, runpy, traceback
from contextlib import redirect_stdout, redirect_stderr

STUDENT_PATH = "/hydrae/main.py"
TESTS_PATH = "/hydrae/tests/tests.py"

def run_student_capture():
    out_buf = io.StringIO()
    err_buf = io.StringIO()
    try:
        with redirect_stdout(out_buf), redirect_stderr(err_buf):
            runpy.run_path(STUDENT_PATH, run_name="__main__")
        return True, out_buf.getvalue(), err_buf.getvalue(), None
    except Exception:
        return False, out_buf.getvalue(), err_buf.getvalue(), traceback.format_exc()

def discover_tests(ns):
    tests = []
    if "TESTS" in ns and isinstance(ns["TESTS"], list):
        for name in ns["TESTS"]:
            fn = ns.get(name)
            if callable(fn):
                tests.append((name, fn))
    else:
        for name, obj in ns.items():
            if callable(obj) and name.startswith("test_"):
                tests.append((name, obj))
        tests.sort(key=lambda x: x[0])
    return tests

def main():
    ns = runpy.run_path(TESTS_PATH, run_name="__tests__")
    tests = discover_tests(ns)

    ok, s_out, s_err, s_exc = run_student_capture()

    checks = []
    if not ok:
        for name, _fn in tests:
            checks.append({
                "id": name,
                "name": name,
                "passed": False,
                "message": "Blocked: student code raised an error (see student.error)."
            })
        payload = {
            "total": len(tests),
            "passed": 0,
            "checks": checks,
            "student": {"ok": False, "stdout": s_out, "stderr": s_err, "error": s_exc}
        }
    else:
        passed = 0
        for name, fn in tests:
            try:
                fn()
                checks.append({"id": name, "name": name, "passed": True, "message": ""})
                passed += 1
            except Exception:
                checks.append({"id": name, "name": name, "passed": False, "message": traceback.format_exc()})

        payload = {
            "total": len(tests),
            "passed": passed,
            "checks": checks,
            "student": {"ok": True, "stdout": s_out, "stderr": s_err, "error": None}
        }

    print("${JSON_START}")
    print(json.dumps(payload))
    print("${JSON_END}")

main()
`;

export async function gradeAttempt(exercise, studentCode, baseUrl) {
  const grading = exercise.grading || {};
  const type = grading.type || "tests_v1";

  if (type !== "tests_v1") {
    return {
      passed: false,
      score: 0,
      max_score: grading.points ?? 0,
      checks: [],
      runner: { status: { ok: false, exception: `Unsupported grading type: ${type}` }, stdout: "", stderr: "" }
    };
  }

  const testsRel = grading.tests?.path;
  if (!testsRel) {
    return {
      passed: false,
      score: 0,
      max_score: grading.points ?? 0,
      checks: [],
      runner: { status: { ok: false, exception: "Missing grading.tests.path" }, stdout: "", stderr: "" }
    };
  }

  const testsText = await fetchText(new URL(testsRel, baseUrl));
  const points = grading.points ?? 10;
  const passThreshold = grading.pass_threshold ?? points;

  const files = {
    "main.py": studentCode,
    "tests/tests.py": testsText,
    "__grade__.py": GRADE_WRAPPER_PY
  };

  const runner = await runPython({
    files,
    entrypoint: "__grade__.py",
    stdin: ""
  });

  const raw = runner.stdout || "";
  const jsonBlock = stripMarkedBlock(raw);
  let report;

  try {
    report = JSON.parse(jsonBlock);
  } catch {
    return {
      passed: false,
      score: 0,
      max_score: points,
      checks: [],
      runner
    };
  }

  const total = report.total ?? 0;
  const passedCount = report.passed ?? 0;

  const perTest = total > 0 ? (points / total) : 0;
  const score = Math.round((passedCount * perTest) * 1000) / 1000;
  const passed = score >= passThreshold;

  return {
    passed,
    score,
    max_score: points,
    checks: report.checks || [],
    student: report.student || undefined,
    runner
  };
}

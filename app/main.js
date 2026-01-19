import { loadExercise } from "./exercise.js";
import { ensurePyodide, runPython } from "./runner.js";
import { gradeAttempt } from "./grader.js";

const $ = (id) => document.getElementById(id);

const JSON_START = "___HYDRAE_GRADE_JSON_START___";
const JSON_END = "___HYDRAE_GRADE_JSON_END___";

function stripMarkedBlock(text) {
  const s = String(text || "");
  const a = s.indexOf(JSON_START);
  const b = s.indexOf(JSON_END);
  if (a === -1 || b === -1 || b <= a) return s;
  return (s.slice(0, a) + s.slice(b + JSON_END.length)).trim();
}

function buildRunFiles(loaded, editorText) {
  const entry = loaded.files.entrypoint;

  const files = {
    ...(loaded.files.starter || {}),
    ...(loaded.files.readonly || {}),
    ...(loaded.files.assets || {})
  };

  files[entry] = editorText;
  return files;
}

async function boot() {
  const loaded = await loadExercise("./exercises/py.basics.001/exercise.json");
  const exercise = loaded.exercise;

  $("exercise-title").textContent = exercise.title;
  $("exercise-prompt").textContent = loaded.promptText || "";

  const entry = loaded.files.entrypoint;
  $("code").value = loaded.files.starter?.[entry] ?? "";

  await ensurePyodide();

  $("run").onclick = async () => {
    $("stdout").textContent = "";
    $("stderr").textContent = "";
    $("result").textContent = "Running...";

    const files = buildRunFiles(loaded, $("code").value);

    const res = await runPython({
      files,
      entrypoint: entry,
      stdin: exercise.runner?.stdin ?? ""
    });

    $("stdout").textContent = res.stdout || "";
    $("stderr").textContent = res.stderr || "";
    $("result").textContent = JSON.stringify(res.status, null, 2);
  };

  $("grade").onclick = async () => {
    $("stdout").textContent = "";
    $("stderr").textContent = "";
    $("result").textContent = "Grading...";

    const grade = await gradeAttempt(exercise, $("code").value, loaded.baseUrl);

    // Hide the embedded JSON report from the visible stdout panel
    $("stdout").textContent = stripMarkedBlock(grade.runner?.stdout || "");
    $("stderr").textContent = grade.runner?.stderr || "";
    $("result").textContent = JSON.stringify(grade, null, 2);
  };
}

boot();

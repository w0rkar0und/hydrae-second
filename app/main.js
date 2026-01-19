import { loadExercise } from "./exercise.js";
import { ensurePyodide, runPython } from "./runner.js";
import { gradeAttempt } from "./grader.js";

const $ = (id) => document.getElementById(id);

function buildRunFiles(loaded, editorText) {
  const entry = loaded.files.entrypoint;

  // Merge starter + readonly + assets, then overwrite entrypoint with editor content
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

    // For harness grading we only need studentCode; grader constructs its own VFS files.
    const grade = await gradeAttempt(exercise, $("code").value);

    $("stdout").textContent = grade.runner?.stdout || "";
    $("stderr").textContent = grade.runner?.stderr || "";
    $("result").textContent = JSON.stringify(grade, null, 2);
  };
}

boot();

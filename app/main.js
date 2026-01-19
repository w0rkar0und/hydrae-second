import { loadExercise } from "./exercise.js";
import { ensurePyodide, runPython } from "./runner.js";
import { gradeAttempt } from "./grader.js";

const $ = (id) => document.getElementById(id);

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

    const res = await runPython({
      code: $("code").value,
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

    const grade = await gradeAttempt(exercise, $("code").value);

    $("stdout").textContent = grade.runner?.stdout || "";
    $("stderr").textContent = grade.runner?.stderr || "";
    $("result").textContent = JSON.stringify(grade, null, 2);
  };
}

boot();

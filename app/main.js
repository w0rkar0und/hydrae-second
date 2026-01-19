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

async function fetchJson(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to fetch JSON: ${path} (${res.status})`);
  return await res.json();
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

function getSelectedExercisePath(indexData) {
  const hash = (window.location.hash || "").replace(/^#/, "").trim();
  if (hash) {
    const found = (indexData.exercises || []).find((e) => e.id === hash);
    if (found?.path) return found.path;
  }
  return (indexData.exercises || [])[0]?.path;
}

async function populateSelect(indexData) {
  const sel = $("exercise-select");
  sel.innerHTML = "";

  for (const ex of indexData.exercises || []) {
    const opt = document.createElement("option");
    opt.value = ex.path;
    opt.textContent = `${ex.id} — ${ex.title || ""}`.trim();
    sel.appendChild(opt);
  }

  const initialPath = getSelectedExercisePath(indexData);
  if (initialPath) sel.value = initialPath;

  sel.onchange = () => {
    const chosen = sel.value;
    const match = (indexData.exercises || []).find((e) => e.path === chosen);
    if (match?.id) window.location.hash = match.id;
    window.location.reload();
  };

  return sel.value;
}

function setBoot(msg) {
  const el = $("boot-status");
  if (el) el.textContent = `Boot status: ${msg}`;
}

function formatError(err) {
  const name = err?.name ? String(err.name) : "Error";
  const msg = err?.message ? String(err.message) : String(err);
  const stack = err?.stack ? String(err.stack) : "";
  // Always include message + stack (stack alone is often useless)
  return stack ? `${name}: ${msg}\n\n${stack}` : `${name}: ${msg}`;
}

function showError(err) {
  const txt = formatError(err);
  setBoot("ERROR (see stderr)");
  $("stderr").textContent = txt;
  $("result").textContent = JSON.stringify({ error: txt }, null, 2);
}

async function boot() {
  try {
    setBoot("main.js loaded");

    setBoot("fetching exercises/index.json ...");
    const indexData = await fetchJson("./exercises/index.json");

    setBoot("populating selector ...");
    const exercisePath = await populateSelect(indexData);

    setBoot(`loading exercise: ${exercisePath} ...`);
    const loaded = await loadExercise(exercisePath);
    const exercise = loaded.exercise;

    $("exercise-title").textContent = exercise.title;
    $("exercise-prompt").textContent = loaded.promptText || "";

    const entry = loaded.files.entrypoint;
    $("code").value = loaded.files.starter?.[entry] ?? "";

    setBoot("loading pyodide ...");
    await ensurePyodide();

    setBoot("ready (handlers attached)");

    $("run").onclick = async () => {
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "Running...";

      try {
        const files = buildRunFiles(loaded, $("code").value);

        const res = await runPython({
          files,
          entrypoint: entry,
          stdin: exercise.runner?.stdin ?? ""
        });

        $("stdout").textContent = res.stdout || "";
        $("stderr").textContent = res.stderr || "";
        $("result").textContent = JSON.stringify(res.status, null, 2);
      } catch (err) {
        showError(err);
      }
    };

    $("grade").onclick = async () => {
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "Grading...";

      try {
        const grade = await gradeAttempt(exercise, $("code").value, loaded.baseUrl);

        $("stdout").textContent = stripMarkedBlock(grade.runner?.stdout || "");
        $("stderr").textContent = grade.runner?.stderr || "";
        $("result").textContent = JSON.stringify(grade, null, 2);
      } catch (err) {
        showError(err);
      }
    };
  } catch (err) {
    showError(err);
  }
}

boot();

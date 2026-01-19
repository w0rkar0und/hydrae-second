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

function setBoot(msg) {
  const el = $("boot-status");
  if (el) el.textContent = `Boot status: ${msg}`;
}

function formatError(err) {
  const name = err?.name ? String(err.name) : "Error";
  const msg = err?.message ? String(err.message) : String(err);
  const stack = err?.stack ? String(err.stack) : "";
  return stack ? `${name}: ${msg}\n\n${stack}` : `${name}: ${msg}`;
}

function showError(err) {
  const txt = formatError(err);
  setBoot("ERROR (see stderr)");
  $("stderr").textContent = txt;
  $("result").textContent = JSON.stringify({ error: txt }, null, 2);
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

function getHashId() {
  return (window.location.hash || "").replace(/^#/, "").trim();
}

function findExerciseById(indexData, id) {
  return (indexData.exercises || []).find((e) => e.id === id) || null;
}

function findExerciseByPath(indexData, path) {
  return (indexData.exercises || []).find((e) => e.path === path) || null;
}

async function boot() {
  try {
    setBoot("loading index ...");
    const indexData = await fetchJson("./exercises/index.json");

    setBoot("loading pyodide ...");
    await ensurePyodide();

    // In-memory draft storage by exercise id (local-first, session scope)
    const drafts = new Map(); // id -> code string

    const sel = $("exercise-select");
    sel.innerHTML = "";

    for (const ex of indexData.exercises || []) {
      const opt = document.createElement("option");
      opt.value = ex.path;
      opt.textContent = `${ex.id} — ${ex.title || ""}`.trim();
      sel.appendChild(opt);
    }

    let current = {
      id: null,
      path: null,
      loaded: null,    // { baseUrl, exercise, promptText, files }
      entry: null
    };

    async function loadByPath(path) {
      setBoot(`loading exercise: ${path} ...`);

      const loaded = await loadExercise(path);
      const exercise = loaded.exercise;

      const entry = loaded.files.entrypoint;

      // stash previous draft
      if (current.id) drafts.set(current.id, $("code").value);

      // update UI
      $("exercise-title").textContent = exercise.title;
      $("exercise-prompt").textContent = loaded.promptText || "";

      // set editor content: draft > starter
      const exId = exercise.id;
      const draft = drafts.get(exId);
      $("code").value = (typeof draft === "string") ? draft : (loaded.files.starter?.[entry] ?? "");

      // clear output panels
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "";

      // update current
      current = { id: exId, path, loaded, entry };

      // set select + hash
      sel.value = path;
      window.location.hash = exId;

      setBoot("ready (handlers attached)");
    }

    // Initial selection: hash id if present, else first item
    const initialId = getHashId();
    const initialEx = initialId ? findExerciseById(indexData, initialId) : null;
    const initialPath = initialEx?.path || (indexData.exercises || [])[0]?.path;

    if (!initialPath) throw new Error("No exercises found in exercises/index.json");

    await loadByPath(initialPath);

    // Switch exercises without reload
    sel.onchange = async () => {
      try {
        const chosenPath = sel.value;
        await loadByPath(chosenPath);
      } catch (err) {
        showError(err);
      }
    };

    // Handle manual hash changes without reload (e.g. back/forward)
    window.addEventListener("hashchange", async () => {
      const id = getHashId();
      if (!id) return;

      const ex = findExerciseById(indexData, id);
      if (!ex?.path) return;

      if (current.id === id) return;

      try {
        await loadByPath(ex.path);
      } catch (err) {
        showError(err);
      }
    });

    // Wire buttons (use current exercise each click)
    $("run").onclick = async () => {
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "Running...";

      try {
        const loaded = current.loaded;
        const exercise = loaded.exercise;

        const files = buildRunFiles(loaded, $("code").value);

        const res = await runPython({
          files,
          entrypoint: current.entry,
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
        const loaded = current.loaded;
        const exercise = loaded.exercise;

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

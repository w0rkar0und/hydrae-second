import { loadExercise } from "./exercise.js";
import { ensurePyodide, runPython } from "./runner.js";
import { gradeAttempt } from "./grader.js";
import {
  loadProgress,
  saveProgress,
  getExerciseProgress,
  updateDraft,
  recordAttempt,
  exportProgressJson,
  mergeProgress
} from "./progress.js";

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

function setProgressStatus(msg) {
  const el = $("progress-status");
  if (el) el.textContent = msg ? String(msg) : "";
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

async function readFileAsText(file) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("Failed to read file"));
    r.readAsText(file);
  });
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

async function boot() {
  try {
    setBoot("loading index ...");
    const indexData = await fetchJson("./exercises/index.json");

    setBoot("loading pyodide ...");
    await ensurePyodide();

    // Progress
    let progress = loadProgress();
    const saveDraftsCheckbox = $("save-drafts");

    // In-memory current exercise
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
      loaded: null,
      entry: null
    };

    function maybeSaveDraft() {
      if (!saveDraftsCheckbox?.checked) return;
      if (!current.id) return;
      updateDraft(progress, current.id, $("code").value);
      saveProgress(progress);
      setProgressStatus(`Draft saved for ${current.id}`);
    }

    function renderProgressFor(exId) {
      const exP = getExerciseProgress(progress, exId);
      const best = exP.best || { passed: false, score: 0, max_score: 0 };
      const last = exP.last;

      const parts = [];
      parts.push(`Exercise: ${exId}`);
      parts.push(`Best: ${best.score}/${best.max_score} (${best.passed ? "PASSED" : "NOT PASSED"})`);
      if (best.achieved_utc) parts.push(`Best achieved: ${best.achieved_utc}`);
      if (last?.attempted_utc) parts.push(`Last attempt: ${last.attempted_utc} — ${last.score}/${last.max_score} (${last.passed ? "PASSED" : "FAILED"})`);
      if (saveDraftsCheckbox?.checked && exP.draft?.saved_utc) parts.push(`Draft saved: ${exP.draft.saved_utc}`);
      setProgressStatus(parts.join("\n"));
    }

    async function loadByPath(path) {
      setBoot(`loading exercise: ${path} ...`);

      // Save draft of outgoing exercise (optional)
      maybeSaveDraft();

      const loaded = await loadExercise(path);
      const exercise = loaded.exercise;
      const entry = loaded.files.entrypoint;
      const exId = exercise.id;

      // Update UI
      $("exercise-title").textContent = exercise.title;
      $("exercise-prompt").textContent = loaded.promptText || "";

      // Choose code: saved draft (if enabled) > starter
      const exP = getExerciseProgress(progress, exId);
      const draftCode = saveDraftsCheckbox?.checked ? exP.draft?.code : null;

      $("code").value = (typeof draftCode === "string") ? draftCode : (loaded.files.starter?.[entry] ?? "");

      // Clear outputs
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "";

      // Update current
      current = { id: exId, path, loaded, entry };

      // Hash sync
      window.location.hash = exId;
      sel.value = path;

      setBoot("ready (handlers attached)");
      renderProgressFor(exId);
    }

    // Initial exercise
    const initialId = getHashId();
    const initialEx = initialId ? findExerciseById(indexData, initialId) : null;
    const initialPath = initialEx?.path || (indexData.exercises || [])[0]?.path;
    if (!initialPath) throw new Error("No exercises found in exercises/index.json");

    await loadByPath(initialPath);

    // Switch exercises without reload
    sel.onchange = async () => {
      try {
        await loadByPath(sel.value);
      } catch (err) {
        showError(err);
      }
    };

    // Hash changes (back/forward)
    window.addEventListener("hashchange", async () => {
      const id = getHashId();
      if (!id) return;
      if (current.id === id) return;

      const ex = findExerciseById(indexData, id);
      if (!ex?.path) return;

      try {
        await loadByPath(ex.path);
      } catch (err) {
        showError(err);
      }
    });

    // Autosave draft on pause (simple debounce)
    let draftTimer = null;
    $("code").addEventListener("input", () => {
      if (!saveDraftsCheckbox?.checked) return;
      if (draftTimer) clearTimeout(draftTimer);
      draftTimer = setTimeout(() => {
        try {
          maybeSaveDraft();
          renderProgressFor(current.id);
        } catch (_) {}
      }, 700);
    });

    // Export progress
    $("export-progress").onclick = () => {
      try {
        maybeSaveDraft();
        const json = exportProgressJson(progress);
        const name = `hydrae_progress_${new Date().toISOString().slice(0, 10)}.json`;
        downloadText(name, json);
        setProgressStatus("Exported progress JSON.");
      } catch (err) {
        showError(err);
      }
    };

    // Import progress
    $("import-progress").onclick = () => {
      $("import-file").value = "";
      $("import-file").click();
    };

    $("import-file").onchange = async () => {
      try {
        const file = $("import-file").files?.[0];
        if (!file) return;

        const text = await readFileAsText(file);
        const incoming = JSON.parse(text);

        progress = mergeProgress(progress, incoming);
        saveProgress(progress);

        // If drafts saving is on, update editor to imported draft for current exercise (if newer)
        if (saveDraftsCheckbox?.checked && current.id) {
          const exP = getExerciseProgress(progress, current.id);
          if (typeof exP.draft?.code === "string") {
            $("code").value = exP.draft.code;
          }
        }

        renderProgressFor(current.id);
        setProgressStatus("Imported and merged progress JSON.");
      } catch (err) {
        showError(err);
      }
    };

    // Run
    $("run").onclick = async () => {
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "Running...";

      try {
        maybeSaveDraft();

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

    // Grade
    $("grade").onclick = async () => {
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "Grading...";

      try {
        maybeSaveDraft();

        const loaded = current.loaded;
        const exercise = loaded.exercise;

        const grade = await gradeAttempt(exercise, $("code").value, loaded.baseUrl);

        // Persist attempt
        if (current.id) {
          recordAttempt(progress, current.id, grade);
          saveProgress(progress);
        }

        $("stdout").textContent = stripMarkedBlock(grade.runner?.stdout || "");
        $("stderr").textContent = grade.runner?.stderr || "";
        $("result").textContent = JSON.stringify(grade, null, 2);

        renderProgressFor(current.id);
      } catch (err) {
        showError(err);
      }
    };
  } catch (err) {
    showError(err);
  }
}

boot();

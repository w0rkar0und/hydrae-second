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
  mergeProgress,
  clearDraft,
  clearExerciseProgress
} from "./progress.js";
import { stripMarkedBlock, fetchJson, formatError, readFileAsText, downloadText } from "./utils.js";

const $ = (id) => document.getElementById(id);

function setBoot(msg) {
  const el = $("boot-status");
  if (el) el.textContent = `Boot status: ${msg}`;
}

function setProgressStatus(msg) {
  const el = $("progress-status");
  if (el) el.textContent = msg ? String(msg) : "";
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

async function boot() {
  try {
    setBoot("loading index ...");
    const indexData = await fetchJson("./exercises/index.json");

    setBoot("loading pyodide (first time may take a while) ...");
    await ensurePyodide();
    setBoot("pyodide ready");

    let progress = loadProgress();
    const saveDraftsCheckbox = $("save-drafts");
    const codeEl = $("code");

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
      entry: null,
      starterCode: ""
    };

    // ===== Unsaved changes guard (baseline compare, very reliable) =====
    let lastSavedCode = ""; // baseline string
    const isDirty = () => String(codeEl.value || "") !== String(lastSavedCode || "");

    const beforeUnloadHandler = (e) => {
      if (!isDirty()) return;
      e.preventDefault();
      // Required by some browsers to trigger the confirmation dialog
      e.returnValue = "You have unsaved changes.";
      return "You have unsaved changes.";
    };

    // Register both ways (browser quirks)
    window.onbeforeunload = beforeUnloadHandler;
    window.addEventListener("beforeunload", beforeUnloadHandler);

    const markSavedBaseline = () => {
      lastSavedCode = String(codeEl.value || "");
    };
    // ================================================================

    function maybeSaveDraft() {
      if (!saveDraftsCheckbox?.checked) return;
      if (!current.id) return;
      updateDraft(progress, current.id, codeEl.value);
      saveProgress(progress);
      markSavedBaseline();
    }

    function renderProgressFor(exId) {
      const exP = getExerciseProgress(progress, exId);
      const best = exP.best || { passed: false, score: 0, max_score: 0 };
      const last = exP.last;

      const parts = [];
      parts.push(`Exercise: ${exId}`);
      parts.push(`Best: ${best.score}/${best.max_score} (${best.passed ? "PASSED" : "NOT PASSED"})`);
      if (best.achieved_utc) parts.push(`Best achieved: ${best.achieved_utc}`);
      if (last?.attempted_utc)
        parts.push(`Last attempt: ${last.attempted_utc} — ${last.score}/${last.max_score} (${last.passed ? "PASSED" : "FAILED"})`);
      if (saveDraftsCheckbox?.checked && exP.draft?.saved_utc)
        parts.push(`Draft saved: ${exP.draft.saved_utc}`);

      // Debug line (remove later if you want)
      parts.push(`Dirty: ${isDirty() ? "YES" : "NO"}`);

      setProgressStatus(parts.join("\n"));
    }

    async function loadByPath(path) {
      // If drafts ON, save outgoing so switching exercises doesn't trigger warnings
      maybeSaveDraft();

      setBoot(`loading exercise: ${path} ...`);

      const loaded = await loadExercise(path);
      const exercise = loaded.exercise;
      const entry = loaded.files.entrypoint;
      const exId = exercise.id;

      const starterCode = loaded.files.starter?.[entry] ?? "";

      $("exercise-title").textContent = exercise.title;
      $("exercise-prompt").textContent = loaded.promptText || "";

      const exP = getExerciseProgress(progress, exId);
      const draftCode = saveDraftsCheckbox?.checked ? exP.draft?.code : null;
      codeEl.value = (typeof draftCode === "string") ? draftCode : starterCode;

      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "";

      current = { id: exId, path, loaded, entry, starterCode };
      window.location.hash = exId;
      sel.value = path;

      // Baseline becomes whatever we just loaded
      markSavedBaseline();

      setBoot("ready (handlers attached)");
      renderProgressFor(exId);
    }

    const initialId = getHashId();
    const initialEx = initialId ? findExerciseById(indexData, initialId) : null;
    const initialPath = initialEx?.path || (indexData.exercises || [])[0]?.path;
    if (!initialPath) throw new Error("No exercises found in exercises/index.json");

    await loadByPath(initialPath);

    sel.onchange = async () => {
      try { await loadByPath(sel.value); } catch (err) { showError(err); }
    };

    window.addEventListener("hashchange", async () => {
      const id = getHashId();
      if (!id || current.id === id) return;
      const ex = findExerciseById(indexData, id);
      if (!ex?.path) return;
      try { await loadByPath(ex.path); } catch (err) { showError(err); }
    });

    // Autosave drafts (debounced)
    let draftTimer = null;
    codeEl.addEventListener("input", () => {
      if (saveDraftsCheckbox?.checked) {
        if (draftTimer) clearTimeout(draftTimer);
        draftTimer = setTimeout(() => {
          try {
            maybeSaveDraft();
            renderProgressFor(current.id);
          } catch (_) {}
        }, 700);
      } else {
        // drafts off: just update the debug display
        renderProgressFor(current.id);
      }
    });

    saveDraftsCheckbox.addEventListener("change", () => {
      try {
        if (!current.id) return;

        if (!saveDraftsCheckbox.checked) {
          clearDraft(progress, current.id);
          saveProgress(progress);
          // Do NOT change baseline; if user has edits, they remain dirty (and should warn)
        } else {
          // turning ON: save immediately, which also updates baseline -> clean
          updateDraft(progress, current.id, codeEl.value);
          saveProgress(progress);
          markSavedBaseline();
        }

        renderProgressFor(current.id);
      } catch (err) { showError(err); }
    });

    $("reset-draft").onclick = () => {
      try {
        if (!current.id) return;

        codeEl.value = current.starterCode;
        clearDraft(progress, current.id);

        if (saveDraftsCheckbox.checked) {
          updateDraft(progress, current.id, codeEl.value);
          saveProgress(progress);
          markSavedBaseline();
        } else {
          saveProgress(progress);
          // baseline stays as-is => this will be dirty unless baseline was also starter
        }

        renderProgressFor(current.id);
      } catch (err) { showError(err); }
    };

    $("clear-exercise-progress").onclick = () => {
      try {
        if (!current.id) return;

        clearExerciseProgress(progress, current.id);
        saveProgress(progress);

        codeEl.value = current.starterCode;

        if (saveDraftsCheckbox.checked) {
          updateDraft(progress, current.id, codeEl.value);
          saveProgress(progress);
          markSavedBaseline();
        } else {
          // baseline unchanged
        }

        renderProgressFor(current.id);
      } catch (err) { showError(err); }
    };

    $("export-progress").onclick = () => {
      try {
        maybeSaveDraft();
        const json = exportProgressJson(progress);
        const name = `hydrae_progress_${new Date().toISOString().slice(0, 10)}.json`;
        downloadText(name, json, "application/json");
        setProgressStatus("Exported progress JSON.");
      } catch (err) { showError(err); }
    };

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

        if (saveDraftsCheckbox.checked && current.id) {
          const exP = getExerciseProgress(progress, current.id);
          if (typeof exP.draft?.code === "string") {
            codeEl.value = exP.draft.code;
            markSavedBaseline();
          }
        }

        renderProgressFor(current.id);
        setProgressStatus("Imported and merged progress JSON.");
      } catch (err) { showError(err); }
    };

    // Run button
    const runBtn = $("run");
    runBtn.onclick = async () => {
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "Running...";

      try {
        maybeSaveDraft();

        const loaded = current.loaded;
        const exercise = loaded.exercise;

        const res = await runPython({
          files: buildRunFiles(loaded, codeEl.value),
          entrypoint: current.entry,
          stdin: exercise.runner?.stdin ?? ""
        });

        $("stdout").textContent = res.stdout || "";
        $("stderr").textContent = res.stderr || "";
        $("result").textContent = JSON.stringify(res.status, null, 2);

        renderProgressFor(current.id);
      } catch (err) { showError(err); }
    };

    // Grade button
    const gradeBtn = $("grade");
    gradeBtn.onclick = async () => {
      $("stdout").textContent = "";
      $("stderr").textContent = "";
      $("result").textContent = "Grading...";

      try {
        maybeSaveDraft();

        const loaded = current.loaded;
        const exercise = loaded.exercise;

        const grade = await gradeAttempt(exercise, codeEl.value, loaded.baseUrl);

        if (current.id) {
          recordAttempt(progress, current.id, grade);
          saveProgress(progress);
        }

        $("stdout").textContent = stripMarkedBlock(grade.runner?.stdout || "");
        $("stderr").textContent = grade.runner?.stderr || "";
        $("result").textContent = JSON.stringify(grade, null, 2);

        renderProgressFor(current.id);
      } catch (err) { showError(err); }
    };

    // ===== Keyboard shortcuts (Firefox-safe) =====
    const shortcutHandler = (e) => {
      const accel = e.metaKey || e.ctrlKey;
      if (!accel) return;

      const isEnter =
        (e.key === "Enter" || e.key === "NumpadEnter" || e.code === "Enter" || e.code === "NumpadEnter");
      if (!isEnter) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) gradeBtn.click();
      else runBtn.click();
    };

    codeEl.addEventListener("keydown", shortcutHandler);
    document.addEventListener("keydown", (e) => {
      const tag = document.activeElement?.tagName;
      if (tag && tag !== "TEXTAREA" && tag !== "BODY") return;
      shortcutHandler(e);
    });
    // ===========================================

    // initial baseline already set by loadByPath()
    setBoot("ready (handlers attached)");
  } catch (err) {
    showError(err);
  }
}

boot();

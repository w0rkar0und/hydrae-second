import { PROGRESS_STORAGE_KEY } from "./config.js";

function nowIso() {
  return new Date().toISOString();
}

function safeParse(jsonText) {
  try {
    return JSON.parse(jsonText);
  } catch (_) {
    return null;
  }
}

export function loadProgress() {
  const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
  if (!raw) {
    return {
      schema_version: "1.0",
      updated_utc: nowIso(),
      exercises: {}
    };
  }

  const parsed = safeParse(raw);
  if (!parsed || typeof parsed !== "object") {
    return {
      schema_version: "1.0",
      updated_utc: nowIso(),
      exercises: {}
    };
  }

  if (!parsed.exercises || typeof parsed.exercises !== "object") {
    parsed.exercises = {};
  }

  if (!parsed.schema_version) parsed.schema_version = "1.0";
  if (!parsed.updated_utc) parsed.updated_utc = nowIso();

  return parsed;
}

export function saveProgress(progress) {
  progress.updated_utc = nowIso();
  localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
}

export function getExerciseProgress(progress, exerciseId) {
  if (!progress.exercises[exerciseId]) {
    progress.exercises[exerciseId] = {
      best: { passed: false, score: 0, max_score: 0 },
      last: null,
      draft: null
    };
  }
  return progress.exercises[exerciseId];
}

export function updateDraft(progress, exerciseId, code) {
  const ex = getExerciseProgress(progress, exerciseId);
  ex.draft = {
    code: String(code),
    saved_utc: nowIso()
  };
}

export function clearDraft(progress, exerciseId) {
  const ex = getExerciseProgress(progress, exerciseId);
  ex.draft = null;
}

export function clearExerciseProgress(progress, exerciseId) {
  delete progress.exercises[exerciseId];
}

export function recordAttempt(progress, exerciseId, attempt) {
  const ex = getExerciseProgress(progress, exerciseId);

  const cleaned = {
    passed: !!attempt.passed,
    score: Number(attempt.score ?? 0),
    max_score: Number(attempt.max_score ?? 0),
    attempted_utc: nowIso(),
    checks: Array.isArray(attempt.checks)
      ? attempt.checks.map((c) => ({
          id: String(c.id ?? ""),
          passed: !!c.passed,
          message: String(c.message ?? "")
        }))
      : []
  };

  ex.last = cleaned;

  const best = ex.best || { passed: false, score: 0, max_score: 0 };
  const bestScore = Number(best.score ?? 0);
  const newScore = cleaned.score;

  const shouldReplace =
    newScore > bestScore ||
    (newScore === bestScore && cleaned.passed && !best.passed);

  if (shouldReplace) {
    ex.best = {
      passed: cleaned.passed,
      score: cleaned.score,
      max_score: cleaned.max_score,
      achieved_utc: cleaned.attempted_utc
    };
  }
}

export function exportProgressJson(progress) {
  return JSON.stringify(progress, null, 2);
}

export function mergeProgress(base, incoming) {
  if (!incoming || typeof incoming !== "object") return base;
  if (!incoming.exercises || typeof incoming.exercises !== "object") return base;

  for (const [id, incEx] of Object.entries(incoming.exercises)) {
    const baseEx = getExerciseProgress(base, id);

    if (incEx?.best) {
      const b = baseEx.best || { passed: false, score: 0, max_score: 0 };
      const i = incEx.best;

      const bScore = Number(b.score ?? 0);
      const iScore = Number(i.score ?? 0);

      const iPassed = !!i.passed;
      const bPassed = !!b.passed;

      if (iScore > bScore || (iScore === bScore && iPassed && !bPassed)) {
        baseEx.best = {
          passed: iPassed,
          score: iScore,
          max_score: Number(i.max_score ?? baseEx.best?.max_score ?? 0),
          achieved_utc: String(i.achieved_utc ?? nowIso())
        };
      }
    }

    if (incEx?.last) {
      const bT = baseEx.last?.attempted_utc ? Date.parse(baseEx.last.attempted_utc) : 0;
      const iT = incEx.last?.attempted_utc ? Date.parse(incEx.last.attempted_utc) : 0;
      if (iT && iT >= bT) baseEx.last = incEx.last;
    }

    if (incEx?.draft) {
      const bT = baseEx.draft?.saved_utc ? Date.parse(baseEx.draft.saved_utc) : 0;
      const iT = incEx.draft?.saved_utc ? Date.parse(incEx.draft.saved_utc) : 0;
      if (iT && iT >= bT) baseEx.draft = incEx.draft;
    }
  }

  return base;
}

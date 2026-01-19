async function fetchText(url) {
  const u = String(url);
  let res;
  try {
    res = await fetch(u, { cache: "no-store" });
  } catch (e) {
    throw new Error(`Network fetch failed for: ${u} (${e?.message || e})`);
  }

  if (!res.ok) {
    const ct = res.headers.get("content-type") || "";
    let body = "";
    try {
      body = ct.includes("text") ? await res.text() : "";
    } catch (_) {}

    const extra = body ? ` Body (truncated): ${body.slice(0, 200)}` : "";
    throw new Error(`HTTP ${res.status} fetching: ${u}.${extra}`);
  }

  return await res.text();
}

async function materializeFileMap(fileMap, baseUrl) {
  const out = {};
  if (!fileMap) return out;

  for (const [vfsPath, src] of Object.entries(fileMap)) {
    if (!src) continue;

    if (typeof src.inline === "string") {
      out[vfsPath] = src.inline;
      continue;
    }

    if (typeof src.path === "string") {
      const url = new URL(src.path, baseUrl);
      out[vfsPath] = await fetchText(url);
      continue;
    }

    throw new Error(`Invalid file source for ${vfsPath}: expected {inline} or {path}`);
  }

  return out;
}

export async function loadExercise(exerciseJsonPath) {
  const baseUrl = new URL(exerciseJsonPath, window.location.href);

  const exercise = JSON.parse(await fetchText(baseUrl));

  // Prompt: inline wins, else path
  let promptText = "";
  if (exercise.prompt?.inline) {
    promptText = exercise.prompt.inline;
  } else if (exercise.prompt?.path) {
    promptText = await fetchText(new URL(exercise.prompt.path, baseUrl));
  }

  const starter = await materializeFileMap(exercise.files?.starter, baseUrl);
  const readonly = await materializeFileMap(exercise.files?.readonly, baseUrl);
  const assets = await materializeFileMap(exercise.files?.assets, baseUrl);

  return {
    baseUrl: baseUrl.href,
    exercise,
    promptText,
    files: {
      entrypoint: exercise.files?.entrypoint || "main.py",
      starter,
      readonly,
      assets
    }
  };
}

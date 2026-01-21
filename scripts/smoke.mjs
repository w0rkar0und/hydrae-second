import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();

async function exists(p) {
  try { await stat(p); return true; } catch { return false; }
}

async function readText(p) {
  return await readFile(p, "utf8");
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exitCode = 1;
}

function ok(msg) {
  console.log("OK:", msg);
}

async function listJsonFiles(dir) {
  const out = [];
  const items = await readdir(dir, { withFileTypes: true });
  for (const it of items) {
    const full = path.join(dir, it.name);
    if (it.isDirectory()) out.push(...await listJsonFiles(full));
    else if (it.isFile() && it.name.endsWith(".json")) out.push(full);
  }
  return out;
}

async function main() {
  // 1) Required HTML element IDs
  const htmlPath = path.join(ROOT, "index.html");
  if (!(await exists(htmlPath))) return fail("index.html missing");

  const html = await readText(htmlPath);
  const requiredIds = [
    "boot-status",
    "exercise-select",
    "exercise-title",
    "exercise-prompt",
    "code",
    "run",
    "grade",
    "stdout",
    "stderr",
    "result",
    "export-progress",
    "import-progress",
    "import-file",
    "save-drafts",
    "reset-draft",
    "clear-exercise-progress",
    "progress-status"
  ];
  for (const id of requiredIds) {
    if (!html.includes(`id="${id}"`)) fail(`index.html missing id="${id}"`);
  }
  if (process.exitCode) return;
  ok("index.html contains required element IDs");

  // 2) exercises/index.json exists + valid + referenced exercise paths exist
  const indexPath = path.join(ROOT, "exercises", "index.json");
  if (!(await exists(indexPath))) return fail("exercises/index.json missing");

  let indexJson;
  try {
    indexJson = JSON.parse(await readText(indexPath));
  } catch (e) {
    return fail(`exercises/index.json invalid JSON: ${e.message}`);
  }

  const exercises = Array.isArray(indexJson.exercises) ? indexJson.exercises : [];
  if (exercises.length === 0) fail("exercises/index.json has no exercises[] entries");

  for (const ex of exercises) {
    if (!ex.id) fail("exercises/index.json entry missing id");
    if (!ex.path) fail(`exercises/index.json entry ${ex.id || "(unknown)"} missing path`);
    const exJsonPath = path.join(ROOT, ex.path);
    if (!(await exists(exJsonPath))) fail(`Exercise file not found: ${ex.path}`);
  }
  if (process.exitCode) return;
  ok("exercises/index.json valid and referenced exercise.json files exist");

  // 3) Each exercise.json is valid + referenced files exist
  //    (We check all JSON files under exercises/, not just index references)
  const allJson = await listJsonFiles(path.join(ROOT, "exercises"));

  for (const jp of allJson) {
    const rel = path.relative(ROOT, jp);

    let data;
    try {
      data = JSON.parse(await readText(jp));
    } catch (e) {
      fail(`${rel} invalid JSON: ${e.message}`);
      continue;
    }

    // only validate exercise.json-like shapes (heuristic: has files or grading)
    if (!data || (typeof data !== "object")) continue;
    if (!("files" in data) && !("grading" in data)) continue;

    if (!data.id) fail(`${rel} missing "id"`);
    if (!data.title) fail(`${rel} missing "title"`);
    if (!data.files?.entrypoint) fail(`${rel} missing "files.entrypoint"`);

    // Validate prompt/path references
    const baseDir = path.dirname(jp);

    const checkRefPath = async (ref, label) => {
      if (!ref?.path) return;
      const p = path.join(baseDir, ref.path);
      if (!(await exists(p))) fail(`${rel} references missing ${label}: ${ref.path}`);
    };

    await checkRefPath(data.prompt, "prompt.path");
    await checkRefPath(data.grading?.tests, "grading.tests.path");

    // Validate starter/readonly/assets file sources with {path}
    const groups = ["starter", "readonly", "assets"];
    for (const g of groups) {
      const m = data.files?.[g];
      if (!m || typeof m !== "object") continue;

      for (const [vfs, src] of Object.entries(m)) {
        if (src?.path) {
          const p = path.join(baseDir, src.path);
          if (!(await exists(p))) fail(`${rel} files.${g}[${vfs}] references missing path: ${src.path}`);
        } else if (typeof src?.inline === "string") {
          // ok
        } else {
          fail(`${rel} files.${g}[${vfs}] must have {inline} or {path}`);
        }
      }
    }
  }

  if (process.exitCode) return;
  ok("exercise.json files validate (structure + referenced files exist)");

  // 4) JS syntax check (basic)
  // We avoid bundlers; just ensure files can be parsed.
  // (node --check works on CommonJS; for modules we do a light heuristic by reading)
  const appDir = path.join(ROOT, "app");
  const appFiles = await readdir(appDir);
  for (const f of appFiles) {
    if (!f.endsWith(".js")) continue;
    const p = path.join(appDir, f);
    const txt = await readText(p);
    if (!txt.includes("export") && !txt.includes("import") && !txt.includes("function") && !txt.includes("const")) {
      fail(`Suspicious JS file (very short/empty?): app/${f}`);
    }
  }
  if (process.exitCode) return;
  ok("basic JS file sanity passed");

  console.log("ALL SMOKE TESTS PASSED");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

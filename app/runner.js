let pyodide = null;

const WORKDIR = "/hydrae";

/**
 * Loads Pyodide once.
 */
export async function ensurePyodide() {
  if (pyodide) return pyodide;

  const script = document.createElement("script");
  script.src = "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/pyodide.js";
  document.head.appendChild(script);

  await new Promise((resolve, reject) => {
    script.onload = resolve;
    script.onerror = () => reject(new Error("Failed to load pyodide.js"));
  });

  pyodide = await globalThis.loadPyodide({
    indexURL: "https://cdn.jsdelivr.net/pyodide/v0.26.1/full/"
  });

  // Create base workdir once (we’ll clear contents each run)
  try {
    pyodide.FS.mkdir(WORKDIR);
  } catch (_) {
    // already exists
  }

  return pyodide;
}

/**
 * RunnerRequest shape (Phase C):
 * {
 *   files: { "path/in/vfs.py": "file contents as string", ... },
 *   entrypoint: "main.py",
 *   stdin?: string,
 * }
 *
 * RunnerResult:
 * {
 *   status: { ok: boolean, exception: string|null },
 *   stdout: string,
 *   stderr: string
 * }
 */
export async function runPython({ files, entrypoint, stdin = "" }) {
  await ensurePyodide();

  try {
    clearWorkdir();
    writeFiles(files);

    const epPath = resolveEntrypoint(entrypoint);

    const wrapped = `
import sys, io, traceback, runpy

_stdout = io.StringIO()
_stderr = io.StringIO()
_stdin = io.StringIO(${pyStringLiteral(stdin)})

sys.stdout = _stdout
sys.stderr = _stderr
sys.stdin = _stdin

_status = {"ok": True, "exception": None}

try:
  runpy.run_path(${pyStringLiteral(epPath)}, run_name="__main__")
except Exception:
  _status["ok"] = False
  _status["exception"] = traceback.format_exc()

result = {
  "status": _status,
  "stdout": _stdout.getvalue(),
  "stderr": _stderr.getvalue()
}
`;

    await pyodide.runPythonAsync(wrapped);
    return pyodide.globals.get("result").toJs({ dict_converter: Object });
  } catch (e) {
    return {
      status: { ok: false, exception: String(e) },
      stdout: "",
      stderr: String(e)
    };
  }
}

/* ------------------------- helpers ------------------------- */

function resolveEntrypoint(entrypoint) {
  // entrypoint is relative to WORKDIR
  const clean = String(entrypoint || "main.py").replace(/^\/+/, "");
  return `${WORKDIR}/${clean}`;
}

function clearWorkdir() {
  // Remove everything under WORKDIR (best-effort).
  // Keeps WORKDIR itself.
  try {
    const items = pyodide.FS.readdir(WORKDIR);
    for (const name of items) {
      if (name === "." || name === "..") continue;
      rmTree(`${WORKDIR}/${name}`);
    }
  } catch (_) {
    // ignore
  }
}

function rmTree(path) {
  // Recursively delete files/dirs in Pyodide FS
  try {
    const stat = pyodide.FS.stat(path);
    const isDir = pyodide.FS.isDir(stat.mode);

    if (!isDir) {
      pyodide.FS.unlink(path);
      return;
    }

    const kids = pyodide.FS.readdir(path);
    for (const k of kids) {
      if (k === "." || k === "..") continue;
      rmTree(`${path}/${k}`);
    }
    pyodide.FS.rmdir(path);
  } catch (_) {
    // ignore
  }
}

function writeFiles(files) {
  if (!files || typeof files !== "object") return;

  for (const [relPath, content] of Object.entries(files)) {
    const cleanRel = String(relPath).replace(/^\/+/, "");
    const fullPath = `${WORKDIR}/${cleanRel}`;

    mkdirTreeForFile(fullPath);

    // Phase C: assume text files (UTF-8)
    pyodide.FS.writeFile(fullPath, String(content), { encoding: "utf8" });
  }
}

function mkdirTreeForFile(fullPath) {
  const parts = fullPath.split("/").filter(Boolean);
  // Remove filename
  parts.pop();

  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    try {
      pyodide.FS.mkdir(cur);
    } catch (_) {
      // exists
    }
  }
}

// Safely embed a JS string as a Python string literal.
function pyStringLiteral(s) {
  // JSON string is a valid Python double-quoted string literal for our use.
  return JSON.stringify(String(s));
}

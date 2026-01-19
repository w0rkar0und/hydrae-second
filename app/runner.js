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

  try {
    pyodide.FS.mkdir(WORKDIR);
  } catch (_) {
    // already exists
  }

  return pyodide;
}

/**
 * RunnerRequest (Phase C/D):
 * {
 *   files: { "path/in/vfs.py": "file contents", ... },
 *   entrypoint: "main.py" | "__grade__.py",
 *   stdin?: string
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

    // Convert Python dict to JS, then normalize to a plain object
    const raw = pyodide.globals.get("result").toJs();
    return normalizeToPlainObject(raw);
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
  const clean = String(entrypoint || "main.py").replace(/^\/+/, "");
  return `${WORKDIR}/${clean}`;
}

function clearWorkdir() {
  try {
    const items = pyodide.FS.readdir(WORKDIR);
    for (const name of items) {
      if (name === "." || name === "..") continue;
      rmTree(`${WORKDIR}/${name}`);
    }
  } catch (_) {}
}

function rmTree(path) {
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
  } catch (_) {}
}

function writeFiles(files) {
  if (!files || typeof files !== "object") return;

  for (const [relPath, content] of Object.entries(files)) {
    const cleanRel = String(relPath).replace(/^\/+/, "");
    const fullPath = `${WORKDIR}/${cleanRel}`;

    mkdirTreeForFile(fullPath);
    pyodide.FS.writeFile(fullPath, String(content), { encoding: "utf8" });
  }
}

function mkdirTreeForFile(fullPath) {
  const parts = fullPath.split("/").filter(Boolean);
  parts.pop(); // filename

  let cur = "";
  for (const p of parts) {
    cur += "/" + p;
    try {
      pyodide.FS.mkdir(cur);
    } catch (_) {}
  }
}

function pyStringLiteral(s) {
  return JSON.stringify(String(s));
}

/**
 * Pyodide may return:
 * - plain objects
 * - Maps
 * - Arrays of [key, value] pairs
 * - nested mixes of the above
 *
 * This normalizes into plain JS objects recursively.
 */
function normalizeToPlainObject(value) {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    // If it's an array of [k,v] pairs, treat it as entries
    if (value.length > 0 && Array.isArray(value[0]) && value[0].length === 2) {
      const obj = {};
      for (const [k, v] of value) {
        obj[String(k)] = normalizeToPlainObject(v);
      }
      return obj;
    }
    return value.map(normalizeToPlainObject);
  }

  // Map-like
  if (value instanceof Map) {
    const obj = {};
    for (const [k, v] of value.entries()) {
      obj[String(k)] = normalizeToPlainObject(v);
    }
    return obj;
  }

  // Plain object
  if (typeof value === "object") {
    const obj = {};
    for (const [k, v] of Object.entries(value)) {
      obj[k] = normalizeToPlainObject(v);
    }
    return obj;
  }

  return value;
}

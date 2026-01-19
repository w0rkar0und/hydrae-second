let pyodide = null;

export async function ensurePyodide() {
  if (pyodide) return pyodide;

  // Load Pyodide from CDN for Phase 0
  // Later we can pin versions and/or self-host.
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

  return pyodide;
}

export async function runPython({ code, stdin = "" }) {
  await ensurePyodide();

  const wrapped = `
import sys, io, traceback
_stdout = io.StringIO()
_stderr = io.StringIO()
sys.stdout = _stdout
sys.stderr = _stderr

_status = {"ok": True, "exception": None}
try:
${indent(code, 4)}
except Exception as e:
  _status["ok"] = False
  _status["exception"] = traceback.format_exc()

result = {
  "status": _status,
  "stdout": _stdout.getvalue(),
  "stderr": _stderr.getvalue()
}
`;

  try {
    pyodide.globals.set("___stdin", stdin);
    const out = await pyodide.runPythonAsync(wrapped);
    return pyodide.globals.get("result").toJs({ dict_converter: Object });
  } catch (e) {
    return {
      status: { ok: false, exception: String(e) },
      stdout: "",
      stderr: String(e)
    };
  }
}

function indent(text, spaces) {
  const pad = " ".repeat(spaces);
  return String(text)
    .split("\n")
    .map((line) => (line.length ? pad + line : line))
    .join("\n");
}

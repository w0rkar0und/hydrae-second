import { JSON_START, JSON_END } from "./config.js";

export async function fetchText(url) {
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

export async function fetchJson(url) {
  const txt = await fetchText(url);
  try {
    return JSON.parse(txt);
  } catch (e) {
    throw new Error(`Invalid JSON at ${String(url)}: ${e?.message || e}`);
  }
}

// Convert arrays-of-[k,v] pairs / Maps / nested mixtures into plain objects
export function normalize(value) {
  if (value === null || value === undefined) return value;

  if (Array.isArray(value)) {
    if (value.length > 0 && Array.isArray(value[0]) && value[0].length === 2) {
      const obj = {};
      for (const [k, v] of value) obj[String(k)] = normalize(v);
      return obj;
    }
    return value.map(normalize);
  }

  if (value instanceof Map) {
    const obj = {};
    for (const [k, v] of value.entries()) obj[String(k)] = normalize(v);
    return obj;
  }

  if (typeof value === "object") {
    const obj = {};
    for (const [k, v] of Object.entries(value)) obj[k] = normalize(v);
    return obj;
  }

  return value;
}

export function stripMarkedBlock(text) {
  const s = String(text || "");
  const a = s.indexOf(JSON_START);
  const b = s.indexOf(JSON_END);
  if (a === -1 || b === -1 || b <= a) return s;
  return (s.slice(0, a) + s.slice(b + JSON_END.length)).trim();
}

export function extractMarkedJson(text) {
  const s = String(text || "");
  const a = s.indexOf(JSON_START);
  const b = s.indexOf(JSON_END);
  if (a === -1 || b === -1 || b <= a) return null;

  const jsonText = s.slice(a + JSON_START.length, b).trim();
  try {
    return JSON.parse(jsonText);
  } catch (_) {
    return null;
  }
}

export function formatError(err) {
  const name = err?.name ? String(err.name) : "Error";
  const msg = err?.message ? String(err.message) : String(err);
  const stack = err?.stack ? String(err.stack) : "";
  return stack ? `${name}: ${msg}\n\n${stack}` : `${name}: ${msg}`;
}

export async function readFileAsText(file) {
  return await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ""));
    r.onerror = () => reject(r.error || new Error("Failed to read file"));
    r.readAsText(file);
  });
}

export function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

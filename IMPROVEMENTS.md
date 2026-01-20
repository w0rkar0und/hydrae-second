# Hydrae Tutor - Suggested Improvements

This document outlines recommended improvements for the Hydrae Tutor MVP, organized by priority.

---

## High Priority

### 1. Code Quality

| Issue | Location | Suggestion |
|-------|----------|------------|
| Duplicate `normalize()` function | `runner.js:171`, `grader.js:13` | Extract to shared `utils.js` |
| Duplicate `fetchText()` function | `grader.js:6`, `exercise.js:1` | Extract to shared module |
| Duplicate JSON markers | `main.js:16`, `grader.js:3` | Move constants to shared config |
| No error typing | All files | Add JSDoc or migrate to TypeScript |

### 2. User Experience

| Issue | Suggestion |
|-------|------------|
| Plain `<textarea>` editor | Add CodeMirror or Monaco for syntax highlighting, line numbers |
| No loading indicator | Add spinner/progress bar during Pyodide load (~10MB, can take seconds) |
| Markdown prompt not rendered | Use `marked.js` or similar to render `prompt.md` properly |
| No keyboard shortcuts | Add Ctrl+Enter to run, Ctrl+Shift+Enter to grade |
| No unsaved changes warning | Add `beforeunload` handler when draft differs |
| Minimal styling | Add basic CSS framework or custom styles |

### 3. Security

| Issue | Suggestion |
|-------|------------|
| No CSP | Add Content-Security-Policy headers |
| Student code can access localStorage | Document the trust model; consider Web Worker isolation |

---

## Medium Priority

### 4. Performance

| Issue | Location | Suggestion |
|-------|----------|------------|
| `cache: "no-store"` everywhere | `main.js:28`, `exercise.js:5`, `grader.js:7` | Use smarter caching; exercise content rarely changes |
| Tests re-fetched every grade | `grader.js:107` | Cache test files after first fetch |
| Pyodide loads on boot | `main.js:107` | Lazy-load Pyodide on first Run/Grade click |

### 5. Reliability

| Issue | Location | Suggestion |
|-------|----------|------------|
| Silent empty catches | `runner.js:26`, `runner.js:111`, `runner.js:130`, `runner.js:154` | Log errors or handle explicitly |
| No JavaScript tests | - | Add Jest/Vitest for unit testing modules |
| No offline support | - | Add Service Worker for true offline-first |
| localStorage quota not handled | `progress.js:46` | Handle `QuotaExceededError` |

---

## Lower Priority (Future Enhancements)

### 6. Feature Gaps

| Feature | Benefit |
|---------|---------|
| Multi-file editor UI | Show readonly/asset files, not just entrypoint |
| Hints system | Progressive hints per exercise |
| Solution reveal | After N attempts, show model solution |
| Exercise search/filter | Easier navigation as exercise count grows |
| Dark mode | User preference |
| Timed exercises | Support `limits.time_seconds` in runner config |
| Detailed test output | Show which assertions failed and why |

### 7. Developer Experience

| Improvement | Benefit |
|-------------|---------|
| Add `package.json` | Enable npm scripts, dependencies, linting |
| Add ESLint config | Catch bugs, enforce style |
| Add Prettier | Consistent formatting |
| Add CI workflow | Auto-lint/test on push |

---

## Quick Wins (Easy to Implement)

These improvements offer high value with minimal effort:

1. **Extract shared utilities** - 30 min, reduces duplication
2. **Add Ctrl+Enter shortcut** - 10 min, better UX
3. **Add beforeunload warning** - 10 min, prevents data loss
4. **Render markdown prompts** - 20 min with `marked.js`
5. **Add loading spinner** - 15 min, clearer feedback
6. **Handle localStorage quota** - 10 min, prevents silent failures

---

## Architecture Diagram (Current)

```
┌─────────────────────────────────────────────────────────┐
│                     index.html                          │
│                   (UI Shell)                            │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                     main.js                             │
│              (Orchestrator / Bootstrap)                 │
├─────────────┬───────────────┬───────────────┬───────────┤
│             │               │               │           │
▼             ▼               ▼               ▼           │
┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐        │
│exercise │ │ runner  │ │  grader  │ │ progress │        │
│   .js   │ │   .js   │ │    .js   │ │    .js   │        │
└────┬────┘ └────┬────┘ └────┬─────┘ └────┬─────┘        │
     │           │           │            │               │
     │           ▼           │            ▼               │
     │    ┌───────────┐      │     ┌────────────┐        │
     │    │  Pyodide  │◄─────┘     │localStorage│        │
     │    │  (WASM)   │            └────────────┘        │
     │    └───────────┘                                   │
     │                                                    │
     ▼                                                    │
┌─────────────────────────────────────────────────────────┤
│                   exercises/                            │
│  ├── index.json                                         │
│  ├── py.basics.001/                                     │
│  └── py.basics.002/                                     │
└─────────────────────────────────────────────────────────┘
```

---

## Recommended Architecture (With Improvements)

```
┌─────────────────────────────────────────────────────────┐
│                     index.html                          │
│                   (UI Shell + CSP)                      │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                     main.js                             │
│              (Orchestrator / Bootstrap)                 │
├─────────────┬───────────────┬───────────────┬───────────┤
│             │               │               │           │
▼             ▼               ▼               ▼           │
┌─────────┐ ┌─────────┐ ┌──────────┐ ┌──────────┐        │
│exercise │ │ runner  │ │  grader  │ │ progress │        │
│   .js   │ │   .js   │ │    .js   │ │    .js   │        │
└────┬────┘ └────┬────┘ └────┬─────┘ └────┬─────┘        │
     │           │           │            │               │
     │      ┌────┴────┐      │            │               │
     │      ▼         │      │            ▼               │
     │  ┌───────┐     │      │     ┌────────────┐        │
     │  │ utils │◄────┼──────┘     │localStorage│        │
     │  │  .js  │     │            └────────────┘        │
     │  └───────┘     │                                   │
     │                ▼                                   │
     │    ┌─────────────────┐                             │
     │    │   Web Worker    │  ◄── Isolated execution     │
     │    │  ┌───────────┐  │                             │
     │    │  │  Pyodide  │  │                             │
     │    │  │  (WASM)   │  │                             │
     │    │  └───────────┘  │                             │
     │    └─────────────────┘                             │
     │                                                    │
     ▼                                                    │
┌─────────────────────────────────────────────────────────┤
│              Service Worker (Offline Cache)             │
├─────────────────────────────────────────────────────────┤
│                   exercises/                            │
│  ├── index.json                                         │
│  ├── py.basics.001/                                     │
│  └── py.basics.002/                                     │
└─────────────────────────────────────────────────────────┘
```

---

*Generated: 2026-01-20*

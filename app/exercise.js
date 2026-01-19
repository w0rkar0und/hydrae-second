export async function loadExercise(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`Failed to load exercise: ${path} (${res.status})`);
  const exercise = await res.json();

  // Load prompt text if prompt.path exists
  if (exercise.prompt?.path) {
    const p = await fetch(new URL(exercise.prompt.path, window.location.href), { cache: "no-store" });
    if (p.ok) exercise.prompt.text = await p.text();
  }

  // Load starter file content if starter points at filenames
  // For now we expect starter to already contain inline content (phase 0),
  // but this keeps the door open.
  return exercise;
}

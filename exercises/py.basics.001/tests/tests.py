import io
import runpy
from contextlib import redirect_stdout

def run_student():
  buf = io.StringIO()
  with redirect_stdout(buf):
    runpy.run_path("/hydrae/main.py", run_name="__main__")
  return buf.getvalue()

def test_prints_something():
  out = run_student()
  assert out.strip() != "", "Expected some output, got empty output"

def test_mentions_hydrae():
  out = run_student().lower()
  assert "hydrae" in out, "Output should mention 'Hydrae'"

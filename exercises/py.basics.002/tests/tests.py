import runpy

def load_student():
  return runpy.run_path("/hydrae/main.py", run_name="__main__")

def test_add_basic():
  ns = load_student()
  assert "add" in ns, "Expected function add(a, b) to be defined"
  assert ns["add"](2, 3) == 5, "add(2, 3) should be 5"

def test_add_negative():
  ns = load_student()
  assert ns["add"](-2, 5) == 3, "add(-2, 5) should be 3"

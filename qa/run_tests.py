"""Run the complete unittest suite and save an auditable log and counts."""
import json
from pathlib import Path
import unittest


if __name__ == "__main__":
    root = Path(__file__).resolve().parents[1]
    suite = unittest.defaultTestLoader.discover(str(root / "tests"))
    with (root / "qa/test-run.txt").open("w", encoding="utf-8", newline="\n") as log:
        result = unittest.TextTestRunner(stream=log, verbosity=2).run(suite)
    summary = {
        "total": result.testsRun,
        "passed": result.testsRun - len(result.failures) - len(result.errors)
        - len(result.skipped) - len(result.expectedFailures) - len(result.unexpectedSuccesses),
        "failed": len(result.failures), "errors": len(result.errors),
        "skipped": len(result.skipped), "expectedFailure": len(result.expectedFailures),
        "unexpectedSuccess": len(result.unexpectedSuccesses),
        "failing_scenarios": [test.id() for test, _ in result.failures + result.errors],
    }
    report = json.dumps(summary, ensure_ascii=False, indent=2)
    (root / "qa/test-results.json").write_text(report + "\n", encoding="utf-8", newline="\n")
    print(report)
    raise SystemExit(0 if result.wasSuccessful() else 1)

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveTaskTimeoutMs, TASK_TIMEOUT_ENV_VAR } = require("../../electron/evaluation-wiring");

test("with neither an override nor the environment variable, the task timeout is left to the adapter", () => {
  assert.equal(resolveTaskTimeoutMs({ env: {} }), null);
  assert.equal(resolveTaskTimeoutMs({ env: { [TASK_TIMEOUT_ENV_VAR]: "" } }), null);
});

test("the environment variable is read as minutes", () => {
  assert.equal(resolveTaskTimeoutMs({ env: { [TASK_TIMEOUT_ENV_VAR]: "180" } }), 180 * 60 * 1000);
});

test("an explicit override wins over the environment", () => {
  assert.equal(
    resolveTaskTimeoutMs({ env: { [TASK_TIMEOUT_ENV_VAR]: "180" }, override: 5 * 60 * 1000 }),
    5 * 60 * 1000
  );
});

test("a timeout that is not a positive number of minutes is refused by name", () => {
  for (const raw of ["soon", "0", "-15"]) {
    assert.throws(
      () => resolveTaskTimeoutMs({ env: { [TASK_TIMEOUT_ENV_VAR]: raw } }),
      (error) => error.message.includes(TASK_TIMEOUT_ENV_VAR) && error.message.includes(raw)
    );
  }
});

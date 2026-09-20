const test = require("node:test");
const assert = require("node:assert/strict");

const { fingerprintText, fingerprintValues } = require("../../electron/evaluation-fingerprint");

const BYTE_ORDER_MARK = "﻿";
const GUIDANCE_LINE = "Prefer composition over inheritance.\n";

test("fingerprintText returns the same digest for the same text on every run", () => {
  const first = fingerprintText(GUIDANCE_LINE);
  const second = fingerprintText(GUIDANCE_LINE);

  assert.equal(first, second);
  assert.equal(
    first,
    "sha256:2a92c5b144d31eeec88c3776e13790f2beb3132e049abb5f1422c4c295816c21"
  );
});

test("fingerprintText returns a different digest for different text", () => {
  const original = fingerprintText(GUIDANCE_LINE);
  const edited = fingerprintText("Prefer composition over inheritance, usually.\n");

  assert.notEqual(original, edited);
});

test("fingerprintText treats a CRLF checkout as the same text as an LF checkout", () => {
  const unixText = "Review the diff.\nThen name the risks.\n";
  const windowsText = "Review the diff.\r\nThen name the risks.\r\n";

  assert.equal(fingerprintText(windowsText), fingerprintText(unixText));
});

test("fingerprintText ignores a leading byte order mark", () => {
  const plainText = "Review the diff.\n";

  assert.equal(fingerprintText(`${BYTE_ORDER_MARK}${plainText}`), fingerprintText(plainText));
});

test("fingerprintValues returns the same digest for the same values in the same order", () => {
  assert.equal(
    fingerprintValues(["skill:code-review", "sha256:aa01"]),
    fingerprintValues(["skill:code-review", "sha256:aa01"])
  );
});

test("fingerprintValues returns a different digest when the values are reordered", () => {
  const inOrder = fingerprintValues(["skill:code-review", "skill:testing-discipline"]);
  const reversed = fingerprintValues(["skill:testing-discipline", "skill:code-review"]);

  assert.notEqual(inOrder, reversed);
});

test("fingerprintValues returns a different digest when one value changes", () => {
  const original = fingerprintValues(["skill:code-review", "sha256:aa01"]);
  const changed = fingerprintValues(["skill:code-review", "sha256:bb02"]);

  assert.notEqual(original, changed);
});

test("fingerprintValues distinguishes values that concatenate to the same text", () => {
  const twoValues = fingerprintValues(["skill:code", "review"]);
  const oneValue = fingerprintValues(["skill:codereview"]);

  assert.notEqual(twoValues, oneValue);
});

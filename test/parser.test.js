import assert from "node:assert/strict";
import { test } from "node:test";
import { hasError, leaves } from "./support/cst.js";
import { assertIncrementalEqualsFresh, parse } from "./support/parser.js";

for (const [name, source, repair] of [
  ["assignment", "key", "=value"],
  ["header", "[a", "]"],
  ["set", "[[a", "]]"],
  ["alternation", "[{a,b", "}]"],
  ["numeric range", "[{1..2", "}]"],
  ["escape", "[a\\", "*]"],
]) {
  for (const suffix of ["", "  ", "\n", " \r\n"]) {
    test(`editorconfig: ${name} is rejected before ${JSON.stringify(suffix)} and accepts its repair`, () => {
      assert.equal(hasError(parse(source + suffix)), true);
      const repaired = source + repair + suffix;
      assert.equal(hasError(parse(repaired)), false);
      assertIncrementalEqualsFresh(
        source + suffix,
        [{ byte: Buffer.byteLength(source), deleteBytes: 0, insert: repair }],
        repaired,
      );
    });
  }
}

for (const character of ["\0", "é", "😀", "\uFFFD"]) {
  test(`editorconfig: ${JSON.stringify(character)} is content and one escaped code point`, () => {
    const source = `[\\${character}]`;
    const tree = parse(source);
    assert.equal(hasError(tree), false);
    assert.deepEqual(leaves(source, tree), [
      ["section_open", "["],
      ["escape", `\\${character}`],
      ["section_close", "]"],
    ]);
  });
}

const alternativeDepth = 300;
for (const [name, source, error] of [
  [
    "complete nested alternatives",
    `[${"{a,".repeat(alternativeDepth)}z${"}".repeat(alternativeDepth)}]`,
    false,
  ],
  [
    "incomplete nested alternatives",
    `[${"{a,".repeat(alternativeDepth)}z`,
    true,
  ],
]) {
  test(`editorconfig: ${name} finishes without a nesting limit`, () => {
    assert.equal(hasError(parse(source)), error);
  });
}

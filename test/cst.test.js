import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { root } from "../scripts/tree-sitter.js";
import nodeTypes from "../src/node-types.json" with { type: "json" };
import { hasError, leaves, parseCst } from "./support/cst.js";
import { parse } from "./support/parser.js";

function parseCorpus(text) {
  const sections = text.split("==================\n");
  assert.equal(sections.shift(), "", "corpus must begin with a header");
  assert.equal(sections.length % 2, 0, "corpus headers must be paired");
  const cases = [];
  for (let index = 0; index < sections.length; index += 2) {
    const [name, ...attributes] = sections[index].trimEnd().split("\n");
    assert.ok(name, "corpus case must have a name");
    for (const attribute of attributes) {
      assert.ok(
        attribute === ":cst" || attribute === ":error",
        `unsupported corpus attribute: ${attribute}`,
      );
    }
    const parts = sections[index + 1].split("\n---\n");
    assert.equal(parts.length, 2, `${name}: expected one output separator`);
    const source = parts[0].endsWith("\r") ? parts[0].slice(0, -1) : parts[0];
    cases.push({ name, source, error: attributes.includes(":error") });
  }
  return cases;
}

const corpusDirectory = join(root, "test/corpus");
for (const file of readdirSync(corpusDirectory).sort()) {
  assert.ok(file.endsWith(".txt"), `unexpected corpus entry: ${file}`);
  const entries = parseCorpus(
    readFileSync(join(corpusDirectory, file), "utf8"),
  );
  for (const { name, source, error } of entries) {
    test(`editorconfig: corpus acceptance and fresh determinism: ${file}: ${name}`, () => {
      const tree = parse(source);
      assert.equal(hasError(tree), error);
      assert.deepEqual(parse(source), tree);
    });
  }
}

test("editorconfig: corpus inputs retain BOM NUL whitespace and line endings", () => {
  const text = [
    "==================\nEmpty\n==================\n\n---\n(document)\n\n",
    "==================\nLayout\n:cst\n==================\n",
    "\uFEFF \t\v\f\r\na=b\n\n\n---\nignored output\n\n",
    "==================\nNUL\n:cst\n==================\n",
    "\0=\0\n---\nignored output\n\n",
    "==================\nFinal CR\n:cst\n==================\n",
    "a=b\r\r\n---\nignored output\n",
  ].join("");
  assert.deepEqual(parseCorpus(text), [
    { name: "Empty", source: "", error: false },
    { name: "Layout", source: "\uFEFF \t\v\f\r\na=b\n\n", error: false },
    { name: "NUL", source: "\0=\0", error: false },
    { name: "Final CR", source: "a=b\r", error: false },
  ]);
});

test("editorconfig: corpus input reader rejects unsupported conditions and framing", () => {
  for (const text of [
    "not a corpus file",
    "==================\nUnclosed header\n",
    "==================\nSkipped\n:skip\n==================\na=b\n---\n",
    "==================\nNo separator\n==================\na=b\n",
  ]) {
    assert.throws(() => parseCorpus(text), { code: "ERR_ASSERTION" }, text);
  }
});

test("editorconfig: public metadata has required delimiters and no diagnostic nodes", () => {
  for (const node of nodeTypes) {
    assert.doesNotMatch(node.type, /issue|invalid_|incomplete_|missing_/);
    assert.equal(Object.hasOwn(node.fields ?? {}, "issue"), false);
  }
  for (const [kind, field] of [
    ["pair", "operator"],
    ["section_header", "opening"],
    ["section_header", "closing"],
    ["character_set", "closing"],
    ["alternation", "closing"],
    ["numeric_range", "closing"],
  ]) {
    const node = nodeTypes.find(({ type }) => type === kind);
    assert.equal(node?.fields?.[field]?.required, true, `${kind}.${field}`);
  }
});

for (const [name, prefix, suffix] of [
  ["key", "k", "ey=v"],
  ["value", "k=v", "alue"],
  ["comment", "# a", "b"],
  ["glob", "[a", "b]"],
  ["set", "[[a", "b]]"],
  ["literal brace", "[{a", "b}]"],
  ["escape", "[\\", "*]"],
  ["numeric range", "[{1..2", "}]"],
]) {
  for (const [encoding, bytes] of [
    ["invalid run", [255, 254, 128]],
    ["surrogate", [0xed, 0xa0, 0x80]],
    ["missing continuation", [0xc3]],
  ]) {
    test(`editorconfig: ${encoding} in ${name} requires standard recovery`, () => {
      const source = Buffer.concat([
        Buffer.from(prefix),
        Buffer.from(bytes),
        Buffer.from(suffix),
      ]);
      const tree = parse(source);
      assert.equal(hasError(tree), true);
      assert.deepEqual(parse(source), tree);
    });
  }
}

test("editorconfig: an unfinished UTF-8 sequence at EOF requires standard recovery", () => {
  const source = Buffer.concat([Buffer.from("key="), Buffer.from([0xc3])]);
  const tree = parse(source);
  assert.equal(hasError(tree), true);
  assert.deepEqual(parse(source), tree);
});

test("editorconfig: CST helpers preserve fields, hierarchy and UTF-8 ranges across CRLF", () => {
  const source = "日=値\r\nx=";
  const text = [
    "0:0 - 1:2 document",
    "0:0 - 1:0   pair",
    "0:0 - 0:3     key: key_text `日`",
    "0:3 - 0:4     assignment_operator `=`",
    "0:4 - 0:7     value: value_text `値`",
    "0:7 - 1:0     line_ending",
    "1:0 - 1:2   pair",
    "1:0 - 1:1     key: key_text `x`",
    "1:1 - 1:2     assignment_operator `=`",
  ].join("\n");
  const nodes = parseCst(text, source);
  assert.deepEqual(nodes, [
    { kind: "document", field: null, start: 0, end: 11, parent: null },
    { kind: "pair", field: null, start: 0, end: 9, parent: 0 },
    { kind: "key_text", field: "key", start: 0, end: 3, parent: 1 },
    { kind: "assignment_operator", field: null, start: 3, end: 4, parent: 1 },
    { kind: "value_text", field: "value", start: 4, end: 7, parent: 1 },
    { kind: "line_ending", field: null, start: 7, end: 9, parent: 1 },
    { kind: "pair", field: null, start: 9, end: 11, parent: 0 },
    { kind: "key_text", field: "key", start: 9, end: 10, parent: 6 },
    { kind: "assignment_operator", field: null, start: 10, end: 11, parent: 6 },
  ]);
  assert.deepEqual(leaves(source, nodes), [
    ["key_text", "日"],
    ["assignment_operator", "="],
    ["value_text", "値"],
    ["line_ending", "\r\n"],
    ["key_text", "x"],
    ["assignment_operator", "="],
  ]);
});

test("editorconfig: CST helpers retain standard recovery and reject truncated roots", () => {
  assert.throws(() => parseCst("0:0 - 0:2 document", "a=b"), {
    code: "ERR_ASSERTION",
  });
  for (const artifact of ["•ERROR", "MISSING assignment_operator"]) {
    const nodes = parseCst(
      `0:0 - 0:3 •document\n0:3 - 0:3   ${artifact}`,
      "a=b",
    );
    assert.equal(hasError(nodes), true);
  }
});

const largeInputCounts = {
  pairs: 5_000,
  valueCharacters: 100_000,
};
for (const [name, source] of [
  ["many pairs", `[*]\n${"key=value\n".repeat(largeInputCounts.pairs)}`],
  [
    "one long value",
    `[*]\nkey=${"x".repeat(largeInputCounts.valueCharacters)}`,
  ],
]) {
  test(`editorconfig: large input: ${name}`, () => {
    assert.equal(hasError(parse(source)), false);
  });
}

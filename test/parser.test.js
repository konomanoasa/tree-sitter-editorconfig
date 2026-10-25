import assert from "node:assert/strict";
import { test } from "node:test";
import { issues, leaves, owners } from "./support/cst.js";
import { parse } from "./support/parser.js";

const incompleteCases = [
  {
    name: "assignment",
    source: "key",
    reasons: [
      { reason: "missing_assignment_operator", byte: 3, owner: "pair" },
    ],
  },
  {
    name: "header",
    source: "[a",
    reasons: [
      { reason: "missing_section_close", byte: 2, owner: "section_header" },
    ],
  },
  {
    name: "literal brace backslash and header",
    source: "[{a\\",
    reasons: [
      { reason: "missing_section_close", byte: 4, owner: "section_header" },
    ],
  },
  {
    name: "set and header",
    source: "[[a",
    reasons: [
      { reason: "missing_set_close", byte: 3, owner: "character_set" },
      { reason: "missing_section_close", byte: 3, owner: "section_header" },
    ],
  },
  {
    name: "alternation and header",
    source: "[{a,b",
    reasons: [
      { reason: "missing_brace_close", byte: 5, owner: "alternation" },
      { reason: "missing_section_close", byte: 5, owner: "section_header" },
    ],
  },
  {
    name: "range and header",
    source: "[{1..2",
    reasons: [
      { reason: "missing_brace_close", byte: 6, owner: "numeric_range" },
      { reason: "missing_section_close", byte: 6, owner: "section_header" },
    ],
  },
  {
    name: "escape and header",
    source: "[a\\",
    reasons: [
      { reason: "incomplete_escape", byte: 2, owner: "pattern", end: 3 },
      { reason: "missing_section_close", byte: 3, owner: "section_header" },
    ],
  },
];
for (const { name, source, reasons } of incompleteCases) {
  for (const [suffix, outcome] of [
    ["", "incomplete_syntax"],
    ["  ", "incomplete_syntax"],
    ["\n", "invalid_syntax"],
    [" \r\n", "invalid_syntax"],
  ]) {
    test(`editorconfig: ${name} missing before ${JSON.stringify(suffix)}`, () => {
      const tree = parse(source + suffix);
      assert.deepEqual(
        issues(tree),
        reasons.map(({ reason, byte, end = byte }) => [
          outcome,
          reason,
          byte,
          end,
        ]),
      );
      if (name === "escape and header")
        assert.ok(!tree.some(({ kind }) => kind === "escape"));
      assert.deepEqual(
        owners(tree),
        reasons.map(({ owner }) => owner),
      );
    });
  }
}

for (const { name, prefix, suffix, expectedLeaves } of [
  {
    name: "escape",
    prefix: "[\\",
    suffix: "a]",
    expectedLeaves: [
      ["section_open", "["],
      ["invalid_encoding", "\uFFFD\uFFFD\uFFFD"],
      ["glob_literal", "a"],
      ["section_close", "]"],
    ],
  },
  {
    name: "literal brace backslash",
    prefix: "[{a\\",
    suffix: "}]",
    expectedLeaves: [
      ["section_open", "["],
      ["glob_literal", "{a\\"],
      ["invalid_encoding", "\uFFFD\uFFFD\uFFFD"],
      ["glob_literal", "}"],
      ["section_close", "]"],
    ],
  },
]) {
  test(`editorconfig: an invalid UTF-8 run inside ${name} has an isolated range`, () => {
    const source = Buffer.concat([
      Buffer.from(prefix),
      Buffer.from([255, 254, 128]),
      Buffer.from(suffix),
    ]);
    const tree = parse(source);
    assert.deepEqual(issues(tree), [
      ["invalid_syntax", "invalid_encoding", prefix.length, prefix.length + 3],
    ]);
    assert.deepEqual(owners(tree), ["pattern"]);
    assert.deepEqual(leaves(source, tree), expectedLeaves);
  });
}

test("editorconfig: internal whitespace after undecodable bytes stays in the value", () => {
  const source = Buffer.concat([
    Buffer.from("k= "),
    Buffer.from([255]),
    Buffer.from(" v "),
    Buffer.from([255]),
    Buffer.from(" "),
  ]);
  const tree = parse(source);
  assert.deepEqual(issues(tree), [
    ["invalid_syntax", "invalid_encoding", 3, 4],
    ["invalid_syntax", "invalid_encoding", 7, 8],
  ]);
  assert.deepEqual(leaves(source, tree), [
    ["key_text", "k"],
    ["assignment_operator", "="],
    ["invalid_encoding", "\uFFFD"],
    ["value_text", " v "],
    ["invalid_encoding", "\uFFFD"],
  ]);
});

for (const { name, suffix, expected, expectedOwners, tail } of [
  {
    name: "at EOF",
    suffix: "",
    expected: [
      ["invalid_syntax", "invalid_encoding", 6, 7],
      ["incomplete_syntax", "missing_brace_close", 7, 7],
      ["incomplete_syntax", "missing_section_close", 7, 7],
    ],
    expectedOwners: ["numeric_range", "numeric_range", "section_header"],
    tail: [],
  },
  {
    name: "before source that cannot continue it",
    suffix: "3}]",
    expected: [
      ["invalid_syntax", "invalid_encoding", 6, 7],
      ["invalid_syntax", "missing_brace_close", 7, 7],
    ],
    expectedOwners: ["numeric_range", "numeric_range"],
    tail: [
      ["glob_literal", "3}"],
      ["section_close", "]"],
    ],
  },
]) {
  test(`editorconfig: a numeric range cut by undecodable source lacks its closing ${name}`, () => {
    const source = Buffer.concat([
      Buffer.from("[{1..2"),
      Buffer.from([255]),
      Buffer.from(suffix),
    ]);
    const tree = parse(source);
    assert.deepEqual(issues(tree), expected);
    assert.deepEqual(owners(tree), expectedOwners);
    if (tail.length)
      assert.deepEqual(leaves(source, tree).slice(-tail.length), tail);
  });
}

test("editorconfig: source after a cut numeric range resumes the enclosing alternative", () => {
  const source = Buffer.concat([
    Buffer.from("[{x,{1..2"),
    Buffer.from([255]),
    Buffer.from(",y}}]"),
  ]);
  const tree = parse(source);
  assert.deepEqual(issues(tree), [
    ["invalid_syntax", "invalid_encoding", 9, 10],
    ["invalid_syntax", "missing_brace_close", 10, 10],
  ]);
  assert.deepEqual(owners(tree), ["numeric_range", "numeric_range"]);
  assert.deepEqual(leaves(source, tree).slice(-5), [
    ["alternative_separator", ","],
    ["glob_literal", "y"],
    ["brace_close", "}"],
    ["glob_literal", "}"],
    ["section_close", "]"],
  ]);
  const closing = tree.find(
    ({ kind, start }) => kind === "brace_close" && start === 12,
  );
  assert.ok(closing);
  assert.equal(tree[closing.parent].kind, "alternation");
});

const alternativeDepth = 300;
for (const { name, source, expectedReasons } of [
  {
    name: "complete nested alternatives",
    source: `[${"{a,".repeat(alternativeDepth)}z${"}".repeat(alternativeDepth)}]`,
    expectedReasons: [],
  },
  {
    name: "incomplete nested alternatives",
    source: `[${"{a,".repeat(alternativeDepth)}z`,
    expectedReasons: [
      ...Array(alternativeDepth).fill("missing_brace_close"),
      "missing_section_close",
    ],
  },
]) {
  test(`editorconfig: large input: ${name}`, () => {
    const found = issues(parse(source));
    assert.deepEqual(
      found.map(([outcome, reason]) => [outcome, reason]),
      expectedReasons.map((reason) => ["incomplete_syntax", reason]),
    );
  });
}

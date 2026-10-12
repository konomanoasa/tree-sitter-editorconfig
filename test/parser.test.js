import assert from "node:assert/strict";
import { test } from "node:test";
import { issues, leaves, owners } from "./support/cst.js";
import { assertEditHistory, parse } from "./support/parser.js";

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

test("editorconfig: a truncated UTF-8 sequence at EOF is invalid", () => {
  const source = Buffer.concat([Buffer.from("a="), Buffer.from([0xc3])]);
  const tree = parse(source);
  assert.deepEqual(issues(tree), [
    ["invalid_syntax", "invalid_encoding", 2, 3],
  ]);
  assert.deepEqual(owners(tree), ["value"]);
});

for (const { name, prefix, suffix, owner, expectedLeaves } of [
  { name: "key", prefix: "k", suffix: "ey=v", owner: "key" },
  { name: "value", prefix: "k=v", suffix: "alue", owner: "value" },
  { name: "comment", prefix: "# a", suffix: "b", owner: "comment" },
  { name: "glob", prefix: "[a", suffix: "b]", owner: "pattern" },
  { name: "set", prefix: "[[a", suffix: "b]]", owner: "character_set" },
  { name: "literal brace", prefix: "[{a", suffix: "b}]", owner: "pattern" },
  {
    name: "numeric range",
    prefix: "[{1..2",
    suffix: "}]",
    owner: "numeric_range",
  },
  {
    name: "escape",
    prefix: "[\\",
    suffix: "a]",
    owner: "pattern",
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
    owner: "pattern",
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
    assert.deepEqual(owners(tree), [owner]);
    if (expectedLeaves) assert.deepEqual(leaves(source, tree), expectedLeaves);
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

test("editorconfig: large documents, long values and nested glob alternatives complete", () => {
  const pairCount = 5_000;
  const valueLength = 100_000;
  const alternativeDepth = 300;
  for (const source of [
    `[*]\n${"key=value\n".repeat(pairCount)}`,
    `[*]\nkey=${"x".repeat(valueLength)}`,
    `[${"{a,".repeat(alternativeDepth)}z${"}".repeat(alternativeDepth)}]`,
    `[${"{a,".repeat(alternativeDepth)}z`,
  ])
    assert.equal(
      issues(parse(source)).some(([outcome]) => outcome === "invalid_syntax"),
      false,
    );
});

const editCases = [
  {
    name: "complete and reopen a final CR",
    source: "a=b\r",
    edits: [
      { byte: 4, deleteBytes: 0, insert: "\n" },
      { byte: 4, deleteBytes: 1, insert: "" },
    ],
  },
  {
    name: "make a final CR invalid by starting another line",
    source: "a=b\r",
    edits: [{ byte: 4, deleteBytes: 0, insert: "c=d" }],
  },
  {
    name: "split and merge a decoding failure inside a numeric range",
    source: Buffer.from([91, 123, 49, 46, 46, 50, 255, 254, 128, 125, 93]),
    edits: [
      { byte: 7, deleteBytes: 0, insert: "é" },
      { byte: 7, deleteBytes: 2, insert: "" },
    ],
  },
  {
    name: "repair a decoding failure after a backslash",
    source: Buffer.from([91, 92, 255, 254, 128, 93]),
    edits: [{ byte: 2, deleteBytes: 3, insert: "*" }],
  },
  {
    name: "complete an escape at EOF",
    source: "[a\\",
    edits: [{ byte: 3, deleteBytes: 0, insert: "*]" }],
  },
  {
    name: "remove the escaped character",
    source: "[a\\*]",
    edits: [{ byte: 3, deleteBytes: 1, insert: "" }],
  },
  {
    name: "close a header after an incomplete escape",
    source: "[a\\",
    edits: [{ byte: 3, deleteBytes: 0, insert: "]" }],
  },
  {
    name: "end a line after an incomplete escape",
    source: "[a\\",
    edits: [{ byte: 3, deleteBytes: 0, insert: "\n" }],
  },
  {
    name: "split an escaped UTF-8 character",
    source: "[\\é]",
    edits: [{ byte: 3, deleteBytes: 1, insert: "" }],
  },
  {
    name: "repair an undecodable escaped character",
    source: Buffer.from([91, 92, 255, 93]),
    edits: [{ byte: 2, deleteBytes: 1, insert: "*" }],
  },
  {
    name: "value replacement",
    source: "a=b\n",
    edits: [{ byte: 2, deleteBytes: 1, insert: "c" }],
  },
  {
    name: "complete a missing assignment",
    source: "key",
    edits: [{ byte: 3, deleteBytes: 0, insert: "=value" }],
  },
  {
    name: "remove an assignment",
    source: "key=value",
    edits: [{ byte: 3, deleteBytes: 1, insert: "" }],
  },
  {
    name: "turn a pair into a header",
    source: "[a=b",
    edits: [{ byte: 4, deleteBytes: 0, insert: "]" }],
  },
  {
    name: "turn a header into a pair",
    source: "[a=b]",
    edits: [{ byte: 4, deleteBytes: 1, insert: "" }],
  },
  {
    name: "close a set and header",
    source: "[[a",
    edits: [{ byte: 3, deleteBytes: 0, insert: "]]" }],
  },
  {
    name: "remove inner set close",
    source: "[[a]]",
    edits: [{ byte: 3, deleteBytes: 1, insert: "" }],
  },
  {
    name: "change the final bracket ownership",
    source: "[a]",
    edits: [{ byte: 2, deleteBytes: 0, insert: "]x" }],
  },
  {
    name: "end an incomplete line",
    source: "[a",
    edits: [{ byte: 2, deleteBytes: 0, insert: "\n" }],
  },
  {
    name: "reopen an incomplete line",
    source: "[a\n",
    edits: [{ byte: 2, deleteBytes: 1, insert: "" }],
  },
  {
    name: "change literal braces into alternatives",
    source: "[{a}]",
    edits: [{ byte: 3, deleteBytes: 0, insert: ",b" }],
  },
  {
    name: "change alternatives into literal braces",
    source: "[{a,b}]",
    edits: [{ byte: 3, deleteBytes: 2, insert: "" }],
  },
  {
    name: "nested alternative edit",
    source: "[{a,{b,c}}]",
    edits: [{ byte: 7, deleteBytes: 1, insert: "" }],
  },
  {
    name: "reclassify nested braces without changing line length",
    source: "[{{a,b},}]\n[{{a,b},}]\n",
    edits: [
      { byte: 4, deleteBytes: 1, insert: "x" },
      { byte: 15, deleteBytes: 1, insert: "x" },
      { byte: 4, deleteBytes: 1, insert: "," },
      { byte: 15, deleteBytes: 1, insert: "," },
    ],
  },
  {
    name: "repair and reopen a nested brace classification cut by decoding failure",
    source: Buffer.concat([
      Buffer.from("[{{a"),
      Buffer.from([255]),
      Buffer.from("b},}]"),
    ]),
    edits: [
      { byte: 4, deleteBytes: 1, insert: "," },
      { byte: 4, deleteBytes: 1, insert: "é" },
      { byte: 5, deleteBytes: 1, insert: "" },
    ],
  },
  {
    name: "numeric bounds edit",
    source: "[{1..2}]",
    edits: [{ byte: 2, deleteBytes: 1, insert: "word" }],
  },
  {
    name: "padding affects header name only after completion",
    source: "[a  ",
    edits: [{ byte: 4, deleteBytes: 0, insert: "]" }],
  },
  {
    name: "split a character after a numeric range",
    source: "[{1..2é}]",
    edits: [{ byte: 7, deleteBytes: 1, insert: "" }],
  },
  {
    name: "split the character that ends a numeric range cut by undecodable source",
    source: Buffer.concat([
      Buffer.from("[{1..2"),
      Buffer.from([255]),
      Buffer.from("é}]"),
    ]),
    edits: [{ byte: 8, deleteBytes: 1, insert: "" }],
  },
];

for (const entry of editCases) {
  test(`editorconfig: ${entry.name}`, () => {
    assertEditHistory(entry);
  });
}

import assert from "node:assert/strict";
import { test } from "node:test";
import nodeTypes from "../src/node-types.json" with { type: "json" };
import { issues, leaves, owners, parse } from "./support/parser.js";

test("editorconfig: public issue nodes have one outcome and one reason leaf", () => {
  const issue = nodeTypes.find(({ type }) => type === "syntax_issue");
  assert.ok(issue);
  assert.ok(issue.children);
  assert.equal(issue.children.required, true);
  assert.equal(issue.children.multiple, false);
  assert.deepEqual(
    issue.children.types.map(({ type }) => type),
    ["incomplete_syntax", "invalid_syntax"],
  );
  for (const { type } of issue.children.types) {
    const outcome = nodeTypes.find((node) => node.type === type);
    assert.ok(outcome, type);
    assert.ok(outcome.children, type);
    assert.equal(outcome.children.required, true);
    assert.equal(outcome.children.multiple, false);
    for (const child of outcome.children.types) {
      const reason = nodeTypes.find((node) => node.type === child.type);
      assert.ok(reason, child.type);
      assert.equal(reason.children, undefined);
    }
  }
});

const validCases = [
  ["empty document", "", []],
  ["whitespace-only final line", " \t\v\f", [["blank_line", " \t\v\f"]]],
  [
    "empty value and empty key",
    "=\n",
    [
      ["assignment_operator", "="],
      ["line_ending", "\n"],
    ],
  ],
  [
    "key and value trim only their edges",
    "  a b \t=\t c  d \t\r\n",
    [
      ["key_text", "a b"],
      ["assignment_operator", "="],
      ["value_text", "c  d"],
      ["line_ending", "\r\n"],
    ],
  ],
  [
    "inline comment markers and equals belong to the value",
    "a = b=c # ;",
    [
      ["key_text", "a"],
      ["assignment_operator", "="],
      ["value_text", "b=c # ;"],
    ],
  ],
  [
    "quotes and backslashes are literal in pairs",
    '"key"=\\value',
    [
      ["key_text", '"key"'],
      ["assignment_operator", "="],
      ["value_text", "\\value"],
    ],
  ],
  [
    "comment classification precedes pair and header",
    " ; [a]=b \n",
    [
      ["comment_marker", ";"],
      ["comment_text", " [a]=b"],
      ["line_ending", "\n"],
    ],
  ],
  [
    "complete header classification precedes pair",
    "[a=b]",
    [
      ["section_open", "["],
      ["glob_literal", "a=b"],
      ["section_close", "]"],
    ],
  ],
  [
    "bracket key when no final header bracket exists",
    "[a=b",
    [
      ["key_text", "[a"],
      ["assignment_operator", "="],
      ["value_text", "b"],
    ],
  ],
  [
    "empty section name is retained without a synthetic pattern",
    "[]",
    [
      ["section_open", "["],
      ["section_close", "]"],
    ],
  ],
  [
    "section name whitespace is significant",
    "[ a ]",
    [
      ["section_open", "["],
      ["glob_literal", " a "],
      ["section_close", "]"],
    ],
  ],
  [
    "literal glob punctuation outside constructs",
    "[a],}]",
    [
      ["section_open", "["],
      ["glob_literal", "a],}"],
      ["section_close", "]"],
    ],
  ],
  [
    "glob atoms",
    "[**/*?\\*.c]",
    [
      ["section_open", "["],
      ["recursive_wildcard", "**"],
      ["path_separator", "/"],
      ["wildcard", "*"],
      ["single_character", "?"],
      ["escape", "\\*"],
      ["glob_literal", ".c"],
      ["section_close", "]"],
    ],
  ],
  [
    "set contents are literal",
    "[[!a-z*{1..2}\\/]]",
    [
      ["section_open", "["],
      ["set_open", "["],
      ["set_negation", "!"],
      ["set_text", "a-z*{1..2}\\/"],
      ["set_close", "]"],
      ["section_close", "]"],
    ],
  ],
  [
    "literal brace forms join the surrounding literal",
    "[a{b*c}d{e..f}{+1..2}{g\\*}]",
    [
      ["section_open", "["],
      ["glob_literal", "a{b*c}d{e..f}{+1..2}{g\\*}"],
      ["section_close", "]"],
    ],
  ],
  [
    "backslash at the end of a literal brace stays literal",
    "[{a\\]",
    [
      ["section_open", "["],
      ["glob_literal", "{a\\"],
      ["section_close", "]"],
    ],
  ],
  [
    "descending negative bounds remain syntax",
    "[{-1..-5}]",
    [
      ["section_open", "["],
      ["brace_open", "{"],
      ["integer", "-1"],
      ["range_separator", ".."],
      ["integer", "-5"],
      ["brace_close", "}"],
      ["section_close", "]"],
    ],
  ],
  [
    "empty alternatives",
    "[{,}]",
    [
      ["section_open", "["],
      ["brace_open", "{"],
      ["alternative_separator", ","],
      ["brace_close", "}"],
      ["section_close", "]"],
    ],
  ],
  [
    "NUL remains a character rather than EOF",
    "\0=\0",
    [
      ["key_text", "\0"],
      ["assignment_operator", "="],
      ["value_text", "\0"],
    ],
  ],
  [
    "Unicode source retains byte ranges",
    "日本=値",
    [
      ["key_text", "日本"],
      ["assignment_operator", "="],
      ["value_text", "値"],
    ],
  ],
];
for (const [name, source, expected] of validCases) {
  test(`editorconfig: ${name}`, () => {
    const tree = parse(source);
    assert.deepEqual(issues(tree), []);
    assert.deepEqual(
      leaves(source, tree),
      expected.length ? expected : [["document", ""]],
    );
  });
}

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
for (const [name, source, expected, owner] of [
  [
    "set closing",
    "[[a]",
    [["invalid_syntax", "missing_set_close", 3, 3]],
    "character_set",
  ],
  [
    "brace closing",
    "[{a,b]",
    [["invalid_syntax", "missing_brace_close", 5, 5]],
    "alternation",
  ],
  [
    "range closing",
    "[{1..2]",
    [["invalid_syntax", "missing_brace_close", 6, 6]],
    "numeric_range",
  ],
  [
    "escape character",
    "[a\\]",
    [["invalid_syntax", "incomplete_escape", 2, 3]],
    "pattern",
  ],
  [
    "standalone CR",
    "a=b\rc=d",
    [["invalid_syntax", "invalid_line_ending", 3, 4]],
    "pair",
  ],
])
  test(`editorconfig: ${name} at a closed boundary`, () => {
    const tree = parse(source);
    assert.deepEqual(issues(tree), expected);
    assert.deepEqual(owners(tree), [owner]);
    if (name === "escape character")
      assert.ok(!tree.some(({ kind }) => kind === "escape"));
  });

test("editorconfig: a leading byte order mark precedes the document", () => {
  const source = "\uFEFFa=b";
  const tree = parse(source);
  assert.equal(tree[0].start, 3);
  assert.deepEqual(leaves(source, tree), [
    ["key_text", "a"],
    ["assignment_operator", "="],
    ["value_text", "b"],
  ]);
});

for (const [name, source, expected] of [
  ["a repeated initial BOM", "\uFEFF\uFEFFa=b", ["key_text", "\uFEFFa"]],
  ["a subsequent line", "a=b\n\uFEFFc=d", ["key_text", "\uFEFFc"]],
  ["a value", "a=\uFEFFb", ["value_text", "\uFEFFb"]],
  ["a comment", "# \uFEFFb", ["comment_text", " \uFEFFb"]],
  ["a glob literal", "[a\uFEFFb]", ["glob_literal", "a\uFEFFb"]],
  ["a set", "[[\uFEFF]]", ["set_text", "\uFEFF"]],
  ["an escape", "[\\\uFEFF]", ["escape", "\\\uFEFF"]],
]) {
  test(`editorconfig: noninitial U+FEFF in ${name} remains in its source leaf`, () => {
    const tree = parse(source);
    assert.deepEqual(issues(tree), []);
    assert.deepEqual(
      leaves(source, tree).filter(([, text]) => text.includes("\uFEFF")),
      [expected],
    );
  });
}

for (const [name, source, expected, owner] of [
  [
    "standalone CR",
    "a=b\r",
    [["incomplete_syntax", "invalid_line_ending", 3, 4]],
    "pair",
  ],
  [
    "truncated UTF-8 sequence",
    Buffer.concat([Buffer.from("a="), Buffer.from([0xc3])]),
    [["invalid_syntax", "invalid_encoding", 2, 3]],
    "value",
  ],
]) {
  test(`editorconfig: ${name} at EOF is classified by whether appending repairs it`, () => {
    const tree = parse(source);
    assert.deepEqual(issues(tree), expected);
    assert.deepEqual(owners(tree), [owner]);
  });
}

for (const [source, owner] of [
  ["\r", "blank_line"],
  ["# a\r", "comment"],
  ["[a]\r", "section_header"],
]) {
  test(`editorconfig: a final CR belongs to its ${owner}`, () => {
    const tree = parse(source);
    assert.deepEqual(issues(tree), [
      [
        "incomplete_syntax",
        "invalid_line_ending",
        source.length - 1,
        source.length,
      ],
    ]);
    assert.deepEqual(owners(tree), [owner]);
  });
}

test("editorconfig: a final CR does not make missing delimiters before it repairable by appending", () => {
  const tree = parse("[[a\r");
  assert.deepEqual(issues(tree), [
    ["invalid_syntax", "missing_set_close", 3, 3],
    ["invalid_syntax", "missing_section_close", 3, 3],
    ["incomplete_syntax", "invalid_line_ending", 3, 4],
  ]);
  assert.deepEqual(owners(tree), [
    "character_set",
    "section_header",
    "section_header",
  ]);
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

test("editorconfig: only issues carry the issue field after an undecodable escape", () => {
  const source = Buffer.concat([
    Buffer.from("[\\"),
    Buffer.from([0xc3]),
    Buffer.from("\\!2[]}"),
  ]);
  assert.deepEqual(
    parse(source)
      .filter(({ field }) => field === "issue")
      .map(({ kind }) => kind),
    ["syntax_issue", "syntax_issue"],
  );
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

test("editorconfig: section ownership and nested alternatives preserve source order", () => {
  const source = "root=true\n[a]\nx=y\n[{a,{b,c}}]\nz=w\n";
  const tree = parse(source);
  assert.deepEqual(issues(tree), []);
  assert.deepEqual(
    tree
      .filter(({ parent }) => parent === 0)
      .map(({ kind, start, end }) => [kind, start, end]),
    [
      ["preamble", 0, 10],
      ["section", 10, 18],
      ["section", 18, 34],
    ],
  );
  assert.equal(tree.filter(({ kind }) => kind === "alternation").length, 2);
  assert.deepEqual(
    tree.filter(({ field }) => field === "header").map(({ kind }) => kind),
    ["section_header", "section_header"],
  );
});

test("editorconfig: unknown properties and values do not introduce syntax issues", () => {
  assert.deepEqual(
    issues(
      parse("unknown_key = unknown_value\n[*]\nroot=maybe\nindent_size=-1\n"),
    ),
    [],
  );
});

test("editorconfig: normal neighbors survive malformed lines", () => {
  const source = "[a]\nx=y\nbroken\n[b]\nz=w\n";
  const tree = parse(source);
  assert.deepEqual(issues(tree), [
    ["invalid_syntax", "missing_assignment_operator", 14, 14],
  ]);
  assert.deepEqual(
    tree
      .filter(({ kind }) => kind === "value_text")
      .map(({ start, end }) => source.slice(start, end)),
    ["y", "w"],
  );
});

test("editorconfig: large documents, long values and nested glob alternatives complete", () => {
  for (const source of [
    `[*]\n${"key=value\n".repeat(5000)}`,
    `[*]\nkey=${"x".repeat(100000)}`,
    `[${"{a,".repeat(300)}z${"}".repeat(300)}]`,
    `[${"{a,".repeat(300)}z`,
  ])
    assert.equal(
      issues(parse(source)).some(([outcome]) => outcome === "invalid_syntax"),
      false,
    );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, issues, parse } from "./support/parser.js";

const cases = [
  ["complete an escape at EOF", "[a\\", [{ byte: 3, remove: 0, insert: "*]" }]],
  [
    "remove the escaped character",
    "[a\\*]",
    [{ byte: 3, remove: 1, insert: "" }],
  ],
  [
    "close a header after an incomplete escape",
    "[a\\",
    [{ byte: 3, remove: 0, insert: "]" }],
  ],
  [
    "end a line after an incomplete escape",
    "[a\\",
    [{ byte: 3, remove: 0, insert: "\n" }],
  ],
  [
    "split an escaped UTF-8 character",
    "[\\é]",
    [{ byte: 3, remove: 1, insert: "" }],
  ],
  [
    "repair an undecodable escaped character",
    Buffer.from([91, 92, 255, 93]),
    [{ byte: 2, remove: 1, insert: "*" }],
  ],
  ["value replacement", "a=b\n", [{ byte: 2, remove: 1, insert: "c" }]],
  [
    "complete a missing assignment",
    "key",
    [{ byte: 3, remove: 0, insert: "=value" }],
  ],
  ["remove an assignment", "key=value", [{ byte: 3, remove: 1, insert: "" }]],
  ["turn a pair into a header", "[a=b", [{ byte: 4, remove: 0, insert: "]" }]],
  ["turn a header into a pair", "[a=b]", [{ byte: 4, remove: 1, insert: "" }]],
  ["close a set and header", "[[a", [{ byte: 3, remove: 0, insert: "]]" }]],
  ["remove inner set close", "[[a]]", [{ byte: 3, remove: 1, insert: "" }]],
  [
    "change the final bracket ownership",
    "[a]",
    [{ byte: 2, remove: 0, insert: "]x" }],
  ],
  ["end an incomplete line", "[a", [{ byte: 2, remove: 0, insert: "\n" }]],
  ["reopen an incomplete line", "[a\n", [{ byte: 2, remove: 1, insert: "" }]],
  [
    "change literal braces into alternatives",
    "[{a}]",
    [{ byte: 3, remove: 0, insert: ",b" }],
  ],
  [
    "change alternatives into literal braces",
    "[{a,b}]",
    [{ byte: 3, remove: 2, insert: "" }],
  ],
  [
    "nested alternative edit",
    "[{a,{b,c}}]",
    [{ byte: 7, remove: 1, insert: "" }],
  ],
  ["numeric bounds edit", "[{1..2}]", [{ byte: 2, remove: 1, insert: "word" }]],
  [
    "multibyte value replacement",
    "日本=値\n",
    [{ byte: 7, remove: 3, insert: "別" }],
  ],
  [
    "CRLF becomes lone CR",
    "a=b\r\nx=y\n",
    [{ byte: 4, remove: 1, insert: "" }],
  ],
  [
    "incomplete source before an intact section",
    "[a\n[b]\nx=y\n",
    [{ byte: 2, remove: 0, insert: "]" }],
  ],
  ["remove a whole header", "[a]\nx=y\n", [{ byte: 0, remove: 4, insert: "" }]],
  [
    "padding affects header name only after completion",
    "[a  ",
    [{ byte: 4, remove: 0, insert: "]" }],
  ],
  [
    "split a character after a numeric range",
    "[{1..2é}]",
    [{ byte: 7, remove: 1, insert: "" }],
  ],
];
for (const [name, source, edits] of cases) {
  test(`editorconfig: ${name}`, () => {
    assert.deepEqual(parse(source, edits), parse(applyEdits(source, edits)));
  });
}

test("editorconfig: fixed-seed generated histories preserve fresh parse structure and issue ranges", () => {
  let state = 0x6e34ab19;
  const next = (maximum) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % maximum;
  };
  const alphabet = "ab= []{}*,.!?\\/\n\r\t+-12";
  const seeds = [
    "",
    "root=true\n[*.{js,ts}]\nkey=value\n",
    "[[!a-z]]\r\nx=1",
    "[{1..2}]",
    "[a\\",
    "[{a,{b,c}}]\n",
  ];
  for (let sample = 0; sample < 120; sample++) {
    const source = seeds[sample % seeds.length];
    let edited = Buffer.from(source);
    const edits = [];
    for (let step = 0; step < 5; step++) {
      const byte = next(edited.length + 1),
        remove = Math.min(next(4), edited.length - byte);
      let insert = "";
      for (let n = next(5); n > 0; n--)
        insert += alphabet[next(alphabet.length)];
      const edit = { byte, remove, insert };
      edits.push(edit);
      edited = applyEdits(edited, [edit]);
    }
    const description = JSON.stringify({ source, edits });
    assert.deepEqual(parse(source, edits), parse(edited), description);
  }
});

test("editorconfig: splitting a UTF-8 character preserves the decoding issue after an edit", () => {
  const source = "a=é";
  const edits = [{ byte: 2, remove: 1, insert: "" }];
  const incremental = parse(source, edits);
  assert.deepEqual(incremental, parse(applyEdits(source, edits)));
  assert.deepEqual(issues(incremental), [
    ["invalid_syntax", "invalid_encoding", 2, 3],
  ]);
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

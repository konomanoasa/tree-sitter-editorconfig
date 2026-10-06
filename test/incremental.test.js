import assert from "node:assert/strict";
import { test } from "node:test";
import { applyEdits, issues, parse } from "./support/parser.js";

const cases = [
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
    name: "multibyte value replacement",
    source: "日本=値\n",
    edits: [{ byte: 7, deleteBytes: 3, insert: "別" }],
  },
  {
    name: "CRLF becomes lone CR",
    source: "a=b\r\nx=y\n",
    edits: [{ byte: 4, deleteBytes: 1, insert: "" }],
  },
  {
    name: "incomplete source before an intact section",
    source: "[a\n[b]\nx=y\n",
    edits: [{ byte: 2, deleteBytes: 0, insert: "]" }],
  },
  {
    name: "remove a whole header",
    source: "[a]\nx=y\n",
    edits: [{ byte: 0, deleteBytes: 4, insert: "" }],
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
for (const { name, source, edits } of cases) {
  test(`editorconfig: ${name}`, () => {
    for (let count = 1; count <= edits.length; count++) {
      const history = edits.slice(0, count);
      assert.deepEqual(
        parse(source, history),
        parse(applyEdits(source, history)),
        `after edit ${count}`,
      );
    }
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
        deleteBytes = Math.min(next(4), edited.length - byte);
      let insert = "";
      for (let n = next(5); n > 0; n--)
        insert += alphabet[next(alphabet.length)];
      const edit = { byte, deleteBytes, insert };
      edits.push(edit);
      edited = applyEdits(edited, [edit]);
    }
    const description = JSON.stringify({ source, edits });
    assert.deepEqual(parse(source, edits), parse(edited), description);
  }
});

test("editorconfig: splitting a UTF-8 character preserves the decoding issue after an edit", () => {
  const source = "a=é";
  const edits = [{ byte: 2, deleteBytes: 1, insert: "" }];
  const incremental = parse(source, edits);
  assert.deepEqual(incremental, parse(applyEdits(source, edits)));
  assert.deepEqual(issues(incremental), [
    ["invalid_syntax", "invalid_encoding", 2, 3],
  ]);
});

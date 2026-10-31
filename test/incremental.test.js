import assert from "node:assert/strict";
import { test } from "node:test";
import { hasError } from "./support/cst.js";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
  parse,
} from "./support/parser.js";

const editCases = [
  {
    name: "delete a prefix to move a BOM to byte zero",
    source: " \uFEFFkey=value",
    edits: [{ byte: 0, deleteBytes: 1, insert: "" }],
  },
  {
    name: "insert before a leading BOM in an incomplete source and repair it",
    source: "\uFEFFkey",
    edits: [
      { byte: 0, deleteBytes: 0, insert: "x" },
      { byte: 7, deleteBytes: 0, insert: "=value" },
    ],
  },
  {
    name: "repair an invalid first line then edit a normal later section",
    source: "bad\n[a]\nk=v\n[b]\nx=y",
    edits: [
      { byte: 3, deleteBytes: 0, insert: "=ok" },
      { byte: 22, deleteBytes: 0, insert: "z" },
    ],
  },
  {
    name: "multibyte value replacement",
    source: "日本=値\n",
    edits: [{ byte: 7, deleteBytes: 3, insert: "別" }],
  },
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
];

for (const entry of editCases) {
  test(`editorconfig: ${entry.name}`, () => {
    assertEditHistory(entry);
  });
}

test("editorconfig: a split UTF-8 character is rejected and its repair matches fresh parsing", () => {
  const source = "a=é";
  const split = { byte: 2, deleteBytes: 1, insert: "" };
  assert.equal(hasError(parse(source, [split])), true);
  assertEditHistory({
    source,
    edits: [split, { byte: 2, deleteBytes: 1, insert: "é" }],
  });
});

test("editorconfig: fixed-seed generated histories preserve normal source structure", () => {
  const seed = 0x6e34ab19;
  const historyCount = 120;
  const editsPerHistory = 5;
  const maxDeletedBytes = 3;
  const maxInsertedCharacters = 4;
  const lcgMultiplier = 1_664_525;
  const lcgIncrement = 1_013_904_223;
  let state = seed;
  const next = (maximum) => {
    state = (Math.imul(state, lcgMultiplier) + lcgIncrement) >>> 0;
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
  for (let sample = 0; sample < historyCount; sample++) {
    const source = seeds[sample % seeds.length];
    let edited = Buffer.from(source);
    const edits = [];
    for (let step = 0; step < editsPerHistory; step++) {
      const byte = next(edited.length + 1),
        deleteBytes = Math.min(next(maxDeletedBytes + 1), edited.length - byte);
      let insert = "";
      for (let n = next(maxInsertedCharacters + 1); n > 0; n--)
        insert += alphabet[next(alphabet.length)];
      const edit = { byte, deleteBytes, insert };
      edits.push(edit);
      edited = applyEdits(edited, [edit]);
    }
    assertIncrementalEqualsFresh(source, edits, edited);
  }
});

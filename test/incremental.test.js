import { test } from "node:test";
import {
  applyEdits,
  assertEditHistory,
  assertIncrementalEqualsFresh,
} from "./support/parser.js";

const editCases = [
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

test("editorconfig: fixed-seed generated histories preserve fresh parse structure and issue ranges", () => {
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

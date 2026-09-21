import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";
import {
  createTreeSitter,
  grammars,
  packageName,
  root,
} from "../scripts/tree-sitter.js";

function decodeEntities(text) {
  return text
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

function renderedCaptures(html, source) {
  const start = html.indexOf("<pre><code>");
  const end = html.indexOf("</code></pre>");
  assert.ok(start >= 0 && end >= start, html);
  const content = html.slice(start + "<pre><code>".length, end);
  const stack = [];
  const captures = [];
  let text = "";
  for (const part of content.matchAll(
    /<span class='([^']*)'>|<[/]span>|([^<]+)/g,
  )) {
    if (part[1] !== undefined) stack.push(part[1].replaceAll(" ", "."));
    else if (part[0] === "</span>") assert.notEqual(stack.pop(), undefined);
    else {
      const decoded = decodeEntities(part[2]);
      text += decoded;
      captures.push(
        ...Array(Buffer.byteLength(decoded)).fill(stack.at(-1) ?? ""),
      );
    }
  }
  assert.equal(stack.length, 0, "unclosed highlight span");
  assert.equal(
    text.replace(/\n$/, ""),
    source.replace(/\n$/, ""),
    "rendered source differs from the input",
  );
  return captures;
}

function createHighlighter({ directory, root, run, captureNames }) {
  const parserDirectory = join(directory, "parsers");
  mkdirSync(parserDirectory);
  // CLI discovery requires a tree-sitter-* entry even when the checkout is renamed.
  symlinkSync(root, join(parserDirectory, "tree-sitter-test"), "junction");
  const configPath = join(directory, "highlight.json");
  const capturePath = join(directory, "captures.txt");
  writeFileSync(
    configPath,
    JSON.stringify({
      "parser-directories": [parserDirectory],
      theme: Object.fromEntries(
        captureNames.map((name, index) => [name, index + 17]),
      ),
    }),
  );
  writeFileSync(capturePath, `${captureNames.join("\n")}\n`);

  return (scope, source, valid = true) => {
    const path = join(directory, "highlight.txt");
    writeFileSync(path, source);
    if (valid) {
      const parsed = run(["parse", "--cst", "--scope", scope, path]);
      assert.doesNotMatch(parsed, /^[0-9: \t-]+•/m, parsed);
    }
    const captures = renderedCaptures(
      run([
        "highlight",
        "--check",
        "--captures-path",
        capturePath,
        "--config-path",
        configPath,
        "--html",
        "--layout",
        "fragment",
        "--style",
        "classes",
        "--scope",
        scope,
        path,
      ]),
      source,
    );
    for (const capture of captures) {
      assert.ok(
        capture === "" || captureNames.includes(capture),
        `unexpected final capture: ${capture}`,
      );
    }
    return captures;
  };
}

function assertCaptures(source, actual, ranges) {
  const bytes = Buffer.from(source);
  const expected = Array(bytes.length).fill("");
  let previousEnd = 0;
  for (const [start, end, capture] of ranges) {
    assert.ok(
      Number.isSafeInteger(start) && start >= previousEnd,
      "expected ranges must be ordered and disjoint",
    );
    assert.ok(
      Number.isSafeInteger(end) && end > start && end <= bytes.length,
      "expected range exceeds source bytes",
    );
    expected.fill(capture, start, end);
    previousEnd = end;
  }
  // HTML emits line breaks outside spans.
  for (const [index, byte] of bytes.entries()) {
    if (byte !== 10)
      assert.equal(
        actual[index],
        expected[index],
        `byte ${index} in ${JSON.stringify(source)}`,
      );
  }
}

const captureNames = [
  "character.special",
  "comment",
  "number",
  "operator",
  "property",
  "punctuation.bracket",
  "punctuation.delimiter",
  "string",
  "string.escape",
  "string.special.path",
];
let highlight;

let directory;
let runner;
before(() => {
  directory = mkdtempSync(join(tmpdir(), `${packageName}-highlight-`));
  runner = createTreeSitter();
  highlight = createHighlighter({
    directory,
    root,
    run: assertCommand,
    captureNames,
  });
});
after(() => {
  try {
    runner?.close();
  } finally {
    if (directory) rmSync(directory, { recursive: true, force: true });
  }
});

function assertCommand(arguments_) {
  const result = runner.run(arguments_, {
    timeout: 60_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /Non-standard highlight captures/);
  return result.stdout;
}

const finalCaptureCases = [
  {
    name: "comment and pair",
    source: "# comment\nkey = value # ;",
    captures: [
      [0, 9, "comment"],
      [10, 13, "property"],
      [14, 15, "operator"],
      [16, 25, "string"],
    ],
  },
  {
    name: "glob syntax",
    source: "[**/*.?]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [1, 3, "character.special"],
      [3, 4, "punctuation.delimiter"],
      [4, 5, "character.special"],
      [5, 6, "string.special.path"],
      [6, 7, "character.special"],
      [7, 8, "punctuation.bracket"],
    ],
  },
  {
    name: "set and numeric bounds",
    source: "[[!a-z]/{-1..3}]",
    captures: [
      [0, 2, "punctuation.bracket"],
      [2, 3, "operator"],
      [3, 6, "string.special.path"],
      [6, 7, "punctuation.bracket"],
      [7, 8, "punctuation.delimiter"],
      [8, 9, "punctuation.bracket"],
      [9, 11, "number"],
      [11, 13, "operator"],
      [13, 14, "number"],
      [14, 16, "punctuation.bracket"],
    ],
  },
  {
    name: "escape and nested alternatives",
    source: "[{a,\\*}]",
    captures: [
      [0, 2, "punctuation.bracket"],
      [2, 3, "string.special.path"],
      [3, 4, "punctuation.delimiter"],
      [4, 6, "string.escape"],
      [6, 8, "punctuation.bracket"],
    ],
  },
  {
    name: "lone backslash",
    source: "[\\]",
    captures: [
      [0, 1, "punctuation.bracket"],
      [2, 3, "punctuation.bracket"],
    ],
  },
  {
    name: "incomplete escape at EOF",
    source: "[\\",
    captures: [[0, 1, "punctuation.bracket"]],
  },
  {
    name: "normal leaves in an unclosed set",
    source: "[[a]",
    captures: [
      [0, 2, "punctuation.bracket"],
      [2, 3, "string.special.path"],
      [3, 4, "punctuation.bracket"],
    ],
  },
];

for (const grammar of grammars) {
  for (const { name, source, captures } of finalCaptureCases) {
    test(`${grammar.name}: ${name}`, () => {
      assertCaptures(source, highlight(grammar.scope, source), captures);
    });
  }
}

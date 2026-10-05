import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before } from "node:test";
import { createTreeSitter, root } from "../../scripts/tree-sitter.js";

let runner;
let directory;
let configuration;
let library;
before(() => {
  runner = createTreeSitter();
  directory = runner.directory;
  configuration = runner.configPath;
  library = process.platform === "win32" ? "parser.dll" : "parser";
  run(["build", "--output", join(directory, library), root]);
});
after(() => runner?.close());

function run(args) {
  const result = runner.run(args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

function applyEdits(source, edits) {
  let bytes = Buffer.from(source);
  for (const edit of edits) {
    const { byte, deleteBytes, insert } = edit;
    const description = JSON.stringify(edit);
    assert.ok(
      Number.isSafeInteger(byte) && byte >= 0,
      `invalid byte offset: ${description}`,
    );
    assert.ok(
      Number.isSafeInteger(deleteBytes) && deleteBytes >= 0,
      `invalid deletion length: ${description}`,
    );
    assert.equal(typeof insert, "string", `invalid insertion: ${description}`);
    assert.ok(
      byte <= bytes.length && deleteBytes <= bytes.length - byte,
      `edit exceeds ${bytes.length} source bytes: ${description}`,
    );
    bytes = Buffer.concat([
      bytes.subarray(0, byte),
      Buffer.from(insert),
      bytes.subarray(byte + deleteBytes),
    ]);
  }
  return bytes;
}

function parse(source, edits = []) {
  const path = join(directory, "input.editorconfig");
  writeFileSync(path, source);
  const text = run([
    "parse",
    "--encoding",
    "utf8",
    "--config-path",
    configuration,
    "--lib-path",
    join(directory, library),
    "--lang-name",
    "editorconfig",
    "--cst",
    path,
    ...(edits.length
      ? [
          "--edits",
          ...edits.map(
            ({ byte, deleteBytes, insert }) =>
              `${byte} ${deleteBytes} ${insert}`,
          ),
        ]
      : []),
  ]);
  const bytes = applyEdits(source, edits);
  const starts = [0];
  for (const [offset, value] of bytes.entries())
    if (value === 10) starts.push(offset + 1);
  const nodes = [],
    ancestors = [];
  for (const line of text.split("\n")) {
    const location = /^([0-9]+):([0-9]+) +- +([0-9]+):([0-9]+) +/.exec(line);
    if (!location) continue;
    const match = /^(([a-z_]+): )?([a-z_]+|ERROR|MISSING)/.exec(
      line.slice(location[0].length),
    );
    if (!match) continue;
    const indentation = location[0].length;
    while (ancestors.length && ancestors.at(-1).indentation >= indentation)
      ancestors.pop();
    const start = starts[Number(location[1])] + Number(location[2]);
    const end = starts[Number(location[3])] + Number(location[4]);
    nodes.push({
      kind: match[3],
      field: match[2] ?? null,
      start,
      end,
      parent: ancestors.at(-1)?.index ?? null,
    });
    ancestors.push({ indentation, index: nodes.length - 1 });
  }
  assert.equal(nodes[0]?.kind, "document", text);
  assert.equal(nodes[0].end, bytes.length, text);
  assert.ok(
    !nodes.some(({ kind }) => kind === "ERROR" || kind === "MISSING"),
    text,
  );
  return nodes;
}

function issues(nodes) {
  return nodes.flatMap((node, index) => {
    if (node.kind !== "syntax_issue") return [];
    const outcome = nodes[index + 1],
      reason = nodes[index + 2];
    assert.equal(outcome.parent, index);
    assert.equal(reason.parent, index + 1);
    assert.deepEqual(
      [outcome.start, outcome.end, reason.start, reason.end],
      [node.start, node.end, node.start, node.end],
    );
    return [[outcome.kind, reason.kind, node.start, node.end]];
  });
}

function owners(nodes) {
  return nodes
    .filter(({ kind }) => kind === "syntax_issue")
    .map(({ parent }) => nodes[parent].kind);
}

function leaves(source, nodes) {
  const parents = new Set(nodes.map(({ parent }) => parent));
  return nodes.flatMap((node, index) =>
    parents.has(index)
      ? []
      : [
          [
            node.kind,
            Buffer.from(source).subarray(node.start, node.end).toString(),
          ],
        ],
  );
}

export { applyEdits, issues, leaves, owners, parse };

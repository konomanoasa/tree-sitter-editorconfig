import assert from "node:assert/strict";

function parseCst(text, source) {
  const bytes = Buffer.from(source);
  const newlineByte = 0x0a;
  const starts = [0];
  for (const [offset, value] of bytes.entries())
    if (value === newlineByte) starts.push(offset + 1);
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
  const bytes = Buffer.from(source);
  const parents = new Set(nodes.map(({ parent }) => parent));
  return nodes.flatMap((node, index) =>
    parents.has(index)
      ? []
      : [[node.kind, bytes.subarray(node.start, node.end).toString()]],
  );
}

export { issues, leaves, owners, parseCst };

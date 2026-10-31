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
    const match = /^(([a-z_]+): )?•?([a-z_]+|ERROR|MISSING)/.exec(
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
  assert.ok(["document", "ERROR"].includes(nodes[0]?.kind), text);
  assert.equal(nodes[0].end, bytes.length, text);
  return nodes;
}

function hasError(nodes) {
  return nodes.some(({ kind }) => kind === "ERROR" || kind === "MISSING");
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

export { hasError, leaves, parseCst };

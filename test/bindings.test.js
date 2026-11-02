import assert from "node:assert/strict";
import { test } from "node:test";
import EditorConfig from "@konomanoasa/tree-sitter-editorconfig";
import Parser from "tree-sitter";

test("Node.js language parses EditorConfig with the scanner and exposes node metadata", () => {
  const parser = new Parser();
  parser.setLanguage(EditorConfig);
  const source = "[*]\nindent_style = space\n";
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.type, "document");
  assert.equal(tree.rootNode.hasError, false);
  assert.equal(tree.rootNode.text, source);
  assert.equal(tree.rootNode.descendantsOfType("syntax_issue").length, 0);
  assert.ok(
    EditorConfig.nodeTypeInfo.some(
      (node) => node.type === "document" && node.named,
    ),
  );
});

test("Node.js packaged highlights capture EditorConfig property names", () => {
  const parser = new Parser();
  parser.setLanguage(EditorConfig);
  const tree = parser.parse("[*]\nindent_style = space\n");
  const query = new Parser.Query(EditorConfig, EditorConfig.HIGHLIGHTS_QUERY);
  assert.deepEqual(
    query
      .captures(tree.rootNode)
      .filter(({ name }) => name === "property")
      .map(({ name, node }) => [name, node.text]),
    [["property", "indent_style"]],
  );
});

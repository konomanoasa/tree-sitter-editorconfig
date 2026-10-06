# tree-sitter-editorconfig

[![CI](https://github.com/konomanoasa/tree-sitter-editorconfig/actions/workflows/ci.yaml/badge.svg)](https://github.com/konomanoasa/tree-sitter-editorconfig/actions/workflows/ci.yaml)
[![crates.io](https://img.shields.io/crates/v/konomanoasa-tree-sitter-editorconfig)](https://crates.io/crates/konomanoasa-tree-sitter-editorconfig)
[![npm](https://img.shields.io/npm/v/@konomanoasa/tree-sitter-editorconfig)](https://www.npmjs.com/package/@konomanoasa/tree-sitter-editorconfig)

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for
EditorConfig Specification 0.17.2.

## Syntax Issues

The parser detects syntax issues, including missing syntax, while preserving the surrounding structure.
These issues are represented as `syntax_issue` nodes.

## Installation

```sh
npm install @konomanoasa/tree-sitter-editorconfig
```

## Development

Development uses Node.js 24.21.0 or later.

```sh
npm install
npm run build
npm test
```

## Specification

[EditorConfig Specification 0.17.2](https://spec.editorconfig.org/)

## License

[MIT](LICENSE)

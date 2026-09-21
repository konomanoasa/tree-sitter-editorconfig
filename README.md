# tree-sitter-editorconfig

[![CI](https://github.com/konomanoasa/tree-sitter-editorconfig/actions/workflows/ci.yaml/badge.svg)](https://github.com/konomanoasa/tree-sitter-editorconfig/actions/workflows/ci.yaml)
[![npm](https://img.shields.io/npm/v/@konomanoasa/tree-sitter-editorconfig)](https://www.npmjs.com/package/@konomanoasa/tree-sitter-editorconfig)

[Tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for
EditorConfig Specification 0.17.2.

## Installation

```sh
npm install @konomanoasa/tree-sitter-editorconfig
```

## Grammar

| Grammar | Description | Rust constant |
| --- | --- | --- |
| `editorconfig` | EditorConfig Specification 0.17.2 | `LANGUAGE` |

## Development

Development requires Node.js 24.2.0 or later.

```sh
npm install
npm run build
npm test
```

## Specification

[EditorConfig Specification 0.17.2](https://spec.editorconfig.org/)

## License

[MIT](LICENSE)

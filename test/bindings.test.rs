use tree_sitter::{Parser, Query};
use tree_sitter_editorconfig as grammar;

#[test]
fn parses_valid_source() {
  let source = "[*]\nindent_style = space\n";
  let mut parser = Parser::new();
  parser.set_language(&grammar::LANGUAGE.into()).unwrap();
  let tree = parser.parse(source, None).unwrap();
  let root = tree.root_node();
  assert_eq!(root.kind(), "document");
  assert_eq!(root.byte_range(), 0..source.len());
  assert!(!root.has_error());
}

#[test]
fn linked_scanner_exposes_a_missing_section_close_at_eof() {
  let language = grammar::LANGUAGE.into();
  let mut parser = Parser::new();
  parser.set_language(&language).unwrap();
  let tree = parser.parse("[a", None).unwrap();
  assert!(!tree.root_node().has_error());
  assert_eq!(
    tree.root_node().to_sexp(),
    "(document (section header: (section_header opening: (section_open) name: (pattern (glob_literal)) issue: (syntax_issue (incomplete_syntax (missing_section_close))))))"
  );
  Query::new(&language, grammar::HIGHLIGHTS_QUERY).unwrap();
}

import unittest
from types import CapsuleType

import tree_sitter_editorconfig

from tree_sitter import Language, Parser, Query, QueryCursor


class BindingsTest(unittest.TestCase):
    def test_language_capsule_parses_source_with_external_scanner(self):
        capsule = tree_sitter_editorconfig.language()
        self.assertIsInstance(capsule, CapsuleType)
        language = Language(capsule)
        self.assertEqual(language.name, "editorconfig")
        source = b"[*]\nindent_style = space\n"
        tree = Parser(language).parse(source)
        self.assertEqual(tree.root_node.type, "document")
        self.assertFalse(tree.root_node.has_error)
        self.assertEqual(tree.root_node.text, source)

    def test_packaged_highlights_capture_property(self):
        language = Language(tree_sitter_editorconfig.language())
        tree = Parser(language).parse(b"[*]\nindent_style = space\n")
        query = Query(language, tree_sitter_editorconfig.HIGHLIGHTS_QUERY)
        captures = QueryCursor(query).captures(tree.root_node)
        self.assertEqual(
            [node.text for node in captures["property"]], [b"indent_style"]
        )


if __name__ == "__main__":
    unittest.main()

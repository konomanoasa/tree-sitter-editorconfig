[
  (comment_marker)
  (comment_text)
] @comment

(key_text) @property

(value_text) @string

[
  (glob_literal)
  (set_text)
] @string.special.path

(escape) @string.escape

(integer) @number

[
  (wildcard)
  (recursive_wildcard)
  (single_character)
] @character.special

[
  (assignment_operator)
  (set_negation)
  (range_separator)
] @operator

[
  (section_open)
  (section_close)
  (set_open)
  (set_close)
  (brace_open)
  (brace_close)
] @punctuation.bracket

[
  (alternative_separator)
  (path_separator)
] @punctuation.delimiter

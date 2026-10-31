export default grammar({
  name: "editorconfig",
  externals: ($) => [
    $._blank_start,
    $._comment_start,
    $._pair_start,
    $._header_start,
    $.line_ending,
    $._eof,
    $.comment_marker,
    $.comment_text,
    $.key_text,
    $.assignment_operator,
    $.value_text,
    $.section_open,
    $.section_close,
    $.glob_literal,
    $.wildcard,
    $.recursive_wildcard,
    $.single_character,
    $.path_separator,
    $.escape,
    $.set_open,
    $.set_negation,
    $.set_text,
    $.set_close,
    $._alternation_open,
    $._range_open,
    $.brace_close,
    $.alternative_separator,
    $.integer,
    $.range_separator,
    $._error_sentinel,
  ],
  extras: ($) => [$._unmatchable],
  rules: {
    document: ($) => seq(optional($.preamble), repeat($.section)),
    preamble: ($) => repeat1($._body_line),
    section: ($) =>
      seq(field("header", $.section_header), repeat($._body_line)),
    _body_line: ($) => choice($.blank_line, $.comment, $.pair),

    _end: ($) => choice($.line_ending, $._eof),
    blank_line: ($) => seq($._blank_start, $._end),
    comment: ($) =>
      seq($._comment_start, $.comment_marker, optional($.comment_text), $._end),
    pair: ($) =>
      seq(
        $._pair_start,
        optional(field("key", $.key)),
        field("operator", $.assignment_operator),
        optional(field("value", $.value)),
        $._end,
      ),
    key: ($) => $.key_text,
    value: ($) => $.value_text,

    section_header: ($) =>
      seq(
        $._header_start,
        field("opening", $.section_open),
        optional(field("name", $.pattern)),
        field("closing", $.section_close),
        $._end,
      ),
    pattern: ($) =>
      repeat1(
        choice(
          $.glob_literal,
          $.wildcard,
          $.recursive_wildcard,
          $.single_character,
          $.path_separator,
          $.escape,
          $.character_set,
          $.alternation,
          $.numeric_range,
        ),
      ),
    character_set: ($) =>
      seq(
        field("opening", $.set_open),
        optional(field("negation", $.set_negation)),
        optional($.set_text),
        field("closing", $.set_close),
      ),
    alternation: ($) =>
      seq(
        field("opening", alias($._alternation_open, $.brace_open)),
        optional($.pattern),
        repeat1(seq($.alternative_separator, optional($.pattern))),
        field("closing", $.brace_close),
      ),
    numeric_range: ($) =>
      seq(
        field("opening", alias($._range_open, $.brace_open)),
        field("lower", $.integer),
        $.range_separator,
        field("upper", $.integer),
        field("closing", $.brace_close),
      ),

    _unmatchable: () => token(seq(/[\s\S]/, /[^\s\S]/)),
  },
});

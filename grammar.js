const missing = [
  "assignment_operator",
  "section_close",
  "set_close",
  "brace_close",
];

const issueTokens = [
  ["invalid_encoding", "invalid_syntax", "invalid_encoding"],
  ["invalid_line_ending", "invalid_syntax", "invalid_line_ending"],
  ["incomplete_line_ending", "incomplete_syntax", "invalid_line_ending"],
  ["invalid_escape", "invalid_syntax", "incomplete_escape"],
  ["incomplete_escape", "incomplete_syntax", "incomplete_escape"],
  ...missing.flatMap((name) => [
    [`invalid_missing_${name}`, "invalid_syntax", `missing_${name}`],
    [`incomplete_missing_${name}`, "incomplete_syntax", `missing_${name}`],
  ]),
];

const issueRules = Object.fromEntries(
  issueTokens.flatMap(([name, outcome, reason]) => [
    [`_${name}_outcome`, ($) => alias($[`_${name}`], $[reason])],
    [`_${name}_issue`, ($) => alias($[`_${name}_outcome`], $[outcome])],
  ]),
);

function issue($, name) {
  return field("issue", alias($[`_${name}_issue`], $.syntax_issue));
}

function absent($, name) {
  return choice(
    issue($, `invalid_missing_${name}`),
    issue($, `incomplete_missing_${name}`),
  );
}

function pieces($, text) {
  return choice(text, issue($, "invalid_encoding"));
}

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
    $._escape_prefix,
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
    ...issueTokens.map(([name]) => $[`_${name}`]),
    $._error_sentinel,
  ],
  extras: ($) => [$._unmatchable],
  rules: {
    document: ($) => seq(optional($.preamble), repeat($.section)),
    preamble: ($) => repeat1($._body_line),
    section: ($) =>
      seq(field("header", $.section_header), repeat($._body_line)),
    _body_line: ($) => choice($.blank_line, $.comment, $.pair),
    _end: ($) =>
      choice(
        $.line_ending,
        issue($, "invalid_line_ending"),
        issue($, "incomplete_line_ending"),
        $._eof,
      ),
    blank_line: ($) => seq($._blank_start, $._end),
    comment: ($) =>
      seq(
        $._comment_start,
        $.comment_marker,
        repeat(pieces($, $.comment_text)),
        $._end,
      ),
    pair: ($) =>
      seq(
        $._pair_start,
        optional(field("key", $.key)),
        choice(
          seq(
            field("operator", $.assignment_operator),
            optional(field("value", $.value)),
          ),
          absent($, "assignment_operator"),
        ),
        $._end,
      ),
    key: ($) => repeat1(pieces($, $.key_text)),
    value: ($) => repeat1(pieces($, $.value_text)),
    section_header: ($) =>
      seq(
        $._header_start,
        field("opening", $.section_open),
        optional(field("name", $.pattern)),
        choice(field("closing", $.section_close), absent($, "section_close")),
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
          issue($, "invalid_escape"),
          issue($, "incomplete_escape"),
          $._undecodable_escape,
          $.character_set,
          $.alternation,
          $.numeric_range,
          issue($, "invalid_encoding"),
        ),
      ),
    _undecodable_escape: ($) =>
      seq($._escape_prefix, issue($, "invalid_encoding")),
    character_set: ($) =>
      seq(
        field("opening", $.set_open),
        optional(field("negation", $.set_negation)),
        repeat(pieces($, $.set_text)),
        choice(field("closing", $.set_close), absent($, "set_close")),
      ),
    alternation: ($) =>
      seq(
        field("opening", alias($._alternation_open, $.brace_open)),
        optional($.pattern),
        repeat1(seq($.alternative_separator, optional($.pattern))),
        choice(field("closing", $.brace_close), absent($, "brace_close")),
      ),
    numeric_range: ($) =>
      seq(
        field("opening", alias($._range_open, $.brace_open)),
        field("lower", $.integer),
        $.range_separator,
        field("upper", $.integer),
        repeat(issue($, "invalid_encoding")),
        choice(field("closing", $.brace_close), absent($, "brace_close")),
      ),
    _unmatchable: () => token(seq(/[\s\S]/, /[^\s\S]/)),
    ...issueRules,
  },
});

#include "tree_sitter/alloc.h"
#include "tree_sitter/parser.h"
#include <string.h>

enum Token {
  BLANK_START,
  COMMENT_START,
  PAIR_START,
  HEADER_START,
  LINE_ENDING,
  END_OF_FILE,
  COMMENT_MARKER,
  COMMENT_TEXT,
  KEY_TEXT,
  ASSIGNMENT_OPERATOR,
  VALUE_TEXT,
  SECTION_OPEN,
  SECTION_CLOSE,
  GLOB_LITERAL,
  WILDCARD,
  RECURSIVE_WILDCARD,
  SINGLE_CHARACTER,
  PATH_SEPARATOR,
  ESCAPE,
  ESCAPE_PREFIX,
  SET_OPEN,
  SET_NEGATION,
  SET_TEXT,
  SET_CLOSE,
  ALTERNATION_OPEN,
  RANGE_OPEN,
  BRACE_CLOSE,
  ALTERNATIVE_SEPARATOR,
  INTEGER,
  RANGE_SEPARATOR,
  INVALID_ENCODING,
  INVALID_LINE_ENDING,
  INCOMPLETE_LINE_ENDING,
  /* boundary_issue requires adjacent invalid/incomplete token pairs. */
  INVALID_ESCAPE,
  INCOMPLETE_ESCAPE,
  INVALID_MISSING_ASSIGNMENT_OPERATOR,
  INCOMPLETE_MISSING_ASSIGNMENT_OPERATOR,
  INVALID_MISSING_SECTION_CLOSE,
  INCOMPLETE_MISSING_SECTION_CLOSE,
  INVALID_MISSING_SET_CLOSE,
  INCOMPLETE_MISSING_SET_CLOSE,
  INVALID_MISSING_BRACE_CLOSE,
  INCOMPLETE_MISSING_BRACE_CLOSE,
  ERROR_SENTINEL
};

/* BLANK_LINE onward follows the line start token order. */
enum Line { LINE_START, BLANK_LINE, COMMENT_LINE, PAIR_LINE, HEADER_LINE };

enum Range {
  RANGE_START,
  RANGE_LOWER_SIGN,
  RANGE_LOWER,
  RANGE_DOT,
  RANGE_DOTS,
  RANGE_UPPER_SIGN,
  RANGE_UPPER,
  RANGE_NONE
};

static const uint32_t NO_EQUALS = UINT32_MAX;

/* Offsets count characters from the line start. */
typedef struct {
  uint32_t position, content_end, equals, key_end, glob_end, kind;
} Scanner;

static bool whitespace(int32_t c) {
  return c == ' ' || c == '\t' || c == '\v' || c == '\f';
}

static bool digit(int32_t c) {
  return c >= '0' && c <= '9';
}

static bool boundary(const TSLexer *lexer) {
  int32_t c = lexer->lookahead;
  return lexer->eof(lexer) || c == '\n' || c == '\r';
}

static bool emit(TSLexer *lexer, const bool *valid, enum Token token) {
  if (!valid[token])
    return false;
  lexer->result_symbol = token;
  return true;
}

static void advance(Scanner *s, TSLexer *lexer) {
  lexer->advance(lexer, false);
  s->position++;
  lexer->mark_end(lexer);
}

static void skip(Scanner *s, TSLexer *lexer) {
  lexer->advance(lexer, true);
  s->position++;
}

static bool
take(Scanner *s, TSLexer *lexer, const bool *valid, enum Token token) {
  do {
    advance(s, lexer);
  } while (
    token == INVALID_ENCODING && lexer->lookahead == -1 && !lexer->eof(lexer)
  );
  if (token == INVALID_ENCODING && !lexer->eof(lexer))
    lexer->advance(lexer, false);
  return emit(lexer, valid, token);
}

static bool start_line(Scanner *s, TSLexer *lexer, const bool *valid) {
  if (lexer->eof(lexer))
    return false;
  Scanner line = {.equals = NO_EQUALS};
  uint32_t length = 0;
  int32_t first = 0, last = 0;
  lexer->mark_end(lexer);
  while (!boundary(lexer)) {
    int32_t c = lexer->lookahead;
    lexer->advance(lexer, false);
    length++;
    if (whitespace(c)) {
      if (line.content_end == 0) {
        line.position = length;
        lexer->mark_end(lexer);
      }
      continue;
    }
    if (line.content_end == 0)
      first = c;
    if (c == '=' && line.equals == NO_EQUALS) {
      line.equals = length - 1;
      line.key_end = line.content_end;
    }
    line.content_end = length;
    last = c;
  }
  if (line.equals == NO_EQUALS)
    line.key_end = line.content_end;
  if (line.content_end == 0)
    line.kind = BLANK_LINE;
  else if (first == '#' || first == ';')
    line.kind = COMMENT_LINE;
  else if (first == '[' && (last == ']' || line.equals == NO_EQUALS)) {
    line.kind = HEADER_LINE;
    line.glob_end = line.content_end - (last == ']' ? 1 : 0);
  } else
    line.kind = PAIR_LINE;
  *s = line;
  return emit(
    lexer,
    valid,
    (enum Token)(BLANK_START + (line.kind - BLANK_LINE))
  );
}

static bool end_line(Scanner *s, TSLexer *lexer, const bool *valid) {
  enum Token token;
  while (whitespace(lexer->lookahead))
    skip(s, lexer);
  if (lexer->eof(lexer))
    token = END_OF_FILE;
  else if (lexer->lookahead == '\n') {
    lexer->advance(lexer, false);
    token = LINE_ENDING;
  } else if (lexer->lookahead == '\r') {
    lexer->advance(lexer, false);
    token = lexer->eof(lexer) ? INCOMPLETE_LINE_ENDING : INVALID_LINE_ENDING;
    if (lexer->lookahead == '\n') {
      lexer->advance(lexer, false);
      token = LINE_ENDING;
    }
  } else
    return false;
  lexer->mark_end(lexer);
  memset(s, 0, sizeof(Scanner));
  return emit(lexer, valid, token);
}

static bool
boundary_issue(TSLexer *lexer, const bool *valid, enum Token invalid_token) {
  if (!valid[invalid_token] && !valid[invalid_token + 1])
    return false;
  lexer->mark_end(lexer);
  while (whitespace(lexer->lookahead))
    lexer->advance(lexer, false);
  return emit(
    lexer,
    valid,
    (enum Token)(invalid_token + (lexer->eof(lexer) ? 1 : 0))
  );
}

static bool text(
  Scanner *s,
  TSLexer *lexer,
  const bool *valid,
  enum Token token,
  uint32_t end
) {
  if (lexer->lookahead == -1)
    return take(s, lexer, valid, INVALID_ENCODING);
  while (s->position < end && lexer->lookahead != -1)
    advance(s, lexer);
  return emit(lexer, valid, token);
}

static enum Range range_step(enum Range state, int32_t c) {
  switch (state) {
  case RANGE_START:
    return c == '-' ? RANGE_LOWER_SIGN : digit(c) ? RANGE_LOWER : RANGE_NONE;
  case RANGE_LOWER_SIGN:
    return digit(c) ? RANGE_LOWER : RANGE_NONE;
  case RANGE_LOWER:
    return digit(c) ? RANGE_LOWER : c == '.' ? RANGE_DOT : RANGE_NONE;
  case RANGE_DOT:
    return c == '.' ? RANGE_DOTS : RANGE_NONE;
  case RANGE_DOTS:
    return c == '-' ? RANGE_UPPER_SIGN : digit(c) ? RANGE_UPPER : RANGE_NONE;
  case RANGE_UPPER_SIGN:
  case RANGE_UPPER:
    return digit(c) ? RANGE_UPPER : RANGE_NONE;
  default:
    return RANGE_NONE;
  }
}

static enum Token brace(Scanner *s, TSLexer *lexer, bool leading) {
  uint32_t position = s->position + 1, depth = 1;
  enum Range range = RANGE_START;
  enum Token token = GLOB_LITERAL;
  bool in_set = false, escaped = false, closed = false;
  lexer->advance(lexer, false);
  if (leading)
    lexer->mark_end(lexer);
  while (position < s->glob_end && lexer->lookahead != -1) {
    int32_t c = lexer->lookahead;
    bool delimiter = !in_set && !escaped && depth == 1;
    if (delimiter && c == '}') {
      closed = true;
      break;
    }
    if (delimiter && c == ',') {
      token = ALTERNATION_OPEN;
      break;
    }
    range = range_step(range, c);
    if (in_set)
      in_set = c != ']';
    else if (escaped)
      escaped = false;
    else if (c == '\\')
      escaped = true;
    else if (c == '[')
      in_set = true;
    else if (c == '{')
      depth++;
    else if (c == '}')
      depth--;
    lexer->advance(lexer, false);
    position++;
  }
  if (token == GLOB_LITERAL && range == RANGE_UPPER)
    token = RANGE_OPEN;
  if (token != GLOB_LITERAL) {
    if (leading)
      s->position++;
    return token;
  }
  if (closed) {
    lexer->advance(lexer, false);
    position++;
  }
  s->position = position;
  lexer->mark_end(lexer);
  return GLOB_LITERAL;
}

static bool literal_character(int32_t c, const bool *valid) {
  switch (c) {
  case -1:
  case '*':
  case '?':
  case '/':
  case '[':
  case '\\':
    return false;
  case '}':
    return !valid[BRACE_CLOSE];
  case ',':
    return !valid[ALTERNATIVE_SEPARATOR];
  default:
    return true;
  }
}

static bool literal(Scanner *s, TSLexer *lexer, const bool *valid) {
  uint32_t start = s->position;
  while (s->position < s->glob_end) {
    int32_t c = lexer->lookahead;
    if (c == '{') {
      bool leading = s->position == start;
      enum Token open = brace(s, lexer, leading);
      if (open != GLOB_LITERAL)
        return emit(lexer, valid, leading ? open : GLOB_LITERAL);
    } else if (literal_character(c, valid))
      advance(s, lexer);
    else
      break;
  }
  return emit(lexer, valid, GLOB_LITERAL);
}

static bool atom(Scanner *s, TSLexer *lexer, const bool *valid) {
  switch (lexer->lookahead) {
  case '*':
    advance(s, lexer);
    if (s->position < s->glob_end && lexer->lookahead == '*')
      return take(s, lexer, valid, RECURSIVE_WILDCARD);
    return emit(lexer, valid, WILDCARD);
  case '?':
    return take(s, lexer, valid, SINGLE_CHARACTER);
  case '/':
    return take(s, lexer, valid, PATH_SEPARATOR);
  case '[':
    return take(s, lexer, valid, SET_OPEN);
  case '\\':
    advance(s, lexer);
    if (s->position == s->glob_end)
      return boundary_issue(lexer, valid, INVALID_ESCAPE);
    if (lexer->lookahead == -1)
      return emit(lexer, valid, ESCAPE_PREFIX);
    return take(s, lexer, valid, ESCAPE);
  default:
    return literal(s, lexer, valid);
  }
}

static bool set(Scanner *s, TSLexer *lexer, const bool *valid) {
  int32_t c = lexer->lookahead;
  if (c == ']')
    return take(s, lexer, valid, SET_CLOSE);
  if (c == '!' && valid[SET_NEGATION])
    return take(s, lexer, valid, SET_NEGATION);
  while (
    s->position <
    s->glob_end &&
    lexer->lookahead !=
    ']' &&
    lexer->lookahead != -1
  )
    advance(s, lexer);
  return emit(lexer, valid, SET_TEXT);
}

static bool integer(Scanner *s, TSLexer *lexer, const bool *valid) {
  if (lexer->lookahead == '-')
    advance(s, lexer);
  while (s->position < s->glob_end && digit(lexer->lookahead))
    advance(s, lexer);
  return emit(lexer, valid, INTEGER);
}

static bool glob(Scanner *s, TSLexer *lexer, const bool *valid) {
  int32_t c = lexer->lookahead;
  if (c == -1)
    return take(s, lexer, valid, INVALID_ENCODING);
  if (valid[SET_TEXT])
    return set(s, lexer, valid);
  if (valid[INTEGER])
    return integer(s, lexer, valid);
  if (valid[RANGE_SEPARATOR]) {
    advance(s, lexer);
    return take(s, lexer, valid, RANGE_SEPARATOR);
  }
  if (c == '}' && valid[BRACE_CLOSE])
    return take(s, lexer, valid, BRACE_CLOSE);
  if (c == ',' && valid[ALTERNATIVE_SEPARATOR])
    return take(s, lexer, valid, ALTERNATIVE_SEPARATOR);
  if (!valid[GLOB_LITERAL]) {
    /* Edits to the next character must invalidate this token. */
    lexer->mark_end(lexer);
    lexer->advance(lexer, false);
    return emit(lexer, valid, INVALID_MISSING_BRACE_CLOSE);
  }
  return atom(s, lexer, valid);
}

static bool scan(Scanner *s, TSLexer *lexer, const bool *valid) {
  if (valid[ERROR_SENTINEL])
    return false;
  switch (s->kind) {
  case LINE_START:
    return start_line(s, lexer, valid);
  case COMMENT_LINE:
    if (s->position < s->content_end) {
      if (valid[COMMENT_MARKER])
        return take(s, lexer, valid, COMMENT_MARKER);
      return text(s, lexer, valid, COMMENT_TEXT, s->content_end);
    }
    break;
  case PAIR_LINE:
    if (s->position < s->key_end)
      return text(s, lexer, valid, KEY_TEXT, s->key_end);
    if (s->equals == NO_EQUALS) {
      if (boundary_issue(lexer, valid, INVALID_MISSING_ASSIGNMENT_OPERATOR))
        return true;
      break;
    }
    if (s->position <= s->equals) {
      while (s->position < s->equals)
        skip(s, lexer);
      return take(s, lexer, valid, ASSIGNMENT_OPERATOR);
    }
    if (s->position == s->equals + 1)
      while (whitespace(lexer->lookahead))
        skip(s, lexer);
    if (s->position < s->content_end)
      return text(s, lexer, valid, VALUE_TEXT, s->content_end);
    break;
  case HEADER_LINE:
    if (valid[SECTION_OPEN])
      return take(s, lexer, valid, SECTION_OPEN);
    if (s->position < s->glob_end)
      return glob(s, lexer, valid);
    if (s->position == s->glob_end) {
      if (
        boundary_issue(lexer, valid, INVALID_MISSING_SET_CLOSE) ||
        boundary_issue(lexer, valid, INVALID_MISSING_BRACE_CLOSE)
      )
        return true;
      if (s->glob_end == s->content_end) {
        if (boundary_issue(lexer, valid, INVALID_MISSING_SECTION_CLOSE))
          return true;
      } else if (valid[SECTION_CLOSE])
        return take(s, lexer, valid, SECTION_CLOSE);
    }
    break;
  default:
    break;
  }
  return end_line(s, lexer, valid);
}

void *tree_sitter_editorconfig_external_scanner_create(void) {
  return ts_calloc(1, sizeof(Scanner));
}

void tree_sitter_editorconfig_external_scanner_destroy(void *payload) {
  ts_free(payload);
}

unsigned tree_sitter_editorconfig_external_scanner_serialize(
  void *payload,
  char *buffer
) {
  memcpy(buffer, payload, sizeof(Scanner));
  return sizeof(Scanner);
}

void tree_sitter_editorconfig_external_scanner_deserialize(
  void *payload,
  const char *buffer,
  unsigned length
) {
  memset(payload, 0, sizeof(Scanner));
  if (length == sizeof(Scanner))
    memcpy(payload, buffer, length);
}

bool tree_sitter_editorconfig_external_scanner_scan(
  void *payload,
  TSLexer *lexer,
  const bool *valid
) {
  Scanner next = *(Scanner *)payload;
  if (!scan(&next, lexer, valid))
    return false;
  *(Scanner *)payload = next;
  return true;
}

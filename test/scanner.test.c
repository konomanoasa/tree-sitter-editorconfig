#include <assert.h>
#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "../src/parser.c"
#include "../src/scanner.c"

#ifdef TREE_SITTER_REUSE_ALLOCATOR
static size_t reuse_live_allocations;
static bool reuse_fail_next_calloc;

static void *reuse_calloc(size_t count, size_t size) {
  if (reuse_fail_next_calloc) {
    reuse_fail_next_calloc = false;
    return NULL;
  }
  void *result = calloc(count, size);
  if (result != NULL) {
    reuse_live_allocations += 1;
  }
  return result;
}

static void reuse_free(void *allocation) {
  if (allocation != NULL) {
    assert(reuse_live_allocations > 0);
    reuse_live_allocations -= 1;
  }
  free(allocation);
}

void *(*ts_current_calloc)(size_t, size_t) = reuse_calloc;
void (*ts_current_free)(void *) = reuse_free;
#endif

struct MockLexer {
  TSLexer lexer;
  const int32_t *input;
  size_t length;
  size_t offset;
  size_t mark;
};

static void mock_advance(TSLexer *lexer, bool skip) {
  (void)skip;
  struct MockLexer *mock = (struct MockLexer *)lexer;
  if (mock->offset < mock->length) {
    mock->offset += 1;
  }
  lexer->lookahead =
    mock->offset < mock->length ? mock->input[mock->offset] : 0;
}

static void mock_mark_end(TSLexer *lexer) {
  struct MockLexer *mock = (struct MockLexer *)lexer;
  mock->mark = mock->offset;
}

static bool mock_eof(const TSLexer *lexer) {
  const struct MockLexer *mock = (const struct MockLexer *)lexer;
  return mock->offset == mock->length;
}

static void
init_mock_lexer(struct MockLexer *mock, const int32_t *input, size_t length) {
  *mock = (struct MockLexer){
    .lexer =
      {
        .lookahead = length == 0 ? 0 : input[0],
        .result_symbol = UINT16_MAX,
        .advance = mock_advance,
        .mark_end = mock_mark_end,
        .eof = mock_eof,
      },
    .input = input,
    .length = length,
    .mark = SIZE_MAX,
  };
}

static void test_builtin_lexer_accepts_only_physical_eof(void) {
  const int32_t input[] = {'x', 0, '\n', -1, 0x1f600};
  for (size_t index = 0; index < sizeof(input) / sizeof(input[0]); index += 1) {
    struct MockLexer mock;
    init_mock_lexer(&mock, input + index, 1);
    assert(!ts_lex(&mock.lexer, 0));
  }
  struct MockLexer mock;
  init_mock_lexer(&mock, NULL, 0);
  assert(ts_lex(&mock.lexer, 0));
  assert(mock.lexer.result_symbol == ts_builtin_sym_end);
}

static void test_lifecycle_and_serialization_round_trip(void) {
  Scanner *scanner = tree_sitter_editorconfig_external_scanner_create();
  assert(scanner != NULL);
  const Scanner initial = {0};
  assert(memcmp(scanner, &initial, sizeof(initial)) == 0);
  const Scanner expected = {
    .position = 1,
    .content_end = UINT32_MAX,
    .equals = 65536,
    .key_end = 65535,
    .glob_end = 256,
    .kind = HEADER_LINE,
  };
  *scanner = expected;
  char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE + 2];
  memset(buffer, 0x5a, sizeof(buffer));
  const unsigned length =
    tree_sitter_editorconfig_external_scanner_serialize(scanner, buffer + 1);
  assert(length == sizeof(Scanner));
  assert(length <= TREE_SITTER_SERIALIZATION_BUFFER_SIZE);
  assert(buffer[0] == 0x5a);
  for (size_t index = length + 1; index < sizeof(buffer); index += 1) {
    assert(buffer[index] == 0x5a);
  }
  tree_sitter_editorconfig_external_scanner_deserialize(scanner, NULL, 0);
  assert(memcmp(scanner, &initial, sizeof(initial)) == 0);
  tree_sitter_editorconfig_external_scanner_deserialize(
    scanner,
    buffer + 1,
    length
  );
  assert(memcmp(scanner, &expected, sizeof(expected)) == 0);
  tree_sitter_editorconfig_external_scanner_deserialize(
    scanner,
    buffer + 1,
    length - 1
  );
  assert(memcmp(scanner, &initial, sizeof(initial)) == 0);
  tree_sitter_editorconfig_external_scanner_destroy(scanner);
}

static void test_disabled_and_recovery_scans_preserve_state(void) {
  const int32_t input[] = {'a', '=', 'b'};
  for (unsigned recovery = 0; recovery <= 1; recovery += 1) {
    bool valid_symbols[ERROR_SENTINEL + 1] = {false};
    for (unsigned symbol = 0; symbol <= ERROR_SENTINEL; symbol += 1) {
      valid_symbols[symbol] = recovery != 0;
    }
    Scanner scanner = {0};
    const Scanner expected = scanner;
    struct MockLexer mock;
    init_mock_lexer(&mock, input, 3);
    assert(!tree_sitter_editorconfig_external_scanner_scan(
      &scanner,
      &mock.lexer,
      valid_symbols
    ));
    assert(memcmp(&scanner, &expected, sizeof(expected)) == 0);
  }
  Scanner scanner = {.kind = PAIR_LINE, .content_end = 1, .key_end = 1};
  const Scanner expected = scanner;
  struct MockLexer mock;
  init_mock_lexer(&mock, input, 3);
  const bool valid_symbols[ERROR_SENTINEL + 1] = {[VALUE_TEXT] = true};
  assert(!tree_sitter_editorconfig_external_scanner_scan(
    &scanner,
    &mock.lexer,
    valid_symbols
  ));
  assert(memcmp(&scanner, &expected, sizeof(expected)) == 0);
}

static void test_restored_pair_state_preserves_token_ranges(void) {
  const int32_t input[] = {'a', '=', 'b', '\r', '\n'};
  const struct {
    enum Token token;
    size_t start;
    size_t end;
  } cases[] = {
    {PAIR_START, 0, 0},
    {KEY_TEXT, 0, 1},
    {ASSIGNMENT_OPERATOR, 1, 2},
    {VALUE_TEXT, 2, 3},
    {LINE_ENDING, 3, 5},
  };
  Scanner scanner = {0};
  for (size_t index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1) {
    bool valid_symbols[ERROR_SENTINEL + 1] = {false};
    valid_symbols[cases[index].token] = true;
    struct MockLexer mock;
    init_mock_lexer(&mock, input + cases[index].start, 5 - cases[index].start);
    assert(tree_sitter_editorconfig_external_scanner_scan(
      &scanner,
      &mock.lexer,
      valid_symbols
    ));
    assert(mock.lexer.result_symbol == cases[index].token);
    assert(mock.mark == cases[index].end - cases[index].start);
    char buffer[TREE_SITTER_SERIALIZATION_BUFFER_SIZE];
    const unsigned length =
      tree_sitter_editorconfig_external_scanner_serialize(&scanner, buffer);
    Scanner restored = {0};
    tree_sitter_editorconfig_external_scanner_deserialize(
      &restored,
      buffer,
      length
    );
    scanner = restored;
  }
  const Scanner initial = {0};
  assert(memcmp(&scanner, &initial, sizeof(initial)) == 0);
}

static void test_escape_issues_distinguish_closed_boundaries_from_eof(void) {
  const struct {
    int32_t input[2];
    size_t length;
    enum Token expected;
  } cases[] = {
    {{'\\', ']'}, 2, INVALID_ESCAPE},
    {{'\\', '\n'}, 2, INVALID_ESCAPE},
    {{'\\', 0}, 1, INCOMPLETE_ESCAPE},
  };
  for (size_t index = 0; index < sizeof(cases) / sizeof(cases[0]); index += 1) {
    Scanner scanner =
      {.position = 2, .content_end = 3, .glob_end = 3, .kind = HEADER_LINE};
    struct MockLexer mock;
    init_mock_lexer(&mock, cases[index].input, cases[index].length);
    const bool valid_symbols[ERROR_SENTINEL + 1] = {
      [GLOB_LITERAL] = true,
      [INVALID_ESCAPE] = true,
      [INCOMPLETE_ESCAPE] = true,
    };
    assert(tree_sitter_editorconfig_external_scanner_scan(
      &scanner,
      &mock.lexer,
      valid_symbols
    ));
    assert(mock.lexer.result_symbol == cases[index].expected);
    assert(mock.mark == 1);
    assert(scanner.position == 3);
  }
}

static void test_nul_is_value_content_and_not_eof(void) {
  const int32_t input[] = {0};
  Scanner scanner = {
    .position = 2,
    .content_end = 3,
    .equals = 1,
    .key_end = 1,
    .kind = PAIR_LINE
  };
  struct MockLexer mock;
  init_mock_lexer(&mock, input, 1);
  const bool valid_symbols[ERROR_SENTINEL + 1] = {[VALUE_TEXT] = true};
  assert(!mock_eof(&mock.lexer));
  assert(tree_sitter_editorconfig_external_scanner_scan(
    &scanner,
    &mock.lexer,
    valid_symbols
  ));
  assert(mock.lexer.result_symbol == VALUE_TEXT);
  assert(mock.mark == 1);
  assert(scanner.position == 3);
}

#ifdef TREE_SITTER_REUSE_ALLOCATOR
static void test_reuse_allocator_failure_and_cleanup(void) {
  assert(reuse_live_allocations == 0);
  reuse_fail_next_calloc = true;
  assert(tree_sitter_editorconfig_external_scanner_create() == NULL);
  assert(!reuse_fail_next_calloc);
  void *scanner = tree_sitter_editorconfig_external_scanner_create();
  assert(scanner != NULL);
  assert(reuse_live_allocations == 1);
  tree_sitter_editorconfig_external_scanner_destroy(scanner);
  assert(reuse_live_allocations == 0);
}
#endif

int main(void) {
  test_builtin_lexer_accepts_only_physical_eof();
  test_lifecycle_and_serialization_round_trip();
  test_disabled_and_recovery_scans_preserve_state();
  test_restored_pair_state_preserves_token_ranges();
  test_escape_issues_distinguish_closed_boundaries_from_eof();
  test_nul_is_value_content_and_not_eof();
#ifdef TREE_SITTER_REUSE_ALLOCATOR
  test_reuse_allocator_failure_and_cleanup();
#endif
  return 0;
}

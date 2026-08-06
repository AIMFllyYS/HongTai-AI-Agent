package com.hongtai.aiagent.storage

/** Splits the v1 asset safely enough for SQLite string literals. */
object SqlStatementSplitter {
  fun split(script: String): List<String> {
    val statements = mutableListOf<String>()
    val current = StringBuilder()
    var quote: Char? = null
    var escaped = false

    script.forEach { character ->
      when {
        quote != null -> {
          current.append(character)
          if (escaped) {
            escaped = false
          } else if (character == '\\') {
            escaped = true
          } else if (character == quote) {
            quote = null
          }
        }
        character == '\'' || character == '"' -> {
          quote = character
          current.append(character)
        }
        character == ';' -> {
          current.toString().trim().takeIf { it.isNotEmpty() }?.let(statements::add)
          current.clear()
        }
        else -> current.append(character)
      }
    }
    current.toString().trim().takeIf { it.isNotEmpty() }?.let(statements::add)
    return statements
  }
}

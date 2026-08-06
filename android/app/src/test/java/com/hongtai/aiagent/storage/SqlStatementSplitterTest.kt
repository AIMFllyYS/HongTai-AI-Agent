package com.hongtai.aiagent.storage

import org.junit.Assert.assertEquals
import org.junit.Test

class SqlStatementSplitterTest {
  @Test
  fun `preserves semicolons inside quoted SQL values`() {
    assertEquals(
      listOf(
        "INSERT INTO notes(value) VALUES ('a;b')",
        "CREATE TABLE sample(id TEXT)",
      ),
      SqlStatementSplitter.split(
        "INSERT INTO notes(value) VALUES ('a;b'); CREATE TABLE sample(id TEXT);",
      ),
    )
  }
}

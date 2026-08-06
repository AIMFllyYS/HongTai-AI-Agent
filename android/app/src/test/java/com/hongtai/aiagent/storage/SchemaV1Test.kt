package com.hongtai.aiagent.storage

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Test

/** JVM-only contract check for the deliberately small encrypted local schema. */
class SchemaV1Test {
  @Test
  fun `contains exactly tables backing real local capabilities`() {
    val expected = setOf(
      "schema_migrations",
      "profiles",
      "ai_connections",
      "tasks",
      "task_events",
      "content_analyses",
      "diagnosis_sessions",
      "diagnosis_messages",
    )

    assertEquals(expected, SchemaV1.tableNames)
    assertFalse("assets" in SchemaV1.tableNames)
    assertFalse("publishes" in SchemaV1.tableNames)
    assertFalse("creations" in SchemaV1.tableNames)
  }
}

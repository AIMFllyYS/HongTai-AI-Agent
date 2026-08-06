package com.hongtai.aiagent.storage

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class SecureStorageException(message: String, cause: Throwable? = null) : RuntimeException(message, cause)

/**
 * Stores encrypted values in app-private SharedPreferences. Each AES key lives
 * only in Android Keystore; callers can write/check/delete secrets but no
 * Capacitor method can read one back into the WebView.
 */
class AndroidKeystoreSecretStore(context: Context) {
  private val appContext = context.applicationContext
  private val preferences = appContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE)

  fun writeActiveAiConnectionSecret(value: String) {
    require(value.isNotBlank()) { "API Key must not be blank." }
    write(SLOT_ACTIVE_AI_CONNECTION, value)
  }

  fun hasActiveAiConnectionSecret(): Boolean = preferences.contains(storageKey(SLOT_ACTIVE_AI_CONNECTION))

  fun removeActiveAiConnectionSecret() {
    if (!preferences.edit().remove(storageKey(SLOT_ACTIVE_AI_CONNECTION)).commit()) {
      throw SecureStorageException("Could not remove the protected AI connection secret.")
    }
  }

  /** For native transports only. Do not expose this through a Capacitor plugin. */
  internal fun <T> withActiveAiConnectionSecret(block: (CharArray) -> T): T {
    val plaintext = decrypt(SLOT_ACTIVE_AI_CONNECTION).toCharArray()
    return try {
      block(plaintext)
    } finally {
      plaintext.fill('\u0000')
    }
  }

  /**
   * Supplies a SQLCipher passphrase only to native storage code. When a
   * database already exists, a missing protected passphrase is terminal: we do
   * not generate a replacement key, clear the DB, or create an empty database.
   */
  internal fun <T> withSqlCipherPassphrase(
    existingDatabase: Boolean,
    block: (CharArray) -> T,
  ): T {
    val plaintext = when (
      SqlCipherPassphrasePolicy.actionFor(
        existingDatabase = existingDatabase,
        protectedPassphraseExists = preferences.contains(storageKey(SLOT_SQLCIPHER_DATABASE)),
      )
    ) {
      SqlCipherPassphraseAction.USE_EXISTING -> decrypt(SLOT_SQLCIPHER_DATABASE)
      SqlCipherPassphraseAction.CREATE -> generateSqlCipherPassphrase().also {
        write(SLOT_SQLCIPHER_DATABASE, it)
      }
      SqlCipherPassphraseAction.FAIL_KEY_MISSING -> throw LocalStorageException(
        LocalStorageErrorCode.KEY_MISSING_FOR_EXISTING_DATABASE,
        "The Android Keystore key for the existing encrypted database is unavailable.",
      )
    }.toCharArray()

    return try {
      block(plaintext)
    } finally {
      plaintext.fill('\u0000')
    }
  }

  private fun write(slot: String, value: String) {
    val cipher = Cipher.getInstance(TRANSFORMATION)
    cipher.init(Cipher.ENCRYPT_MODE, keyFor(slot))
    val encrypted = cipher.doFinal(value.toByteArray(StandardCharsets.UTF_8))
    val encoded = listOf(
      Base64.encodeToString(cipher.iv, Base64.NO_WRAP),
      Base64.encodeToString(encrypted, Base64.NO_WRAP),
    ).joinToString(SEPARATOR)
    if (!preferences.edit().putString(storageKey(slot), encoded).commit()) {
      throw SecureStorageException("Could not persist the protected AI connection secret.")
    }
  }

  private fun decrypt(slot: String): String {
    val encoded = preferences.getString(storageKey(slot), null)
      ?: throw SecureStorageException("The protected secret is not configured.")
    val parts = encoded.split(SEPARATOR)
    if (parts.size != 2) {
      throw SecureStorageException("The protected secret is malformed.")
    }
    return try {
      val iv = Base64.decode(parts[0], Base64.NO_WRAP)
      val ciphertext = Base64.decode(parts[1], Base64.NO_WRAP)
      val cipher = Cipher.getInstance(TRANSFORMATION)
      cipher.init(Cipher.DECRYPT_MODE, keyFor(slot), GCMParameterSpec(GCM_TAG_LENGTH_BITS, iv))
      String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8)
    } catch (error: Exception) {
      throw SecureStorageException("Could not decrypt the protected secret.", error)
    }
  }

  private fun generateSqlCipherPassphrase(): String {
    val bytes = ByteArray(SQLCIPHER_PASSPHRASE_BYTES)
    SecureRandom().nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.NO_WRAP or Base64.URL_SAFE)
  }

  private fun keyFor(slot: String): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    val alias = "$KEY_ALIAS_PREFIX$slot"
    val existing = keyStore.getKey(alias, null) as? SecretKey
    if (existing != null) return existing

    return try {
      KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE).apply {
        init(
          KeyGenParameterSpec.Builder(alias, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .setKeySize(256)
            .build(),
        )
      }.generateKey()
    } catch (error: Exception) {
      throw SecureStorageException("Could not obtain the Android Keystore key.", error)
    }
  }

  private fun storageKey(slot: String): String = "encrypted.$slot"

  private companion object {
    const val PREFERENCES_NAME = "hongtai.secure.settings.v1"
    const val SLOT_ACTIVE_AI_CONNECTION = "active-ai-connection"
    const val SLOT_SQLCIPHER_DATABASE = "sqlcipher-database"
    const val KEY_ALIAS_PREFIX = "com.hongtai.aiagent.secret."
    const val ANDROID_KEYSTORE = "AndroidKeyStore"
    const val TRANSFORMATION = "AES/GCM/NoPadding"
    const val GCM_TAG_LENGTH_BITS = 128
    const val SQLCIPHER_PASSPHRASE_BYTES = 32
    const val SEPARATOR = "."
  }
}

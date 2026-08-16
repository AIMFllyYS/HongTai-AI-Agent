package com.hongtai.aiagent.bridge

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.ClipData
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import androidx.activity.result.ActivityResult
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.media.PhotoOperationAwaitingResult
import com.hongtai.aiagent.media.PhotoOperationFailed
import com.hongtai.aiagent.media.PhotoOperationImporting
import com.hongtai.aiagent.media.PhotoOperationKind
import com.hongtai.aiagent.media.PhotoOperationStateStore
import com.hongtai.aiagent.media.PhotoOperationSucceeded
import com.hongtai.aiagent.media.PhotoOperationTerminal
import com.hongtai.aiagent.media.PrivateImageInvalidException
import com.hongtai.aiagent.media.PrivateMediaFile
import com.hongtai.aiagent.media.PrivateMediaReadException
import com.hongtai.aiagent.media.PrivateMediaStore
import com.hongtai.aiagent.media.PrivateMediaTooLargeException
import com.hongtai.aiagent.media.TaskVideoImportStore
import com.hongtai.aiagent.media.VideoOperationAwaitingResult
import com.hongtai.aiagent.media.VideoOperationFailed
import com.hongtai.aiagent.media.VideoOperationImporting
import com.hongtai.aiagent.media.VideoOperationStateStore
import com.hongtai.aiagent.media.VideoOperationSucceeded
import com.hongtai.aiagent.media.VideoOperationTerminal
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.RejectedExecutionException

@CapacitorPlugin(name = "FileMedia")
class FileMediaPlugin : Plugin() {
  private val mediaStore: PrivateMediaStore by lazy { PrivateMediaStore(context) }
  private val photoOperations: PhotoOperationStateStore by lazy { PhotoOperationStateStore(context) }
  private val videoOperations: VideoOperationStateStore by lazy { VideoOperationStateStore(context) }
  private val taskVideos: TaskVideoImportStore by lazy { TaskVideoImportStore(context) }
  private val scheduledOperations = ConcurrentHashMap.newKeySet<String>()
  private var photoOriginalCall: PluginCall? = null
  private var videoOriginalCall: PluginCall? = null
  private var recoveryConsumerCall: PluginCall? = null
  private var videoRecoveryConsumerCall: PluginCall? = null

  override fun load() {
    super.load()
    resumePersistedImport()
    resumePersistedVideoImport()
  }

  override fun handleOnResume() {
    super.handleOnResume()
    val awaiting = photoOperations.current() as? PhotoOperationAwaitingResult
    if (awaiting != null) {
      if (awaiting.kind == PhotoOperationKind.CAPTURE) {
        awaiting.captureFileName?.let(mediaStore::restorePhotoCapture)?.let(mediaStore::discardCapture)
      }
      finishFailure(null, awaiting.operationId, NativeIssueCode.PHOTO_RECOVERY_FAILED)
    }
    val videoAwaiting = videoOperations.current() as? VideoOperationAwaitingResult ?: return
    finishVideoFailure(null, videoAwaiting.operationId, NativeIssueCode.VIDEO_RECOVERY_FAILED)
  }

  @PluginMethod
  fun pickPhoto(call: PluginCall) {
    val operation = try {
      photoOperations.beginPicker()
    } catch (error: Exception) {
      call.reject("Another photo operation must finish first.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      return
    }
    photoOriginalCall = call
    try {
      startActivityForResult(call, imagePickerIntent(), "onPhotoPicked")
    } catch (error: ActivityNotFoundException) {
      finishFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    } catch (error: Exception) {
      finishFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    }
  }

  @PluginMethod
  fun capturePhoto(call: PluginCall) {
    if (photoOperations.current() != null) {
      call.reject("Another photo operation must finish first.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    val capture = try {
      mediaStore.createPhotoCapture()
    } catch (error: Exception) {
      call.reject("Could not prepare private camera storage.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      return
    }
    val operation = try {
      photoOperations.beginCapture(capture.file.name)
    } catch (error: Exception) {
      mediaStore.discardCapture(capture)
      call.reject("Could not persist the camera operation.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      return
    }
    photoOriginalCall = call
    val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
      .putExtra(MediaStore.EXTRA_OUTPUT, capture.uri)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    intent.clipData = ClipData.newRawUri("captured-photo", capture.uri)
    if (intent.resolveActivity(context.packageManager) == null) {
      mediaStore.discardCapture(capture)
      finishFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    try {
      startActivityForResult(call, intent, "onPhotoCaptured")
    } catch (error: ActivityNotFoundException) {
      mediaStore.discardCapture(capture)
      finishFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    } catch (error: Exception) {
      mediaStore.discardCapture(capture)
      finishFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    }
  }

  @PluginMethod
  fun pickVideo(call: PluginCall) {
    val taskId = call.getString("taskId")
    if (taskId.isNullOrBlank()) {
      call.reject("taskId is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    val operation = try {
      videoOperations.begin(taskId)
    } catch (error: Exception) {
      call.reject("Another video operation must finish first.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      return
    }
    videoOriginalCall = call
    val intent = Intent(Intent.ACTION_OPEN_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType("video/mp4")
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
    try {
      startActivityForResult(call, intent, "onVideoPicked")
    } catch (error: ActivityNotFoundException) {
      finishVideoFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    } catch (error: Exception) {
      finishVideoFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    }
  }

  @ActivityCallback
  private fun onVideoPicked(call: PluginCall?, result: ActivityResult) {
    val operation = videoOperations.current() as? VideoOperationAwaitingResult
    if (operation == null) {
      finishOrphanedVideoFailure(call, NativeIssueCode.VIDEO_RECOVERY_FAILED)
      return
    }
    if (result.resultCode != Activity.RESULT_OK) {
      finishVideoFailure(call, operation.operationId, NativeIssueCode.MEDIA_SELECTION_CANCELLED)
      return
    }
    val sourceUri = result.data?.data
    if (sourceUri == null) {
      finishVideoFailure(call, operation.operationId, NativeIssueCode.MEDIA_SOURCE_MISSING)
      return
    }
    try {
      persistPickerReadPermission(sourceUri)
    } catch (error: PhotoOperationImportException) {
      finishVideoFailure(call, operation.operationId, error.nativeCode, error)
      return
    }
    val importing = videoOperations.markImporting(operation.operationId, sourceUri.toString())
    if (importing == null) {
      releasePickerReadPermission(sourceUri.toString())
      finishVideoFailure(call, operation.operationId, NativeIssueCode.VIDEO_RECOVERY_FAILED)
      return
    }
    submitVideoImport(call, importing)
  }

  @ActivityCallback
  private fun onPhotoPicked(call: PluginCall?, result: ActivityResult) {
    val operation = photoOperations.current() as? PhotoOperationAwaitingResult
    if (operation?.kind != PhotoOperationKind.PICKER) {
      finishOrphanedFailure(call, PhotoOperationKind.PICKER, NativeIssueCode.PHOTO_RECOVERY_FAILED)
      return
    }
    if (result.resultCode != Activity.RESULT_OK) {
      finishFailure(call, operation.operationId, NativeIssueCode.MEDIA_SELECTION_CANCELLED)
      return
    }
    val sourceUri = result.data?.data
    if (sourceUri == null) {
      finishFailure(call, operation.operationId, NativeIssueCode.MEDIA_SOURCE_MISSING)
      return
    }
    try {
      persistPickerReadPermission(sourceUri)
    } catch (error: PhotoOperationImportException) {
      finishFailure(call, operation.operationId, error.nativeCode, error)
      return
    }
    val importing = photoOperations.markPickerImporting(operation.operationId, sourceUri.toString())
    if (importing == null) {
      releasePickerReadPermission(sourceUri.toString())
      finishFailure(call, operation.operationId, NativeIssueCode.PHOTO_RECOVERY_FAILED)
      return
    }
    submitImport(call, importing)
  }

  @ActivityCallback
  private fun onPhotoCaptured(call: PluginCall?, result: ActivityResult) {
    val operation = photoOperations.current() as? PhotoOperationAwaitingResult
    if (operation?.kind != PhotoOperationKind.CAPTURE) {
      finishOrphanedFailure(call, PhotoOperationKind.CAPTURE, NativeIssueCode.PHOTO_RECOVERY_FAILED)
      return
    }
    val capture = operation.captureFileName?.let(mediaStore::restorePhotoCapture)
    if (result.resultCode != Activity.RESULT_OK) {
      capture?.let(mediaStore::discardCapture)
      finishFailure(call, operation.operationId, NativeIssueCode.MEDIA_SELECTION_CANCELLED)
      return
    }
    if (capture == null || capture.file.length() <= 0L) {
      capture?.let(mediaStore::discardCapture)
      finishFailure(call, operation.operationId, NativeIssueCode.PHOTO_CAPTURE_LOST)
      return
    }
    val importing = photoOperations.markCaptureImporting(operation.operationId)
    if (importing == null) {
      mediaStore.discardCapture(capture)
      finishFailure(call, operation.operationId, NativeIssueCode.PHOTO_RECOVERY_FAILED)
      return
    }
    submitImport(call, importing)
  }

  /** A rebuilt WebView creates this new Promise to consume one persisted terminal result. */
  @PluginMethod
  fun consumePhotoOperation(call: PluginCall) {
    when (val state = photoOperations.current()) {
      null -> call.resolve(JSObject().put("status", "none"))
      is PhotoOperationTerminal -> {
        val terminal = photoOperations.consumeTerminal()
        if (terminal == null) call.reject("Could not consume the recovered photo operation.", NativeIssueCode.PHOTO_RECOVERY_FAILED)
        else call.resolve(recoveryResult(terminal))
      }
      else -> {
        if (isLiveOriginalCall(photoOriginalCall)) {
          call.resolve(JSObject().put("status", "none"))
          return
        }
        if (recoveryConsumerCall != null) {
          call.reject("A photo recovery consumer is already waiting.", NativeIssueCode.INVALID_ARGUMENT)
          return
        }
        recoveryConsumerCall = call
        if (state is PhotoOperationImporting) resumePersistedImport()
      }
    }
  }

  @PluginMethod
  fun consumeVideoOperation(call: PluginCall) {
    when (val state = videoOperations.current()) {
      null -> call.resolve(JSObject().put("status", "none"))
      is VideoOperationTerminal -> {
        val terminal = videoOperations.consumeTerminal()
        if (terminal == null) call.reject("Could not consume the recovered video operation.", NativeIssueCode.VIDEO_RECOVERY_FAILED)
        else call.resolve(videoRecoveryResult(terminal))
      }
      else -> {
        if (isLiveOriginalCall(videoOriginalCall)) {
          call.resolve(JSObject().put("status", "none"))
          return
        }
        if (videoRecoveryConsumerCall != null) {
          call.reject("A video recovery consumer is already waiting.", NativeIssueCode.INVALID_ARGUMENT)
          return
        }
        videoRecoveryConsumerCall = call
        if (state is VideoOperationImporting) resumePersistedVideoImport()
      }
    }
  }

  @PluginMethod
  fun copyFromUri(call: PluginCall) {
    val sourceUri = call.getString("sourceUri")
    if (sourceUri.isNullOrBlank()) {
      call.reject("sourceUri is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    try {
      PHOTO_IMPORT_EXECUTOR.execute {
        importAndResolve(call, Uri.parse(sourceUri), call.getString("displayName"))
      }
    } catch (error: RejectedExecutionException) {
      call.reject("The private media import queue is unavailable.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    }
  }

  private fun resumePersistedImport() {
    val importing = photoOperations.current() as? PhotoOperationImporting ?: return
    submitImport(null, importing)
  }

  private fun resumePersistedVideoImport() {
    val importing = videoOperations.current() as? VideoOperationImporting ?: return
    submitVideoImport(null, importing)
  }

  private fun submitVideoImport(call: PluginCall?, operation: VideoOperationImporting) {
    if (!scheduledOperations.add(operation.operationId)) return
    try {
      VIDEO_IMPORT_EXECUTOR.execute {
        try {
          val sourceUri = Uri.parse(operation.sourceUri)
          val imported = taskVideos.import(operation.taskId, sourceUri)
          val terminal = videoOperations.complete(operation.operationId, imported)
            ?: videoOperations.current() as? VideoOperationTerminal
          terminal?.let { finishVideoTerminal(call, it) }
        } catch (error: Exception) {
          finishVideoFailure(call, operation.operationId, videoNativeCodeFor(error), error)
        } finally {
          releasePickerReadPermission(operation.sourceUri)
          scheduledOperations.remove(operation.operationId)
        }
      }
    } catch (error: RejectedExecutionException) {
      scheduledOperations.remove(operation.operationId)
      finishVideoFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    }
  }

  private fun submitImport(call: PluginCall?, operation: PhotoOperationImporting) {
    if (!scheduledOperations.add(operation.operationId)) return
    try {
      PHOTO_IMPORT_EXECUTOR.execute {
        try {
          val imported = when (operation.kind) {
            PhotoOperationKind.PICKER -> {
              val sourceUri = operation.sourceUri?.let(Uri::parse)
                ?: throw PhotoOperationImportException(NativeIssueCode.MEDIA_SOURCE_MISSING)
              mediaStore.importFrom(sourceUri)
            }
            PhotoOperationKind.CAPTURE -> {
              val capture = operation.captureFileName?.let(mediaStore::restorePhotoCapture)
                ?: throw PhotoOperationImportException(NativeIssueCode.PHOTO_CAPTURE_LOST)
              if (capture.file.length() <= 0L) {
                mediaStore.discardCapture(capture)
                throw PhotoOperationImportException(NativeIssueCode.PHOTO_CAPTURE_LOST)
              }
              mediaStore.importCaptured(capture)
            }
          }
          val terminal = photoOperations.complete(operation.operationId, imported)
            ?: photoOperations.current() as? PhotoOperationTerminal
          terminal?.let { finishTerminal(call, it) }
        } catch (error: Exception) {
          finishFailure(call, operation.operationId, nativeCodeFor(error), error)
        } finally {
          if (operation.kind == PhotoOperationKind.PICKER) releasePickerReadPermission(operation.sourceUri)
          scheduledOperations.remove(operation.operationId)
        }
      }
    } catch (error: RejectedExecutionException) {
      scheduledOperations.remove(operation.operationId)
      finishFailure(call, operation.operationId, NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    }
  }

  private fun importAndResolve(call: PluginCall, uri: Uri, displayName: String?) {
    try {
      call.resolve(mediaFileResult(mediaStore.importFrom(uri, displayName)))
    } catch (error: Exception) {
      val code = nativeCodeFor(error)
      call.reject(messageFor(code), code, error)
    }
  }

  private fun persistPickerReadPermission(sourceUri: Uri) {
    try {
      context.contentResolver.takePersistableUriPermission(sourceUri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: SecurityException) {
      throw PhotoOperationImportException(NativeIssueCode.MEDIA_READ_FAILED)
    } catch (_: IllegalArgumentException) {
      throw PhotoOperationImportException(NativeIssueCode.MEDIA_READ_FAILED)
    }
  }

  private fun releasePickerReadPermission(sourceUri: String?) {
    val uri = sourceUri?.let(Uri::parse) ?: return
    try {
      context.contentResolver.releasePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (_: SecurityException) {
      // The permission can be absent after an interrupted import; the terminal state is already persisted.
    } catch (_: IllegalArgumentException) {
      // A malformed persisted URI cannot be released and must not block terminal cleanup.
    }
  }

  private fun finishOrphanedFailure(call: PluginCall?, kind: PhotoOperationKind, code: String) {
    val terminal = photoOperations.failOrphaned(kind, code) ?: photoOperations.current() as? PhotoOperationTerminal
    terminal?.let { finishTerminal(call, it) }
  }

  private fun finishOrphanedVideoFailure(call: PluginCall?, code: String) {
    val terminal = videoOperations.failOrphaned(code) ?: videoOperations.current() as? VideoOperationTerminal
    terminal?.let { finishVideoTerminal(call, it) }
  }

  private fun finishVideoFailure(call: PluginCall?, operationId: String, code: String, cause: Exception? = null) {
    val terminal = videoOperations.fail(operationId, code) ?: videoOperations.current() as? VideoOperationTerminal
    terminal?.let { finishVideoTerminal(call, it, cause) }
  }

  private fun finishVideoTerminal(call: PluginCall?, terminal: VideoOperationTerminal, cause: Exception? = null) {
    videoOriginalCall = null
    if (isLiveOriginalCall(call)) {
      val consumed = videoOperations.consumeTerminal() ?: return
      when (consumed) {
        is VideoOperationSucceeded -> call?.resolve(videoFileResult(consumed))
        is VideoOperationFailed -> call?.reject(videoMessageFor(consumed.code), consumed.code, cause)
      }
      return
    }
    deliverRecoveredVideoTerminal()
  }

  private fun deliverRecoveredVideoTerminal() {
    val consumer = videoRecoveryConsumerCall ?: return
    val terminal = videoOperations.consumeTerminal() ?: return
    videoRecoveryConsumerCall = null
    consumer.resolve(videoRecoveryResult(terminal))
  }

  private fun finishFailure(call: PluginCall?, operationId: String, code: String, cause: Exception? = null) {
    val terminal = photoOperations.fail(operationId, code) ?: photoOperations.current() as? PhotoOperationTerminal
    terminal?.let { finishTerminal(call, it, cause) }
  }

  private fun finishTerminal(call: PluginCall?, terminal: PhotoOperationTerminal, cause: Exception? = null) {
    photoOriginalCall = null
    if (isLiveOriginalCall(call)) {
      val consumed = photoOperations.consumeTerminal() ?: return
      when (consumed) {
        is PhotoOperationSucceeded -> call?.resolve(mediaFileResult(consumed))
        is PhotoOperationFailed -> call?.reject(messageFor(consumed.code), consumed.code, cause)
      }
      return
    }
    deliverRecoveredTerminal()
  }

  private fun deliverRecoveredTerminal() {
    val consumer = recoveryConsumerCall ?: return
    val terminal = photoOperations.consumeTerminal() ?: return
    recoveryConsumerCall = null
    consumer.resolve(recoveryResult(terminal))
  }

  private fun isLiveOriginalCall(call: PluginCall?): Boolean = call != null &&
    call.callbackId != PluginCall.CALLBACK_ID_DANGLING

  private fun nativeCodeFor(error: Exception): String = when (error) {
    is PhotoOperationImportException -> error.nativeCode
    is PrivateMediaTooLargeException -> NativeIssueCode.IMAGE_TOO_LARGE
    is PrivateImageInvalidException -> NativeIssueCode.IMAGE_INVALID
    is PrivateMediaReadException -> NativeIssueCode.MEDIA_READ_FAILED
    else -> NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED
  }

  private fun messageFor(code: String): String = when (code) {
    NativeIssueCode.MEDIA_SELECTION_CANCELLED -> "The photo operation was cancelled."
    NativeIssueCode.MEDIA_SOURCE_MISSING -> "The selected photo did not provide a URI."
    NativeIssueCode.PHOTO_CAPTURE_LOST -> "The captured photo could not be recovered."
    NativeIssueCode.PHOTO_RECOVERY_FAILED -> "The photo operation could not be recovered."
    NativeIssueCode.MEDIA_READ_FAILED -> "The selected photo could not be read."
    NativeIssueCode.IMAGE_TOO_LARGE -> "The selected image exceeds the supported size limit."
    NativeIssueCode.IMAGE_INVALID -> "The selected file is not a supported image."
    else -> "Could not import the selected photo into private storage."
  }

  private fun videoNativeCodeFor(error: Exception): String = when (error) {
    is PhotoOperationImportException -> error.nativeCode
    is PrivateMediaReadException -> NativeIssueCode.MEDIA_READ_FAILED
    else -> NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED
  }

  private fun videoMessageFor(code: String): String = when (code) {
    NativeIssueCode.MEDIA_SELECTION_CANCELLED -> "The video selection was cancelled."
    NativeIssueCode.MEDIA_SOURCE_MISSING -> "The selected video did not provide a URI."
    NativeIssueCode.VIDEO_RECOVERY_FAILED -> "The video operation could not be recovered."
    NativeIssueCode.MEDIA_READ_FAILED -> "The selected video could not be read."
    else -> "Could not import the selected video into private storage."
  }

  private fun videoFileResult(file: VideoOperationSucceeded): JSObject = JSObject()
    .put("uri", file.uri)
    .put("mimeType", file.mimeType)
    .put("displayName", file.displayName)
    .put("sizeBytes", file.sizeBytes)
    .put("durationSeconds", file.durationSeconds)

  private fun videoRecoveryResult(terminal: VideoOperationTerminal): JSObject = when (terminal) {
    is VideoOperationSucceeded -> videoFileResult(terminal)
      .put("status", "succeeded")
      .put("taskId", terminal.taskId)
    is VideoOperationFailed -> JSObject()
      .put("status", "failed")
      .put("code", terminal.code)
  }

  private fun recoveryResult(terminal: PhotoOperationTerminal): JSObject = when (terminal) {
    is PhotoOperationSucceeded -> mediaFileResult(terminal)
      .put("status", "succeeded")
      .put("origin", if (terminal.kind == PhotoOperationKind.CAPTURE) "captured" else "imported")
    is PhotoOperationFailed -> JSObject()
      .put("status", "failed")
      .put("code", terminal.code)
  }

  private fun imagePickerIntent(): Intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
    Intent(MediaStore.ACTION_PICK_IMAGES)
  } else {
    Intent(Intent.ACTION_OPEN_DOCUMENT)
      .addCategory(Intent.CATEGORY_OPENABLE)
      .setType("image/*")
  }

  private fun mediaFileResult(file: PrivateMediaFile): JSObject = JSObject()
    .put("uri", file.uri)
    .put("mimeType", file.mimeType)
    .put("sizeBytes", file.sizeBytes)

  private fun mediaFileResult(file: PhotoOperationSucceeded): JSObject = JSObject()
    .put("uri", file.uri)
    .put("mimeType", file.mimeType)
    .put("sizeBytes", file.sizeBytes)

  private class PhotoOperationImportException(val nativeCode: String) : IllegalStateException(nativeCode)

  private companion object {
    val PHOTO_IMPORT_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "hongtai-photo-import").apply { isDaemon = true }
    }
    val VIDEO_IMPORT_EXECUTOR = Executors.newSingleThreadExecutor { runnable ->
      Thread(runnable, "hongtai-video-import").apply { isDaemon = true }
    }
  }
}

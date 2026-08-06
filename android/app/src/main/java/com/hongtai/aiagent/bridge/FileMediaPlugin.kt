package com.hongtai.aiagent.bridge

import android.app.Activity
import android.content.ClipData
import androidx.activity.result.ActivityResult
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.MediaStore
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import com.hongtai.aiagent.media.PrivateMediaFile
import com.hongtai.aiagent.media.PrivateMediaStore

@CapacitorPlugin(name = "FileMedia")
class FileMediaPlugin : Plugin() {
  private val mediaStore: PrivateMediaStore by lazy { PrivateMediaStore(context) }
  private var pendingPhotoCapture: com.hongtai.aiagent.media.PendingPhotoCapture? = null

  @PluginMethod
  fun pickPhoto(call: PluginCall) {
    startActivityForResult(call, imagePickerIntent(), "onPhotoPicked")
  }

  /** Uses the system camera and immediately copies the result into private storage. */
  @PluginMethod
  fun capturePhoto(call: PluginCall) {
    if (pendingPhotoCapture != null) {
      call.reject("Another photo capture is already in progress.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    val capture = try {
      mediaStore.createPhotoCapture()
    } catch (error: Exception) {
      call.reject("Could not prepare private camera storage.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
      return
    }
    val intent = Intent(MediaStore.ACTION_IMAGE_CAPTURE)
      .putExtra(MediaStore.EXTRA_OUTPUT, capture.uri)
      .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
    intent.clipData = ClipData.newRawUri("captured-photo", capture.uri)
    if (intent.resolveActivity(context.packageManager) == null) {
      mediaStore.discardCapture(capture)
      call.reject("No system camera is available.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    pendingPhotoCapture = capture
    startActivityForResult(call, intent, "onPhotoCaptured")
  }

  @ActivityCallback
  private fun onPhotoPicked(call: PluginCall?, result: ActivityResult) {
    if (call == null) return
    if (result.resultCode != Activity.RESULT_OK) {
      call.reject("No photo was selected.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    val sourceUri = result.data?.data
    if (sourceUri == null) {
      call.reject("The selected photo did not provide a URI.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    copyAndResolve(call, sourceUri, null)
  }

  @ActivityCallback
  private fun onPhotoCaptured(call: PluginCall?, result: ActivityResult) {
    val capture = pendingPhotoCapture
    pendingPhotoCapture = null
    if (call == null || capture == null) return
    if (result.resultCode != Activity.RESULT_OK) {
      mediaStore.discardCapture(capture)
      call.reject("No photo was captured.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED)
      return
    }
    try {
      call.resolve(mediaFileResult(mediaStore.importCaptured(capture)))
    } catch (error: Exception) {
      call.reject("Could not import the captured photo into private storage.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    }
  }

  @PluginMethod
  fun copyFromUri(call: PluginCall) {
    val sourceUri = call.getString("sourceUri")
    if (sourceUri.isNullOrBlank()) {
      call.reject("sourceUri is required.", NativeIssueCode.INVALID_ARGUMENT)
      return
    }
    copyAndResolve(call, Uri.parse(sourceUri), call.getString("displayName"))
  }

  private fun copyAndResolve(call: PluginCall, uri: Uri, displayName: String?) {
    try {
      call.resolve(mediaFileResult(mediaStore.importFrom(uri, displayName)))
    } catch (error: Exception) {
      call.reject("Could not import the selected media into private storage.", NativeIssueCode.PRIVATE_FILE_IMPORT_FAILED, error)
    }
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
}

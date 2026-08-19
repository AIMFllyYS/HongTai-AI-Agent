package com.hongtai.aiagent.production

/**
 * Decides whether a production asset picker that is still `AwaitingResult` should be failed when
 * the host Activity resumes.
 *
 * The picker is launched with Capacitor `startActivityForResult`. Returning from that Activity
 * always resumes the host first and delivers `onAssetsPicked` afterwards. Failing the operation
 * in `onResume` with a null Capacitor call drops the original JS promise: `busy` never clears,
 * and a later success callback sees a terminal state and treats a real pick as recovery failure.
 *
 * A live original call therefore must keep waiting. A dangling call means the WebView died;
 * mark the pick failed so `consumeAssetOperation` can unblock the next page.
 */
internal object AssetPickerResumePolicy {
  fun shouldFailAwaitingPicker(originalCallLive: Boolean): Boolean = !originalCallLive
}

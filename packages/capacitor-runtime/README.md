# Capacitor runtime contracts

This package owns only the versioned TypeScript boundary for the local Android
runtime. The React application supplies Capacitor's `registerPlugin` function;
this package deliberately does not import it, so shared application logic stays
testable outside a WebView.

`SecureSettingsNativePlugin` has write, existence, and delete operations only.
There is intentionally no secret-read API. Kotlin reads a secret only inside a
native request path after the Android Keystore has decrypted it.

`NativeNetwork` and `MediaRuntime` are declared here before their phase-5
implementations. Until then their native methods return a stable not-ready error
instead of fabricated media, stream events, or successful downloads.

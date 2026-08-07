plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

android {
  namespace = "com.hongtai.aiagent"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.hongtai.aiagent"
    minSdk = 24
    targetSdk = 36
    versionCode = 2
    versionName = "0.2.0"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(
        getDefaultProguardFile("proguard-android-optimize.txt"),
        "proguard-rules.pro",
      )
    }
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_21
    targetCompatibility = JavaVersion.VERSION_21
  }

  kotlinOptions {
    jvmTarget = "21"
  }
}

dependencies {
  // `cap sync` generates this project from the same @capacitor/android v8
  // package locked in pnpm; do not hard-code an unrelated Maven version.
  implementation(project(":capacitor-android"))
  implementation("androidx.core:core-ktx:1.16.0")
  // Capacitor v8 BridgeActivity extends AppCompatActivity directly.
  implementation("androidx.appcompat:appcompat:1.7.1")

  // Phase 5 owns the concrete transformer/media-codec implementation. All Media3
  // modules must remain on one version.
  implementation("androidx.media3:media3-common:1.10.1")
  implementation("androidx.media3:media3-effect:1.10.1")
  implementation("androidx.media3:media3-transformer:1.10.1")

  testImplementation("junit:junit:4.13.2")
  // Android ships org.json at runtime; local JVM unit tests need a concrete
  // implementation instead of the android.jar method stubs.
  testImplementation("org.json:json:20240303")
  androidTestImplementation("androidx.test.ext:junit:1.2.1")
  androidTestImplementation("androidx.test.espresso:espresso-core:3.7.0")
}

apply(from = "capacitor.build.gradle")

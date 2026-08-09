import java.io.File
import java.util.Properties
import org.gradle.api.Action
import org.gradle.api.execution.TaskExecutionGraph

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

val releaseSigningPath = providers.environmentVariable("HONGTAI_RELEASE_SIGNING_PROPERTIES").orNull
val releaseSigningFile = releaseSigningPath?.let(::file)
val repositoryRootDirectory = rootProject.projectDir.parentFile.canonicalFile

fun isInsideRepository(candidate: File): Boolean {
  val repositoryPath = repositoryRootDirectory.path.trimEnd('\\', '/')
  val candidatePath = candidate.canonicalFile.path.trimEnd('\\', '/')
  return candidatePath.equals(repositoryPath, ignoreCase = true) ||
    candidatePath.startsWith("$repositoryPath${File.separator}", ignoreCase = true)
}

if (releaseSigningFile != null) {
  if (!releaseSigningFile.isAbsolute || !releaseSigningFile.isFile) {
    throw GradleException(
      "Release signing configuration must be an existing absolute file",
    )
  }
  if (isInsideRepository(releaseSigningFile)) {
    throw GradleException("Release signing configuration must be outside the repository")
  }
}

val releaseSigning = Properties()
if (releaseSigningFile != null) {
  releaseSigningFile.inputStream().use(releaseSigning::load)
}

fun requiredReleaseSigningValue(name: String): String =
  releaseSigning.getProperty(name)?.takeIf(String::isNotBlank)
    ?: throw GradleException("Release signing configuration is missing required field: $name")

android {
  namespace = "com.hongtai.aiagent"
  compileSdk = 36

  defaultConfig {
    applicationId = "com.hongtai.aiagent"
    minSdk = 24
    targetSdk = 36
    versionCode = 4
    versionName = "0.0.1"

    testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
  }

  signingConfigs {
    if (releaseSigningFile != null) {
      create("release") {
        val keyStore = file(requiredReleaseSigningValue("storeFile"))
        if (!keyStore.isAbsolute || !keyStore.isFile) {
          throw GradleException("Release signing keystore must be an existing absolute file")
        }
        if (isInsideRepository(keyStore)) {
          throw GradleException("Release signing keystore must be outside the repository")
        }
        val alias = requiredReleaseSigningValue("keyAlias")
        if (alias.equals("androiddebugkey", ignoreCase = true)) {
          throw GradleException("Release signing alias must not use the Android Debug identity")
        }
        storeFile = keyStore
        storePassword = requiredReleaseSigningValue("storePassword")
        keyAlias = alias
        keyPassword = requiredReleaseSigningValue("keyPassword")
        enableV1Signing = false
        enableV2Signing = true
        enableV3Signing = true
      }
    }
  }

  buildTypes {
    release {
      signingConfig = signingConfigs.findByName("release")
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

val releaseArtifactOperations = listOf("assemble", "bundle", "package", "install", "validateSigning")
val appProjectPath = project.path
gradle.taskGraph.whenReady(object : Action<TaskExecutionGraph> {
  override fun execute(graph: TaskExecutionGraph) {
    val releaseArtifactInGraph = graph.allTasks.any { task ->
      task.project.path == appProjectPath &&
        task.name.contains("Release", ignoreCase = true) &&
        releaseArtifactOperations.any { operation ->
          task.name.startsWith(operation, ignoreCase = true)
        }
    }
    if (releaseArtifactInGraph && releaseSigningFile == null) {
      throw GradleException("Release signing configuration is required via HONGTAI_RELEASE_SIGNING_PROPERTIES")
    }
  }
})

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

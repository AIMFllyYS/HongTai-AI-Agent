import java.io.File
import java.nio.file.Files
import java.nio.file.LinkOption
import java.util.Properties
import org.gradle.api.Action
import org.gradle.api.execution.TaskExecutionGraph

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
}

val releaseSigningPath = providers.environmentVariable("HONGTAI_RELEASE_SIGNING_PROPERTIES").orNull
val rawReleaseSigningFile = releaseSigningPath?.let(::File)
if (rawReleaseSigningFile != null && !rawReleaseSigningFile.isAbsolute) {
  throw GradleException("Release signing configuration must use an absolute path")
}
val releaseSigningFile = rawReleaseSigningFile?.let(::file)
val repositoryRootDirectory = rootProject.projectDir.parentFile.canonicalFile

fun isInsideRepository(candidate: File): Boolean {
  val repositoryPath = repositoryRootDirectory.path.trimEnd('\\', '/')
  val candidatePath = candidate.canonicalFile.path.trimEnd('\\', '/')
  return candidatePath.equals(repositoryPath, ignoreCase = true) ||
    candidatePath.startsWith("$repositoryPath${File.separator}", ignoreCase = true)
}

fun pathTraversesReparsePoint(candidate: File): Boolean {
  val normalizedPath = candidate.toPath().toAbsolutePath().normalize()
  if (
    Files.exists(normalizedPath, LinkOption.NOFOLLOW_LINKS) &&
    !normalizedPath.toRealPath().toString()
      .equals(normalizedPath.toString(), ignoreCase = true)
  ) {
    return true
  }

  var current = normalizedPath
  while (current != null) {
    if (
      Files.exists(current, LinkOption.NOFOLLOW_LINKS) &&
      Files.isSymbolicLink(current)
    ) {
      return true
    }
    current = current.parent
  }
  return false
}

if (releaseSigningFile != null) {
  if (!releaseSigningFile.isFile) {
    throw GradleException("Release signing configuration must be an existing file")
  }
  if (isInsideRepository(releaseSigningFile)) {
    throw GradleException("Release signing configuration must be outside the repository")
  }
  if (pathTraversesReparsePoint(releaseSigningFile)) {
    throw GradleException("Release signing configuration must not traverse a reparse point")
  }
}

val releaseSigning = Properties()
if (releaseSigningFile != null) {
  releaseSigningFile.reader(Charsets.UTF_8).use(releaseSigning::load)
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
        val rawKeyStore = File(requiredReleaseSigningValue("storeFile"))
        if (!rawKeyStore.isAbsolute) {
          throw GradleException("Release signing keystore must use an absolute path")
        }
        val keyStore = file(rawKeyStore)
        if (!keyStore.isFile) {
          throw GradleException("Release signing keystore must be an existing file")
        }
        if (isInsideRepository(keyStore)) {
          throw GradleException("Release signing keystore must be outside the repository")
        }
        if (pathTraversesReparsePoint(keyStore)) {
          throw GradleException("Release signing keystore must not traverse a reparse point")
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

val releaseArtifactTaskNames = setOf(
  "assembleRelease",
  "bundleRelease",
  "packageRelease",
  "packageReleaseBundle",
  "packageReleaseUniversalApk",
  "signReleaseBundle",
  "installRelease",
  "validateSigningRelease",
)
val appProjectPath = project.path
gradle.taskGraph.whenReady(object : Action<TaskExecutionGraph> {
  override fun execute(graph: TaskExecutionGraph) {
    val releaseArtifactInGraph = graph.allTasks.any { task ->
      task.project.path == appProjectPath &&
        task.name in releaseArtifactTaskNames
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

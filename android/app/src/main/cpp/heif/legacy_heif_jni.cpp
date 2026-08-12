#include <android/bitmap.h>
#include <jni.h>
#include <libheif/heif.h>
#include <libheif/heif_sequences.h>

#include <algorithm>
#include <array>
#include <cstdint>
#include <cstring>
#include <fcntl.h>
#include <limits>
#include <memory>
#include <new>
#include <sys/stat.h>
#include <unistd.h>

namespace {
constexpr jint kInvalid = 1;
constexpr jint kTooLarge = 2;
constexpr jint kUnavailable = 3;
constexpr jint kAllocationFailed = 4;

struct ContextDeleter { void operator()(heif_context* value) const { heif_context_free(value); } };
struct HandleDeleter { void operator()(const heif_image_handle* value) const { heif_image_handle_release(value); } };
struct ImageDeleter { void operator()(heif_image* value) const { heif_image_release(value); } };
struct OptionsDeleter { void operator()(heif_decoding_options* value) const { heif_decoding_options_free(value); } };
using ContextPtr = std::unique_ptr<heif_context, ContextDeleter>;
using HandlePtr = std::unique_ptr<const heif_image_handle, HandleDeleter>;
using ImagePtr = std::unique_ptr<heif_image, ImageDeleter>;
using OptionsPtr = std::unique_ptr<heif_decoding_options, OptionsDeleter>;

class FileDescriptor final {
 public:
  explicit FileDescriptor(const char* path) : value(open(path, O_RDONLY | O_CLOEXEC)) {}
  ~FileDescriptor() { if (value >= 0) close(value); }
  FileDescriptor(const FileDescriptor&) = delete;
  FileDescriptor& operator=(const FileDescriptor&) = delete;
  int get() const { return value; }
  bool is_valid() const { return value >= 0; }
 private:
  int value;
};

class UtfChars final {
 public:
  UtfChars(JNIEnv* environment, jstring text) : env(environment), value(text), chars(env->GetStringUTFChars(value, nullptr)) {}
  ~UtfChars() { if (chars != nullptr) env->ReleaseStringUTFChars(value, chars); }
  UtfChars(const UtfChars&) = delete;
  UtfChars& operator=(const UtfChars&) = delete;
  const char* get() const { return chars; }
 private:
  JNIEnv* env;
  jstring value;
  const char* chars;
};

class BitmapPixels final {
 public:
  BitmapPixels(JNIEnv* environment, jobject value) : env(environment), bitmap(value) {
    locked = AndroidBitmap_lockPixels(env, bitmap, &pixels) == ANDROID_BITMAP_RESULT_SUCCESS;
  }
  ~BitmapPixels() { if (locked) AndroidBitmap_unlockPixels(env, bitmap); }
  BitmapPixels(const BitmapPixels&) = delete;
  BitmapPixels& operator=(const BitmapPixels&) = delete;
  bool is_locked() const { return locked; }
  void* get() const { return pixels; }
 private:
  JNIEnv* env;
  jobject bitmap;
  void* pixels = nullptr;
  bool locked = false;
};

bool checked_multiply(std::uint64_t left, std::uint64_t right, std::uint64_t* result) {
  if (left != 0 && right > std::numeric_limits<std::uint64_t>::max() / left) return false;
  *result = left * right;
  return true;
}

bool checked_add(std::uint64_t left, std::uint64_t right, std::uint64_t* result) {
  if (right > std::numeric_limits<std::uint64_t>::max() - left) return false;
  *result = left + right;
  return true;
}

bool read_uint(int fd, std::uint64_t offset, std::size_t byte_count, std::uint64_t end, std::uint64_t* result) {
  if (byte_count > 8 || offset > end || byte_count > end - offset) return false;
  if (byte_count == 0) { *result = 0; return true; }
  std::array<std::uint8_t, 8> bytes {};
  const ssize_t count = pread(fd, bytes.data(), byte_count, static_cast<off_t>(offset));
  if (count < 0 || static_cast<std::size_t>(count) != byte_count) return false;
  std::uint64_t value = 0;
  for (std::size_t index = 0; index < byte_count; ++index) value = (value << 8) | bytes[index];
  *result = value;
  return true;
}

constexpr std::uint32_t fourcc(char a, char b, char c, char d) {
  return (static_cast<std::uint32_t>(a) << 24) |
    (static_cast<std::uint32_t>(b) << 16) |
    (static_cast<std::uint32_t>(c) << 8) |
    static_cast<std::uint32_t>(d);
}

struct BoxRange {
  std::uint32_t type;
  std::uint64_t payload;
  std::uint64_t end;
};

bool read_box(int fd, std::uint64_t position, std::uint64_t container_end, BoxRange* box) {
  std::uint64_t compact_size = 0;
  std::uint64_t type = 0;
  if (!read_uint(fd, position, 4, container_end, &compact_size) ||
      !read_uint(fd, position + 4, 4, container_end, &type) || compact_size == 0) return false;
  std::uint64_t header_size = 8;
  std::uint64_t box_size = compact_size;
  if (compact_size == 1) {
    header_size = 16;
    if (!read_uint(fd, position + 8, 8, container_end, &box_size)) return false;
  }
  std::uint64_t box_end = 0;
  if (box_size < header_size || !checked_add(position, box_size, &box_end) || box_end > container_end) return false;
  box->type = static_cast<std::uint32_t>(type);
  box->payload = position + header_size;
  box->end = box_end;
  return true;
}

bool skip_uint(int fd, std::uint64_t* position, std::size_t byte_count, std::uint64_t end, std::uint64_t* value) {
  if (!read_uint(fd, *position, byte_count, end, value)) return false;
  *position += byte_count;
  return true;
}

bool validate_iloc(int fd, const BoxRange& iloc, std::uint64_t source_bytes) {
  std::uint64_t version = 0;
  std::uint64_t offset_and_length_sizes = 0;
  std::uint64_t base_and_index_sizes = 0;
  if (!read_uint(fd, iloc.payload, 1, iloc.end, &version) || version > 2 ||
      !read_uint(fd, iloc.payload + 4, 1, iloc.end, &offset_and_length_sizes) ||
      !read_uint(fd, iloc.payload + 5, 1, iloc.end, &base_and_index_sizes)) return false;
  const std::size_t offset_size = static_cast<std::size_t>(offset_and_length_sizes >> 4);
  const std::size_t length_size = static_cast<std::size_t>(offset_and_length_sizes & 0x0f);
  const std::size_t base_offset_size = static_cast<std::size_t>(base_and_index_sizes >> 4);
  const std::size_t index_size = version == 0 ? 0 : static_cast<std::size_t>(base_and_index_sizes & 0x0f);
  if (offset_size > 8 || length_size > 8 || base_offset_size > 8 || index_size > 8) return false;

  std::uint64_t position = iloc.payload + 6;
  std::uint64_t item_count = 0;
  if (!skip_uint(fd, &position, version < 2 ? 2 : 4, iloc.end, &item_count) || item_count == 0 || item_count > 64) {
    return false;
  }
  for (std::uint64_t item = 0; item < item_count; ++item) {
    std::uint64_t ignored = 0;
    std::uint64_t construction_method = 0;
    std::uint64_t data_reference_index = 0;
    std::uint64_t base_offset = 0;
    if (!skip_uint(fd, &position, version < 2 ? 2 : 4, iloc.end, &ignored)) return false;
    if (version > 0 && !skip_uint(fd, &position, 2, iloc.end, &construction_method)) return false;
    construction_method &= 0x0f;
    if (construction_method > 1 ||
        !skip_uint(fd, &position, 2, iloc.end, &data_reference_index) || data_reference_index != 0 ||
        !skip_uint(fd, &position, base_offset_size, iloc.end, &base_offset)) return false;
    std::uint64_t extent_count = 0;
    if (!skip_uint(fd, &position, 2, iloc.end, &extent_count) || extent_count == 0 || extent_count > 128) return false;
    for (std::uint64_t extent = 0; extent < extent_count; ++extent) {
      std::uint64_t extent_offset = 0;
      std::uint64_t extent_length = 0;
      if ((version > 0 && index_size > 0 && !skip_uint(fd, &position, index_size, iloc.end, &ignored)) ||
          !skip_uint(fd, &position, offset_size, iloc.end, &extent_offset) ||
          !skip_uint(fd, &position, length_size, iloc.end, &extent_length)) return false;
      if (construction_method == 0) {
        std::uint64_t absolute_offset = 0;
        std::uint64_t absolute_end = 0;
        if (!checked_add(base_offset, extent_offset, &absolute_offset) ||
            !checked_add(absolute_offset, extent_length, &absolute_end) || absolute_end > source_bytes) return false;
      }
    }
  }
  return position == iloc.end;
}

bool validate_meta(int fd, const BoxRange& meta, std::uint64_t source_bytes) {
  if (meta.payload > meta.end || meta.end - meta.payload < 4) return false;
  std::uint64_t position = meta.payload + 4;  // FullBox version and flags.
  bool found_iloc = false;
  for (int count = 0; position < meta.end && count < 256; ++count) {
    BoxRange child {};
    if (!read_box(fd, position, meta.end, &child)) return false;
    if (child.type == fourcc('i', 'l', 'o', 'c')) {
      if (found_iloc || !validate_iloc(fd, child, source_bytes)) return false;
      found_iloc = true;
    }
    position = child.end;
  }
  return position == meta.end && found_iloc;
}

bool validate_still_container(const char* path, std::uint64_t source_bytes) {
  FileDescriptor source(path);
  if (!source.is_valid()) return false;
  bool found_ftyp = false;
  bool found_meta = false;
  std::uint64_t position = 0;
  for (int count = 0; position < source_bytes && count < 64; ++count) {
    BoxRange box {};
    if (!read_box(source.get(), position, source_bytes, &box)) return false;
    if (box.type == fourcc('f', 't', 'y', 'p')) found_ftyp = true;
    if (box.type == fourcc('m', 'o', 'o', 'v')) return false;
    if (box.type == fourcc('m', 'e', 't', 'a')) {
      if (found_meta || !validate_meta(source.get(), box, source_bytes)) return false;
      found_meta = true;
    }
    position = box.end;
  }
  return position == source_bytes && found_ftyp && found_meta;
}

void throw_native(JNIEnv* env, jint code) {
  jclass type = env->FindClass("com/hongtai/aiagent/media/heif/LegacyHeifNativeException");
  if (type == nullptr) return;
  jmethodID constructor = env->GetMethodID(type, "<init>", "(I)V");
  if (constructor == nullptr) return;
  jobject error = env->NewObject(type, constructor, code);
  if (error != nullptr) env->Throw(static_cast<jthrowable>(error));
}

jint classify_error(const heif_error& error) {
  return error.subcode == heif_suberror_Security_limit_exceeded ? kTooLarge : kInvalid;
}

jobject create_bitmap(JNIEnv* env, jint width, jint height) {
  jclass bitmap_class = env->FindClass("android/graphics/Bitmap");
  jclass config_class = env->FindClass("android/graphics/Bitmap$Config");
  if (bitmap_class == nullptr || config_class == nullptr) return nullptr;
  jfieldID argb_field = env->GetStaticFieldID(config_class, "ARGB_8888", "Landroid/graphics/Bitmap$Config;");
  jmethodID create = env->GetStaticMethodID(
    bitmap_class, "createBitmap", "(IILandroid/graphics/Bitmap$Config;)Landroid/graphics/Bitmap;");
  if (argb_field == nullptr || create == nullptr) return nullptr;
  jobject config = env->GetStaticObjectField(config_class, argb_field);
  return env->CallStaticObjectMethod(bitmap_class, create, width, height, config);
}
}  // namespace

extern "C" JNIEXPORT jobject JNICALL
Java_com_hongtai_aiagent_media_heif_LegacyHeifDecoder_nativeDecode(
  JNIEnv* env,
  jobject,
  jstring source_path,
  jlong source_bytes,
  jint max_source_edge,
  jlong max_source_pixels,
  jint max_output_edge,
  jlong max_output_pixels,
  jlong max_rgba_bytes) {
  try {
    if (source_path == nullptr || source_bytes <= 0 || source_bytes > 15LL * 1024LL * 1024LL) {
      throw_native(env, source_bytes > 15LL * 1024LL * 1024LL ? kTooLarge : kInvalid);
      return nullptr;
    }
    UtfChars path(env, source_path);
    if (path.get() == nullptr || env->ExceptionCheck()) return nullptr;
    struct stat file_info {};
    if (stat(path.get(), &file_info) != 0 || file_info.st_size != source_bytes) {
      throw_native(env, kUnavailable);
      return nullptr;
    }
    if (!validate_still_container(path.get(), static_cast<std::uint64_t>(source_bytes))) {
      throw_native(env, kInvalid);
      return nullptr;
    }

    ContextPtr context(heif_context_alloc());
    if (!context) { throw_native(env, kAllocationFailed); return nullptr; }
    heif_security_limits* limits = heif_context_get_security_limits(context.get());
    if (limits == nullptr) { throw_native(env, kUnavailable); return nullptr; }
    limits->max_image_size_pixels = static_cast<std::uint64_t>(max_source_pixels);
    limits->max_number_of_tiles = 256;
    limits->max_bayer_pattern_pixels = 4096;
    limits->max_items = 64;
    limits->max_color_profile_size = 1024 * 1024;
    limits->max_memory_block_size = 64ULL * 1024ULL * 1024ULL;
    limits->max_components = 8;
    limits->max_iloc_extents_per_item = 128;
    limits->max_size_entity_group = 64;
    limits->max_children_per_box = 256;
    limits->max_total_memory = 160ULL * 1024ULL * 1024ULL;
    limits->max_sample_description_box_entries = 32;
    limits->max_sample_group_description_box_entries = 32;
    limits->max_sequence_frames = 1;
    limits->max_number_of_file_brands = 32;
    limits->max_bad_pixels = 1024;
    limits->max_iso23001_17_pixel_size_bytes = 16;
    limits->parent = nullptr;
    heif_context_set_max_decoding_threads(context.get(), 0);

    heif_error error = heif_context_read_from_file(context.get(), path.get(), nullptr);
    if (error.code != heif_error_Ok) { throw_native(env, classify_error(error)); return nullptr; }
    if (heif_context_has_sequence(context.get()) != 0 ||
        heif_context_get_number_of_top_level_images(context.get()) != 1 ||
        heif_have_decoder_for_format(heif_compression_HEVC) == 0) {
      throw_native(env, kInvalid);
      return nullptr;
    }
    heif_image_handle* raw_handle = nullptr;
    error = heif_context_get_primary_image_handle(context.get(), &raw_handle);
    HandlePtr handle(raw_handle);
    if (error.code != heif_error_Ok || !handle || heif_image_handle_is_primary_image(handle.get()) == 0) {
      throw_native(env, classify_error(error));
      return nullptr;
    }
    const jint source_width = heif_image_handle_get_width(handle.get());
    const jint source_height = heif_image_handle_get_height(handle.get());
    std::uint64_t source_pixels = 0;
    if (source_width <= 0 || source_height <= 0 || source_width > max_source_edge || source_height > max_source_edge ||
        !checked_multiply(static_cast<std::uint64_t>(source_width), static_cast<std::uint64_t>(source_height), &source_pixels) ||
        source_pixels > static_cast<std::uint64_t>(max_source_pixels)) {
      throw_native(env, kTooLarge);
      return nullptr;
    }

    OptionsPtr options(heif_decoding_options_alloc());
    if (!options) { throw_native(env, kAllocationFailed); return nullptr; }
    options->ignore_transformations = 0;
    options->strict_decoding = 1;
    options->num_library_threads = 0;
    options->num_codec_threads = 1;
    heif_image* raw_image = nullptr;
    error = heif_decode_image(
      handle.get(), &raw_image, heif_colorspace_RGB, heif_chroma_interleaved_RGBA, options.get());
    ImagePtr decoded(raw_image);
    if (error.code != heif_error_Ok || !decoded) { throw_native(env, classify_error(error)); return nullptr; }

    jint output_width = source_width;
    jint output_height = source_height;
    const jint source_max_edge = std::max(source_width, source_height);
    if (source_max_edge > max_output_edge) {
      output_width = std::max<jint>(1, static_cast<jint>(
        static_cast<std::int64_t>(source_width) * max_output_edge / source_max_edge));
      output_height = std::max<jint>(1, static_cast<jint>(
        static_cast<std::int64_t>(source_height) * max_output_edge / source_max_edge));
    }
    std::uint64_t output_pixels = 0;
    std::uint64_t rgba_bytes = 0;
    if (!checked_multiply(static_cast<std::uint64_t>(output_width), static_cast<std::uint64_t>(output_height), &output_pixels) ||
        !checked_multiply(output_pixels, 4, &rgba_bytes) ||
        output_pixels > static_cast<std::uint64_t>(max_output_pixels) ||
        rgba_bytes > static_cast<std::uint64_t>(max_rgba_bytes)) {
      throw_native(env, kTooLarge);
      return nullptr;
    }

    ImagePtr scaled;
    heif_image* output_image = decoded.get();
    if (output_width != source_width || output_height != source_height) {
      heif_image* raw_scaled = nullptr;
      error = heif_image_scale_image(decoded.get(), &raw_scaled, output_width, output_height, nullptr);
      scaled.reset(raw_scaled);
      if (error.code != heif_error_Ok || !scaled) { throw_native(env, classify_error(error)); return nullptr; }
      output_image = scaled.get();
    }

    std::size_t source_stride = 0;
    const std::uint8_t* rgba = heif_image_get_plane_readonly2(output_image, heif_channel_interleaved, &source_stride);
    const std::uint64_t row_bytes = static_cast<std::uint64_t>(output_width) * 4ULL;
    if (rgba == nullptr || source_stride < row_bytes) { throw_native(env, kInvalid); return nullptr; }
    jobject bitmap = create_bitmap(env, output_width, output_height);
    if (bitmap == nullptr || env->ExceptionCheck()) return nullptr;
    AndroidBitmapInfo bitmap_info {};
    if (AndroidBitmap_getInfo(env, bitmap, &bitmap_info) != ANDROID_BITMAP_RESULT_SUCCESS ||
        bitmap_info.format != ANDROID_BITMAP_FORMAT_RGBA_8888 || bitmap_info.stride < row_bytes) {
      throw_native(env, kUnavailable);
      return nullptr;
    }
    BitmapPixels destination(env, bitmap);
    if (!destination.is_locked()) { throw_native(env, kUnavailable); return nullptr; }
    auto* output = static_cast<std::uint8_t*>(destination.get());
    for (jint row = 0; row < output_height; ++row) {
      std::memcpy(output + static_cast<std::size_t>(row) * bitmap_info.stride,
                  rgba + static_cast<std::size_t>(row) * source_stride,
                  static_cast<std::size_t>(row_bytes));
    }
    return bitmap;
  } catch (const std::bad_alloc&) {
    throw_native(env, kAllocationFailed);
    return nullptr;
  } catch (...) {
    throw_native(env, kInvalid);
    return nullptr;
  }
}

# LibVLC — LLM Skill Document

> **Version scope: libvlc 3.x and 4.x.** This document covers both the stable **3.x** release line (VLC 3.0.x) and the **4.x** release line (VLC 4.0+). Where APIs are identical, no version marker is shown. Where they differ, inline markers indicate the version: `[3.x]` for 3.x-only APIs, `[4.x]` for 4.x-only APIs, and `[4.x change]` for APIs whose signatures changed. When generating code, **ask the user which version they target** if not already clear from context.

You are an expert assistant for developers using **libvlc** — the multimedia framework behind VLC media player. You help with API usage, code generation, debugging, and architecture decisions across all supported languages and platforms.

## How to Use This Document

- **API lookup**: Jump to §3 (API Reference) for function signatures, parameters, return types
- **Code generation**: Jump to §4 (Language Bindings) for the target language, then §5 (Workflows) for the pattern
- **Debugging**: Jump to §8 (Troubleshooting) for known pitfalls and fixes
- **Platform setup**: Jump to §6 (Platform Integration) for OS/framework-specific embedding
- **Streaming**: Jump to §7 (Streaming & Transcoding) for sout chains and Chromecast
- **Migrating 3.x → 4.x**: Jump to §13 (Migration Guide) for a concise mapping table

### Version Markers

Throughout this document:
- **No marker** — API is the same in both 3.x and 4.x
- **`[3.x]`** — Only available in libvlc 3.x (removed or replaced in 4.x)
- **`[4.x]`** — New in libvlc 4.x (not available in 3.x)
- **`[4.x change]`** — Exists in both versions but the signature changed in 4.x

---

## §1. Architecture Overview

### What is LibVLC

LibVLC is a C library providing the core multimedia engine of VLC. It handles media playback, streaming, transcoding, and device discovery. Applications embed libvlc to add multimedia capabilities.

**Three-layer architecture:**
1. **`libvlc.dll`/`libvlc.so`/`libvlc.dylib`** — Public API (what bindings call). ~200 functions.
2. **`libvlccore`** — Internal API (not for public consumption). The VLC desktop app uses this directly, NOT libvlc.
3. **360+ plugins** — Organized in subdirectories: `access/`, `codec/`, `demux/`, `video_output/`, `audio_output/`, `stream_out/`, etc. Loaded dynamically at runtime.

### Processing Pipeline

**Regular playback:**
```
Input → Access → Demux → Decode → Video/Audio Output
```

**Streaming/transcoding:**
```
Input → Access → Demux → Decode → Encode (optional) → Remux → Stream Output
```

### Object Model

All libvlc types are **opaque pointers** with **reference counting** (`retain`/`release`). The core types:

```
libvlc_instance_t          — Root context. Create ONE per application.
├── libvlc_media_t         — A media resource (file, URL, stream, file descriptor)
├── libvlc_media_player_t  — Playback engine (most-used type, ~123 C functions)
├── libvlc_media_list_t    — Ordered collection of media items
├── libvlc_media_list_player_t — Plays a media list sequentially/randomly
├── libvlc_media_discoverer_t  — Discovers network services (UPnP, DLNA)
├── libvlc_renderer_discoverer_t — Discovers renderers (Chromecast)
├── libvlc_media_library_t — Media library (minimal API)
└── libvlc_event_manager_t — Per-object event subscription
```

### Critical Rule: Single Instance

**Create exactly ONE `libvlc_instance_t` per application.** Multiple instances cause undefined behavior due to global state (plugin registry, locale settings). Multiple media players sharing one instance is the correct pattern.

---

## §2. Core Concepts

### 2.1 Object Lifecycle (Reference Counting)

Every libvlc object uses manual reference counting:
- `*_new()` / `*_new_*()` — Creates object (refcount = 1)
- `*_retain()` — Increments refcount
- `*_release()` — Decrements refcount; frees at 0

**In C:** You must call `_release()` on every object you create or retain.
**In bindings:** Varies — C# uses `IDisposable`, Python uses GC integration, Java requires explicit `release()`.

```c
// C lifecycle — libvlc 3.x
libvlc_instance_t *inst = libvlc_new(0, NULL);
libvlc_media_t *media = libvlc_media_new_path(inst, "/path/to/file.mp4");       // [3.x] inst required
libvlc_media_player_t *mp = libvlc_media_player_new_from_media(media);           // [3.x]
libvlc_media_release(media);
libvlc_media_player_play(mp);
// ... later ...
libvlc_media_player_stop(mp);             // [3.x] synchronous
libvlc_media_player_release(mp);
libvlc_release(inst);
```

```c
// C lifecycle — libvlc 4.x
libvlc_instance_t *inst = libvlc_new(0, NULL);
libvlc_media_t *media = libvlc_media_new_path("/path/to/file.mp4");              // [4.x] no inst
libvlc_media_player_t *mp = libvlc_media_player_new_from_media(inst, media);     // [4.x] inst required
libvlc_media_release(media);
libvlc_media_player_play(mp);
// ... later ...
libvlc_media_player_stop_async(mp);       // [4.x] asynchronous, returns int
libvlc_media_player_release(mp);
libvlc_release(inst);
```

**Key 3.x → 4.x lifecycle changes:**
- Media creation (`_new_path`, `_new_location`, `_new_fd`, `_new_callbacks`, `_new_as_node`) **no longer takes** `libvlc_instance_t*` in 4.x
- `libvlc_media_player_new_from_media()` **now requires** `libvlc_instance_t*` as first parameter in 4.x
- `libvlc_media_player_stop()` is replaced by `libvlc_media_player_stop_async()` in 4.x (non-blocking, returns 0 on success)
- `libvlc_media_list_new()` no longer takes instance in 4.x

### 2.2 Threading Rules

**CRITICAL — The #1 source of bugs across all bindings:**

> **NEVER call any libvlc function from within a libvlc event callback.** LibVLC is not reentrant. Calling back into libvlc from a callback thread causes **deadlock**.

**Wrong (ALL languages):**
```
on_end_reached(event):
    player.play(next_media)   // DEADLOCK — calling libvlc from callback thread
```

**Correct pattern — offload to another thread:**

| Language | Solution |
|----------|----------|
| C | `pthread_create()` or queue + worker thread |
| C# | `ThreadPool.QueueUserWorkItem(_ => player.Play(next))` |
| Python | `queue.Queue()` → process in main loop |
| Java | `mediaPlayer.submit(() -> mp.media().play(next))` |
| Go | `go func() { player.Play(next) }()` |

**Toolkit-specific callback→UI thread patterns (C):**

When using a UI toolkit, post VLC events back to the UI thread using the toolkit's mechanism:

```c
/* GTK — use g_idle_add() to run on the GTK main loop */
void on_end_vlc(const libvlc_event_t *event, void *data) {
    g_idle_add((GSourceFunc)handle_end_on_main_thread, NULL);
}

/* wxWidgets — post a custom event to the wx event loop */
void OnEndReached_VLC(const libvlc_event_t *event, void *data) {
    wxCommandEvent evt(vlcEVT_END, wxID_ANY);
    mainWindow->GetEventHandler()->AddPendingEvent(evt);
}

/* Qt — use QTimer for polling (avoids cross-thread event posting entirely) */
QTimer *timer = new QTimer(this);
connect(timer, &QTimer::timeout, this, [this]() {
    if (vlcPlayer &&
        libvlc_media_player_get_state(vlcPlayer) == libvlc_Ended)
        handleEnd();
});
timer->start(100);  /* poll every 100ms */

/* POSIX — use pthread_cond to signal a waiting thread */
void on_event_vlc(const libvlc_event_t *event, void *data) {
    pthread_mutex_lock(&lock);
    event_received = true;
    pthread_cond_signal(&cond);
    pthread_mutex_unlock(&lock);
}
```

**`[4.x]` Concurrency API — built-in lock/wait/signal:**

LibVLC 4.x provides a built-in mutex+condition variable on the media player, removing the need for external synchronization primitives in many cases:

```c
// [4.x] Wait for playback to stop using built-in concurrency
libvlc_media_player_lock(mp);
while (libvlc_media_player_get_state(mp) != libvlc_Stopped)
    libvlc_media_player_wait(mp);    // waits on internal condvar
libvlc_media_player_unlock(mp);
```

`[4.x]` The lock is recursive and safe to call from any thread. Use `libvlc_media_player_signal(mp)` to wake waiting threads from event callbacks. Note: `wait()` may spuriously wake up; always check the condition in a loop.

**`[4.x]` Watch Time API — precise time tracking:**

For UI time displays (seekbar, elapsed time), 4.x provides a high-precision timer instead of polling:

```c
// [4.x] Watch time — get precise interpolated playback time
void on_time_update(const libvlc_media_player_time_point_t *pt, void *data) {
    // WARNING: do NOT call libvlc functions here
    // Store the point and interpolate from your UI timer
    memcpy(&last_point, pt, sizeof(*pt));
}
void on_time_paused(int64_t system_date_us, void *data) { /* stop UI timer */ }

libvlc_media_player_watch_time(mp,
    100000,          // min 100ms between updates
    on_time_update,
    on_time_paused,
    NULL,            // on_seek (optional)
    user_data);

// In your UI timer callback, interpolate to current system time:
int64_t now = libvlc_clock();
int64_t ts_us;
double pos;
if (libvlc_media_player_time_point_interpolate(&last_point, now, &ts_us, &pos) == 0) {
    update_seekbar(pos);
    update_time_label(ts_us / 1000000);  // convert us to seconds
}

// Get next second boundary for timer scheduling:
int64_t next = libvlc_media_player_time_point_get_next_date(
    &last_point, now, ts_us, 1000000 /* 1 second interval */);
int64_t delay_us = libvlc_delay(next);
schedule_timer(delay_us);
```

### 2.3 Event System

Each object has an event manager obtained via `*_event_manager()`. Events are typed — see §3.6 for the full list.

**Pattern (C):**
```c
void on_playing(const libvlc_event_t *event, void *userdata) {
    // DO NOT call libvlc functions here
    // Signal your main thread instead
}

libvlc_event_manager_t *em = libvlc_media_player_event_manager(mp);
libvlc_event_attach(em, libvlc_MediaPlayerPlaying, on_playing, my_context);
// ... later ...
libvlc_event_detach(em, libvlc_MediaPlayerPlaying, on_playing, my_context);
```

### 2.4 Error Handling

- Most functions return `0` on success, `-1` on error
- `libvlc_errmsg()` returns the last error message (thread-local)
- `libvlc_clearerr()` clears the error
- Some functions return `NULL` on failure (e.g., `libvlc_new()`)

### 2.5 Logging

```c
// Set log callback
void log_cb(void *data, int level, const libvlc_log_t *ctx,
            const char *fmt, va_list args) {
    // level: LIBVLC_DEBUG=0, LIBVLC_NOTICE=2, LIBVLC_WARNING=3, LIBVLC_ERROR=4
    vfprintf(stderr, fmt, args);
}
libvlc_log_set(inst, log_cb, NULL);

// Or log to file
libvlc_log_set_file(inst, fopen("vlc.log", "w"));

// Unset (restore default)
libvlc_log_unset(inst);
```

### 2.6 Clock & Timing

```c
int64_t libvlc_clock(void);   // Current system clock in microseconds
int64_t libvlc_delay(int64_t pts);  // pts - clock (how long until pts)
```

### 2.7 Plugin Discovery & `VLC_PLUGIN_PATH`

LibVLC discovers plugins (codecs, demuxers, video outputs, etc.) at startup during `libvlc_new()`. Understanding the plugin loading mechanism is **critical** for deployment — most "no suitable decoder" or "no audio/video output" errors trace back to plugins not being found.

**Plugin search order** (from `src/modules/bank.c`):

1. **Static modules** — compiled-in plugins (used on iOS, some embedded builds)
2. **Default plugin directory** — platform-dependent:
   - **Linux/macOS/Windows desktop**: `<libvlc-install-dir>/plugins/` (relative to `libvlc.so`/`libvlc.dll`/`libvlc.dylib`)
   - **Windows Store (UWP)**: `plugins/` relative to app package root
   - **iOS**: plugins are flattened into the app bundle's library directory (no `plugins/` subfolder)
3. **`VLC_PLUGIN_PATH` environment variable** — **additive**, checked AFTER the default directory. Supports multiple paths separated by `:` (Unix) or `;` (Windows)

**Key behaviors:**
- `VLC_PLUGIN_PATH` **does not replace** the default path — it adds additional directories to scan
- Directories are scanned recursively up to **5 levels deep**
- Plugins must match the naming pattern `lib*_plugin.so` (Linux), `lib*_plugin.dylib` (macOS), or `*_plugin.dll` (Windows)
- A **`plugins.dat` cache file** is generated in each plugin directory after the first scan, significantly speeding up subsequent loads
- If the cache is stale (plugin file modified/updated), it is automatically invalidated and the plugin is re-scanned

**Setting `VLC_PLUGIN_PATH`:**

```c
// Before calling libvlc_new():
// Linux/macOS:
setenv("VLC_PLUGIN_PATH", "/opt/vlc-plugins:/usr/local/lib/vlc/plugins", 1);
// Windows:
_putenv("VLC_PLUGIN_PATH=C:\\vlc\\plugins;D:\\extra-plugins");

libvlc_instance_t *inst = libvlc_new(0, NULL);
```

```csharp
// C# — set before creating LibVLC:
Environment.SetEnvironmentVariable("VLC_PLUGIN_PATH", "/path/to/plugins");
using var libVLC = new LibVLC();
```

```python
# Python — set before importing vlc or creating Instance:
import os
os.environ["VLC_PLUGIN_PATH"] = "/path/to/plugins"
import vlc
instance = vlc.Instance()
```

**Related CLI options** (passed to `libvlc_new()`):
- `--plugins-cache` — use the plugins cache (default: enabled). Disable with `--no-plugins-cache` to force re-scanning on every startup.
- `--plugins-scan` — scan plugin directories (default: enabled). Disable with `--no-plugins-scan` to only load from cache (faster startup, but new plugins won't be found).
- `--reset-plugins-cache` — force rebuild the `plugins.dat` cache file on next startup.

**Common deployment issues:**
- **"No suitable decoder"** — plugins directory not found or codec plugin missing. Verify `VLC_PLUGIN_PATH` points to a directory containing `libavcodec_plugin.*`
- **"No audio/video output"** — output plugins missing. Ensure `libaout_*` / `libvout_*` plugins are present
- **Slow startup** — first launch scans all plugins. Pre-generate cache or reuse the instance. On mobile, prefer static linking.
- **Custom plugin directory** — when redistributing libvlc, ship `plugins/` alongside `libvlc.so`/`.dll`, or set `VLC_PLUGIN_PATH`

---


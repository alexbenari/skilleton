## §4. Language Binding Patterns

### 4.1 C# — LibVLCSharp (Official, Cross-platform)

> **Targets LibVLCSharp 3.x** (NuGet `LibVLCSharp` 3.x + `VideoLAN.LibVLC.*` 3.x) for the 3.x examples below. The master branch of LibVLCSharp targets libvlc 4.x with a different API surface (e.g., `MediaConfiguration`, new rendering APIs, async stop).

**Package:** `VideoLAN.LibVLC.Forms` (Xamarin), `LibVLCSharp` (core), `VideoLAN.LibVLC.Windows/Mac/...` (platform-specific)

**Type Mapping:**

| C Type | C# Type | Notes |
|--------|---------|-------|
| `libvlc_instance_t` | `LibVLC` | Constructor takes `params string[]` CLI args |
| `libvlc_media_player_t` | `MediaPlayer` | Created from `LibVLC` or `Media` |
| `libvlc_media_t` | `Media` | Created from `LibVLC` + URI/path/stream |
| `libvlc_media_list_t` | `MediaList` | Implements `IEnumerable` |
| `libvlc_event_manager_t` | C# events | `.Playing += handler` |
| `libvlc_renderer_item_t` | `RendererItem` | |
| `libvlc_equalizer_t` | `Equalizer` | |

**Initialization:**
```csharp
// Load native libvlc (does plugin scan — can be slow first time)
using var libVLC = new LibVLC(enableDebugLogs: true);
// Or with args:
using var libVLC = new LibVLC("--verbose=2", "--no-video-title-show");
```

**Basic Playback:**
```csharp
using var libVLC = new LibVLC();
using var media = new Media(libVLC, new Uri("https://example.com/video.mp4"));
using var player = new MediaPlayer(media);
player.Play();
```

**Events:**
```csharp
player.Playing += (sender, e) => Console.WriteLine("Playing!");
player.EndReached += (sender, e) => {
    // MUST offload — never call libvlc from callback thread
    ThreadPool.QueueUserWorkItem(_ => player.Play(nextMedia));
};
player.EncounteredError += (sender, e) => Console.WriteLine("Error!");
player.TimeChanged += (sender, e) => Console.WriteLine($"Time: {e.Time}ms");
player.Buffering += (sender, e) => Console.WriteLine($"Buffering: {e.Cache}%");
```

**Media Parsing:**
```csharp
using var media = new Media(libVLC, new Uri("file:///path/to/file.mp4"));
await media.Parse(MediaParseOptions.ParseLocal);
// media.Tracks, media.Meta(MetadataType.Title), media.Duration
```

**YouTube / m3u8 / Playlists (network-parsed media with sub-items):**

LibVLC can resolve playlist-like URLs (YouTube, HLS manifests) by parsing them over the network. The actual playable stream is exposed as the first sub-item:

```csharp
using var media = new Media(libVLC, new Uri("https://youtube.com/watch?v=..."));
await media.Parse(MediaParseOptions.ParseNetwork);
// The resolved stream URL is in SubItems — play the first one:
player.Play(media.SubItems.First());
```

This works for any URL where libvlc resolves the actual stream via network parsing (YouTube, Dailymotion, some m3u8 playlists, etc.). Always parse with `ParseNetwork` and check `SubItems` rather than playing the original URL directly.

**Custom Stream Input (imem):**
```csharp
using var media = new Media(libVLC, new StreamMediaInput(myStream));
player.Play(new MediaPlayer(media));
```

**Platform VideoView:**

| Platform | Control | Embedding |
|----------|---------|-----------|
| WPF | `VideoView` (wraps `WindowsFormsHost`) | XAML: `<vlc:VideoView />` |
| WinForms | `VideoView` | Direct control |
| UWP | `VideoView` (SwapChainPanel) | Requires `"--aout=winstore"` |
| macOS/iOS | `VideoView` (NSView/UIView) | `player.SetNSObject(view.Handle)` |
| Android | `VideoView` (SurfaceView) | `player.SetAndroidContext(...)` |
| GTK | `VideoView` | DrawingArea |
| Avalonia | `VideoView` | NativeControlHost |

**IDisposable — CRITICAL:** All main types (`LibVLC`, `MediaPlayer`, `Media`, `MediaList`) implement `IDisposable`. Always `using` or `.Dispose()`. Events are native callbacks — **unsubscribe before disposal** to prevent both managed and native memory leaks.

### 4.2 Python — python-vlc

**Package:** `pip install python-vlc`

**Type Mapping:**

| C Type | Python Type | Notes |
|--------|-------------|-------|
| `libvlc_instance_t` | `vlc.Instance` | Constructor takes string or list of args |
| `libvlc_media_player_t` | `vlc.MediaPlayer` | Auto-creates default Instance if not provided |
| `libvlc_media_t` | `vlc.Media` | |
| `libvlc_media_list_t` | `vlc.MediaList` | |
| `libvlc_event_manager_t` | `vlc.EventManager` | |

**Quickstart (Implicit Instance):**
```python
import vlc

player = vlc.MediaPlayer("file:///path/to/video.mp4")
player.play()

# Wait for playback
import time
time.sleep(10)
```

**Explicit Instance (Recommended):**
```python
import vlc

instance = vlc.Instance('--no-audio', '--verbose=2')
player = instance.media_player_new()

media = instance.media_new('/path/to/file.mp4')
player.set_media(media)

# Embed in window (Linux/X11)
player.set_xwindow(window_id)
# Windows: player.set_hwnd(hwnd)
# macOS: player.set_nsobject(nsview_ptr)

player.play()
```

**Events:**
```python
import vlc
import queue

cmd_queue = queue.Queue()

def on_end(event):
    # DO NOT call player methods here — deadlock!
    cmd_queue.put('ended')

def on_position(event):
    cmd_queue.put(('pos', event.u.new_position))

player = vlc.MediaPlayer("file.mp4")
em = player.event_manager()
em.event_attach(vlc.EventType.MediaPlayerEndReached, on_end)
em.event_attach(vlc.EventType.MediaPlayerPositionChanged, on_position)

player.play()

# Process events in main thread
while True:
    try:
        msg = cmd_queue.get(timeout=0.1)
        if msg == 'ended':
            break
    except queue.Empty:
        pass
```

**Media Options:**
```python
media = instance.media_new('file.mp4', 'network-caching=1000')
# Or:
media = instance.media_new('file.mp4')
media.add_option(':sout=#transcode{vcodec=h264}:std{access=file,dst=out.mp4}')
```

**Custom Callbacks (in-memory stream):**
```python
import vlc
import ctypes

@vlc.CallbackDecorators.MediaOpenCb
def open_cb(opaque, data_pointer, size_pointer):
    size_pointer.value = 2**64 - 1
    return 0

@vlc.CallbackDecorators.MediaReadCb
def read_cb(opaque, buffer, length):
    data = get_next_chunk()
    buf = ctypes.cast(buffer, ctypes.POINTER(ctypes.c_char * len(data)))
    for i, b in enumerate(data):
        buf.contents[i] = ctypes.c_char(b)
    return len(data)

@vlc.CallbackDecorators.MediaCloseCb
def close_cb(opaque):
    pass

media = instance.media_new_callbacks(open_cb, read_cb, None, close_cb, None)
```

**Python Gotchas:**
1. **Keep references alive** — if Python GC collects a wrapper, the C pointer becomes invalid. Always assign to variables, not inline.
2. **Callbacks run on libvlc thread** — not Python main thread. Use `queue.Queue` to communicate.
3. **String encoding** — auto UTF-8 conversion. Non-ASCII paths work.
4. **`event_manager()` reference** — keep the EventManager reference alive, or callbacks stop working.

### 4.3 Java/Kotlin — vlcj

> **Targets vlcj 4.x** (which wraps libvlc 3.x — note: vlcj version numbers differ from libvlc version numbers).

**Package:** `uk.co.caprica:vlcj:4.x` (Maven Central)

**Type Mapping:**

| C Type | vlcj Type | Notes |
|--------|-----------|-------|
| `libvlc_instance_t` | `MediaPlayerFactory` | Auto-discovers libvlc |
| `libvlc_media_player_t` | `MediaPlayer` / `EmbeddedMediaPlayer` | |
| `libvlc_media_t` | `Media` | |
| `libvlc_event_manager_t` | `MediaPlayerEventAdapter` / listeners | |

**Initialization (vlcj 4.x — auto-discovery):**
```java
MediaPlayerFactory factory = new MediaPlayerFactory();
// Or with args:
MediaPlayerFactory factory = new MediaPlayerFactory("--verbose=2", "--no-video-title-show");
```

**Basic Playback (Swing):**
```java
EmbeddedMediaPlayerComponent component = new EmbeddedMediaPlayerComponent();
frame.setContentPane(component);
frame.setVisible(true);

component.mediaPlayer().media().play("/path/to/video.mp4");
```

**Fluent API (module pattern):**
```java
MediaPlayer mp = component.mediaPlayer();
mp.controls().play();
mp.controls().pause();
mp.controls().stop();
mp.controls().setPosition(0.5f);
mp.audio().setVolume(80);
mp.video().setAspectRatio("16:9");
mp.media().play(mrl, ":network-caching=1000");
long time = mp.status().time();
```

**Events:**
```java
mp.events().addMediaPlayerEventListener(new MediaPlayerEventAdapter() {
    @Override
    public void playing(MediaPlayer mediaPlayer) {
        // On native thread — marshal to EDT for UI updates
        SwingUtilities.invokeLater(() -> statusLabel.setText("Playing"));
    }

    @Override
    public void finished(MediaPlayer mediaPlayer) {
        // NEVER call libvlc directly — use submit()
        mediaPlayer.submit(() -> mediaPlayer.media().play(nextMrl));
    }

    @Override
    public void error(MediaPlayer mediaPlayer) {
        SwingUtilities.invokeLater(() ->
            JOptionPane.showMessageDialog(frame, "Playback error"));
    }
});
```

**Direct/Callback Rendering (for JavaFX, OpenGL):**
```java
CallbackMediaPlayerComponent component = new CallbackMediaPlayerComponent();
// Renders via BufferedImage — suitable for JavaFX ImageView
```

**Cleanup — CRITICAL:**
```java
// Must release native resources explicitly
component.release();
factory.release();
```

**vlcj Gotchas:**
1. **GC crashes** — keep hard references to all vlcj objects. Local variables go out of scope → native thread outlives Java object → JVM crash.
2. **macOS Java 7+** — no heavyweight AWT. Use JavaFX or `CallbackMediaPlayerComponent`.
3. **`play()` is async** — returns immediately. Success/failure reported via events.
4. **Thread safety** — events fire on native callback thread. Use `submit()` for libvlc calls, `SwingUtilities.invokeLater()` for UI.

### 4.4 Go — libvlc-go

**Package:** `github.com/adrg/libvlc-go/v3`

**Type Mapping:**

| C Type | Go Type | Notes |
|--------|---------|-------|
| `libvlc_instance_t` | module-level (via `vlc.Init()`) | Global singleton |
| `libvlc_media_player_t` | `vlc.Player` | |
| `libvlc_media_t` | `vlc.Media` | |
| `libvlc_event_manager_t` | `vlc.EventManager` | |

**Usage:**
```go
package main

import (
    "log"
    vlc "github.com/adrg/libvlc-go/v3"
)

func main() {
    // Initialize (global, call once)
    if err := vlc.Init("--quiet"); err != nil {
        log.Fatal(err)
    }
    defer vlc.Release()

    // Create player
    player, err := vlc.NewPlayer()
    if err != nil {
        log.Fatal(err)
    }
    defer func() { player.Stop(); player.Release() }()

    // Load media
    media, err := player.LoadMediaFromPath("/path/to/file.mp4")
    if err != nil {
        log.Fatal(err)
    }
    defer media.Release()

    // Events
    manager, err := player.EventManager()
    if err != nil {
        log.Fatal(err)
    }

    eventID, err := manager.Attach(vlc.MediaPlayerEndReached, func(event vlc.Event, userData interface{}) {
        log.Println("Playback ended")
    }, nil)
    if err != nil {
        log.Fatal(err)
    }
    defer manager.Detach(eventID)

    // Play
    if err := player.Play(); err != nil {
        log.Fatal(err)
    }

    // Block main goroutine
    select {}
}
```

**Go Gotchas:**
1. **CGo overhead** — each libvlc call crosses the CGo boundary. Minimize calls in hot paths.
2. **Global init** — `vlc.Init()` must be called once; `vlc.Release()` at shutdown.
3. **Error returns** — Go-idiomatic `(result, error)` pattern. Always check errors.
4. **Event callbacks** — fire on libvlc thread via CGo. Safe to use goroutines for follow-up work.

### 4.5 C++ — libvlcpp (Header-only)

**Type Mapping:**

| C Type | C++ Type | Notes |
|--------|----------|-------|
| `libvlc_instance_t` | `VLC::Instance` | RAII, shared_ptr-based |
| `libvlc_media_player_t` | `VLC::MediaPlayer` | |
| `libvlc_media_t` | `VLC::Media` | |
| `libvlc_media_list_t` | `VLC::MediaList` | |
| `libvlc_event_manager_t` | `VLC::EventManager` | |

**Usage:**
```cpp
#include <vlcpp/vlc.hpp>

auto instance = VLC::Instance(0, nullptr);
auto media = VLC::Media(instance, "/path/to/file.mp4", VLC::Media::FromPath);
auto player = VLC::MediaPlayer(media);

// Events (lambda-based)
player.eventManager().onPlaying([&]() {
    std::cout << "Playing!" << std::endl;
});

player.eventManager().onEndReached([&]() {
    // Still must not call libvlc directly — use async dispatch
    std::async(std::launch::async, [&]() { player.play(); });
});

player.play();
```

**C++ Features:**
- **RAII** — automatic cleanup via destructors (no manual retain/release)
- **Shared ownership** — internal `std::shared_ptr` wrapping
- **Lambda events** — `eventManager().onXxx(lambda)`
- **Type-safe** — wraps all C enums and types

### 4.6 Other Language Bindings

**VB.NET (LibVLCSharp):**

LibVLCSharp works with any .NET language, including Visual Basic:

```vb
Imports LibVLCSharp.Shared

Module Program
    Sub Main(args As String())
        Core.Initialize()
        Using libVLC = New LibVLC()
            Dim video = New Media(libVLC, New Uri("http://example.com/video.mp4"))
            Using mp = New MediaPlayer(video)
                video.Dispose()
                mp.Play()
                Console.ReadKey()
            End Using
        End Using
    End Sub
End Module
```

**PHP (via PeachPie — experimental):**

LibVLCSharp can be used from PHP through the [PeachPie](https://www.peachpie.io/) PHP-to-.NET compiler:

```php
<?php
use LibVLCSharp\Shared\Core;
use LibVLCSharp\Shared\LibVLC;
use LibVLCSharp\Shared\MediaPlayer;
use LibVLCSharp\Shared\Media;

Core::Initialize();
$libVLC = new LibVLC();
$mediaPlayer = new MediaPlayer($libVLC);
$media = new Media($libVLC, "http://example.com/video.mp4", 1);
$mediaPlayer->Play($media);
```

These demonstrate that LibVLCSharp is not limited to C# — any .NET-compatible language can use it with the same API surface.

### 4.7 Binding Cross-Reference

**"Play a file" across all languages:**

| Language | Code |
|----------|------|
| C | `m = libvlc_media_new_path(inst, path); libvlc_media_player_set_media(mp, m); libvlc_media_player_play(mp);` |
| C# | `player.Play(new Media(libVLC, path, FromType.FromPath));` |
| Python | `player = vlc.MediaPlayer(path); player.play()` |
| Java | `component.mediaPlayer().media().play(path);` |
| Go | `media, _ := player.LoadMediaFromPath(path); player.Play()` |
| C++ | `auto m = VLC::Media(inst, path, VLC::Media::FromPath); player.setMedia(m); player.play();` |

---


## §11. Available Language Bindings

| Language | Binding | Package/Repo |
|----------|---------|--------------|
| C | libvlc (native) | `#include <vlc/vlc.h>` |
| C++ | libvlcpp | Header-only, part of VLC ecosystem |
| C# / .NET | LibVLCSharp | NuGet: `LibVLCSharp` + `VideoLAN.LibVLC.*` |
| Python | python-vlc | PyPI: `python-vlc` |
| Java (Desktop) | vlcj | Maven: `uk.co.caprica:vlcj:4.x` |
| Java (Android) | libvlcjni | JitPack / VLC Android SDK |
| Kotlin | vlcj / libvlcjni | Same as Java |
| Objective-C / Swift | VLCKit | CocoaPods: `MobileVLCKit` / `TVVLCKit` |
| Go | libvlc-go | `github.com/adrg/libvlc-go/v3` |
| Rust | vlc-rs | `crates.io/crates/vlc-rs` |
| Dart/Flutter | dart_vlc (desktop), flutter_vlc_player (mobile) | pub.dev |
| Node.js | webchimera.js | npm: `webchimera.js` |

---


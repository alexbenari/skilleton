## §5. Common Workflows

### 5.1 Play a Local File

```c
// [3.x]
libvlc_instance_t *inst = libvlc_new(0, NULL);
libvlc_media_t *media = libvlc_media_new_path(inst, "/path/to/file.mp4");
libvlc_media_player_t *mp = libvlc_media_player_new_from_media(media);
libvlc_media_release(media);
libvlc_media_player_play(mp);
// ... wait or handle events ...
libvlc_media_player_stop(mp);
libvlc_media_player_release(mp);
libvlc_release(inst);
```

```c
// [4.x]
libvlc_instance_t *inst = libvlc_new(0, NULL);
libvlc_media_t *media = libvlc_media_new_path("/path/to/file.mp4");        // no inst
libvlc_media_player_t *mp = libvlc_media_player_new_from_media(inst, media); // inst first
libvlc_media_release(media);
libvlc_media_player_play(mp);
// ... wait or handle events ...
libvlc_media_player_stop_async(mp);  // async
libvlc_media_player_release(mp);
libvlc_release(inst);
```

### 5.2 Play a Network Stream

```c
// [3.x]
libvlc_media_t *media = libvlc_media_new_location(inst, "https://example.com/stream.m3u8");
// [4.x]
// libvlc_media_t *media = libvlc_media_new_location("https://example.com/stream.m3u8");
libvlc_media_add_option(media, ":network-caching=1000");
// Same as local file from here
```

### 5.3 Get Media Metadata

```c
// [3.x]
libvlc_media_t *media = libvlc_media_new_path(inst, path);
libvlc_media_parse_with_options(media, libvlc_media_parse_local | libvlc_media_fetch_local, 5000);
// Wait for parsing (event or poll):
while (libvlc_media_get_parsed_status(media) != libvlc_media_parsed_status_done)
    usleep(100000);

char *title = libvlc_media_get_meta(media, libvlc_meta_Title);
char *artist = libvlc_media_get_meta(media, libvlc_meta_Artist);
int64_t duration = libvlc_media_get_duration(media);  // ms

libvlc_media_track_t **tracks;
unsigned n = libvlc_media_tracks_get(media, &tracks);
// ... inspect tracks ...
libvlc_media_tracks_release(tracks, n);

if (title) libvlc_free(title);
if (artist) libvlc_free(artist);
libvlc_media_release(media);
```

```c
// [4.x]
libvlc_media_t *media = libvlc_media_new_path(path);         // no inst
libvlc_media_parse_request(inst, media,                       // inst required here
    libvlc_media_parse_local | libvlc_media_fetch_local, 5000);
while (libvlc_media_get_parsed_status(media) != libvlc_media_parsed_status_done)
    usleep(100000);

char *title = libvlc_media_get_meta(media, libvlc_meta_Title);
int64_t duration = libvlc_media_get_duration(media);

// Use tracklist API instead of tracks_get
libvlc_media_tracklist_t *tl = libvlc_media_get_tracklist(media, libvlc_track_video);
for (size_t i = 0; i < libvlc_media_tracklist_count(tl); i++) {
    libvlc_media_track_t *t = libvlc_media_tracklist_at(tl, i);
    printf("Video: %dx%d codec=%s\n", t->video->i_width, t->video->i_height,
           libvlc_media_get_codec_description(t->i_type, t->i_codec));
}
libvlc_media_tracklist_delete(tl);

if (title) libvlc_free(title);
libvlc_media_release(media);
```

### 5.4 Extract Thumbnail / Screenshot

**Method 1: Event-based snapshot (recommended, from official `vlc-thumb.c`):**

Seek to 30% position, wait for the seek to complete via events, then take a snapshot. Uses pthread synchronization with a timeout to avoid hanging on broken files.

```c
#include <vlc/vlc.h>
#include <pthread.h>
#include <time.h>

#define THUMBNAIL_POSITION  0.30f   /* 30% into the video */
#define THUMBNAIL_TIMEOUT   5       /* seconds */

static pthread_mutex_t lock = PTHREAD_MUTEX_INITIALIZER;
static pthread_cond_t  wait_cond;
static bool done;

static void callback(const libvlc_event_t *ev, void *param) {
    (void)param;
    pthread_mutex_lock(&lock);
    switch (ev->type) {
    case libvlc_MediaPlayerPositionChanged:
        if (ev->u.media_player_position_changed.new_position
                < THUMBNAIL_POSITION * 0.9f)
            break;  /* not there yet */
        /* fall through */
    case libvlc_MediaPlayerSnapshotTaken:
        done = true;
        pthread_cond_signal(&wait_cond);
        break;
    default:
        break;
    }
    pthread_mutex_unlock(&lock);
}

static int wait_with_timeout(const char *error_msg) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    ts.tv_sec += THUMBNAIL_TIMEOUT;

    pthread_mutex_lock(&lock);
    int ret = done ? 0 : pthread_cond_timedwait(&wait_cond, &lock, &ts);
    pthread_mutex_unlock(&lock);
    if (ret) fprintf(stderr, "%s (timeout)\n", error_msg);
    return ret;
}

int make_thumbnail(const char *input, const char *output_png, int width) {
    static const char *args[] = {
        "--intf", "dummy", "--vout", "dummy",
        "--no-audio", "--no-video-title-show",
        "--no-stats", "--no-sub-autodetect-file",
        "--no-snapshot-preview"
    };
    libvlc_instance_t *vlc = libvlc_new(sizeof(args)/sizeof(*args), args);
    libvlc_media_t *m = libvlc_media_new_path(vlc, input);
    libvlc_media_player_t *mp = libvlc_media_player_new_from_media(m);

    /* Initialize condition variable with monotonic clock */
    pthread_condattr_t attr;
    pthread_condattr_init(&attr);
    pthread_condattr_setclock(&attr, CLOCK_MONOTONIC);
    pthread_cond_init(&wait_cond, &attr);
    pthread_condattr_destroy(&attr);

    libvlc_media_player_play(mp);

    /* Step 1: Seek to position, wait via event */
    libvlc_event_manager_t *em = libvlc_media_player_event_manager(mp);
    libvlc_event_attach(em, libvlc_MediaPlayerPositionChanged, callback, NULL);
    done = false;
    libvlc_media_player_set_position(mp, THUMBNAIL_POSITION);
    int err = wait_with_timeout("Seek failed");
    libvlc_event_detach(em, libvlc_MediaPlayerPositionChanged, callback, NULL);

    if (!err) {
        /* Step 2: Take snapshot, wait for completion */
        libvlc_event_attach(em, libvlc_MediaPlayerSnapshotTaken, callback, NULL);
        done = false;
        libvlc_video_take_snapshot(mp, 0, output_png, width, 0);
        err = wait_with_timeout("Snapshot failed");
        libvlc_event_detach(em, libvlc_MediaPlayerSnapshotTaken, callback, NULL);
    }

    libvlc_media_player_stop(mp);
    libvlc_media_player_release(mp);
    libvlc_media_release(m);
    libvlc_release(vlc);
    pthread_cond_destroy(&wait_cond);
    return err;
}
```

**Key points:**
- Use `--vout=dummy` and `--no-audio` to suppress video/audio output (headless)
- `--no-snapshot-preview` prevents blending the snapshot into the dummy vout
- Always attach/detach events in pairs, and use timeouts to avoid hanging
- `PositionChanged` fires continuously during seeking; wait until within 90% of target before proceeding
- The output filename **must** end in `.png` (VLC uses the extension to detect format)

**Method 2: Video callbacks (headless, custom processing):**
```c
// Set up video callbacks (see §3.3) with desired resolution
// In display callback, save the first frame, then stop
libvlc_video_set_callbacks(mp, lock, unlock, display, ctx);
libvlc_video_set_format(mp, "RV32", 320, 240, 320 * 4);
libvlc_media_player_play(mp);
```

### 5.5 Build a Playlist

```c
libvlc_media_list_t *ml = libvlc_media_list_new(inst);
libvlc_media_list_player_t *mlp = libvlc_media_list_player_new(inst);
libvlc_media_player_t *mp = libvlc_media_player_new(inst);

libvlc_media_list_player_set_media_player(mlp, mp);

libvlc_media_list_lock(ml);
for (int i = 0; i < file_count; i++) {
    libvlc_media_t *m = libvlc_media_new_path(inst, files[i]);
    libvlc_media_list_add_media(ml, m);
    libvlc_media_release(m);
}
libvlc_media_list_unlock(ml);

libvlc_media_list_player_set_media_list(mlp, ml);
libvlc_media_list_player_set_playback_mode(mlp, libvlc_playback_mode_loop);
libvlc_media_list_player_play(mlp);
```

### 5.6 Cast to Chromecast

```c
// 1. Discover renderers
libvlc_renderer_discoverer_t *rd = libvlc_renderer_discoverer_new(inst, "microdns_renderer");
libvlc_event_manager_t *em = libvlc_renderer_discoverer_event_manager(rd);
libvlc_event_attach(em, libvlc_RendererDiscovererItemAdded, on_renderer, ctx);
libvlc_renderer_discoverer_start(rd);

// 2. In callback, save the renderer item
void on_renderer(const libvlc_event_t *e, void *data) {
    libvlc_renderer_item_t *item = e->u.renderer_discoverer_item_added.item;
    libvlc_renderer_item_hold(item);  // Retain
    // Store item for later use
}

// 3. Set renderer on player
libvlc_media_player_set_renderer(mp, chromecast_item);
libvlc_media_player_play(mp);

// 4. Stop casting
libvlc_media_player_set_renderer(mp, NULL);
```

**Chromecast-specific options:**
```c
// On the media:
libvlc_media_add_option(media, ":sout-chromecast-conversion-quality=2");
// Quality: 0=low, 1=medium, 2=high
```

### 5.7 Transcode and Save to File

```c
libvlc_media_t *media = libvlc_media_new_path(inst, "/input.avi");
libvlc_media_add_option(media,
    ":sout=#transcode{vcodec=h264,vb=800,acodec=mpga,ab=128,channels=2}"
    ":std{access=file,mux=mp4,dst=/output.mp4}");
libvlc_media_add_option(media, ":no-sout-all");  // Only stream the first track
libvlc_media_add_option(media, ":sout-keep");

libvlc_media_player_t *mp = libvlc_media_player_new_from_media(media);
libvlc_media_release(media);
libvlc_media_player_play(mp);
// Wait for EndReached event
```

**C# (LibVLCSharp) — Record an HLS stream to file:**
```csharp
using var libvlc = new LibVLC();
using var mediaPlayer = new MediaPlayer(libvlc);

libvlc.Log += (sender, e) => Console.WriteLine($"[{e.Level}] {e.Module}:{e.Message}");
mediaPlayer.EndReached += (sender, e) =>
    Console.WriteLine("Recording complete: " + destination);

var destination = Path.Combine(Directory.GetCurrentDirectory(), "record.ts");
using var media = new Media(libvlc,
    new Uri("http://example.com/stream.m3u8"),
    ":sout=#file{dst=" + destination + "}",
    ":sout-keep");

mediaPlayer.Play(media);
// Playback continues until the stream ends — EndReached fires when done
```

**Key points:**
- Use `#file{dst=...}` for passthrough recording (no transcoding) — preserves original codecs
- Use `#transcode{...}:std{access=file,...}` when codec conversion is needed
- `:sout-keep` keeps the sout chain alive across media changes
- `:no-sout-all` limits streaming to the first track of each type (avoids duplicate tracks)

### 5.8 Stream Over HTTP

```c
libvlc_media_t *media = libvlc_media_new_path(inst, "/input.mp4");
libvlc_media_add_option(media,
    ":sout=#transcode{vcodec=h264,acodec=mpga}:http{mux=ts,dst=:8080/stream}");

libvlc_media_player_t *mp = libvlc_media_player_new_from_media(media);
libvlc_media_release(media);
libvlc_media_player_play(mp);
// Stream available at http://localhost:8080/stream
```

### 5.9 Record/Capture from Camera

```c
// Linux (Video4Linux)
libvlc_media_t *media = libvlc_media_new_location(inst, "v4l2:///dev/video0");
libvlc_media_add_option(media, ":v4l2-width=640");
libvlc_media_add_option(media, ":v4l2-height=480");

// To save: add sout option
libvlc_media_add_option(media,
    ":sout=#transcode{vcodec=h264}:std{access=file,mux=mp4,dst=capture.mp4}");
```

### 5.10 Record the Screen

Capture the entire screen to a video file using the `screen://` access module. Works on Windows, macOS, and Linux.

**C:**
```c
libvlc_media_t *media = libvlc_media_new_location(inst, "screen://");
libvlc_media_add_option(media, ":screen-fps=24");
libvlc_media_add_option(media,
    ":sout=#transcode{vcodec=h264,vb=0,scale=0,acodec=mp4a,ab=128,"
    "channels=2,samplerate=44100}:file{dst=record.mp4}");
libvlc_media_add_option(media, ":sout-keep");

libvlc_media_player_t *mp = libvlc_media_player_new_from_media(media);
libvlc_media_release(media);
libvlc_media_player_play(mp);  // Start recording

// ... record for desired duration ...

libvlc_media_player_stop(mp);  // Stop recording and finalize file
libvlc_media_player_release(mp);
```

**C# (LibVLCSharp):**
```csharp
using var libvlc = new LibVLC();
using var mediaPlayer = new MediaPlayer(libvlc);
using var media = new Media(libvlc, "screen://", FromType.FromLocation);

media.AddOption(":screen-fps=24");
media.AddOption(":sout=#transcode{vcodec=h264,vb=0,scale=0,acodec=mp4a," +
    "ab=128,channels=2,samplerate=44100}:file{dst=record.mp4}");
media.AddOption(":sout-keep");

mediaPlayer.Play(media);       // Start recording
await Task.Delay(5000);        // Record for 5 seconds
mediaPlayer.Stop();            // Stop and save
```

**Key points:**
- `screen://` is a pseudo-MRL — it captures the entire primary display
- `vb=0,scale=0` in transcode means auto-bitrate and original resolution
- `:screen-fps=24` controls capture frame rate (higher = smoother but larger files)
- The file is only finalized when `Stop()` is called — ensure clean shutdown
- On Linux, requires X11 (Wayland support varies); on macOS, requires screen recording permission

### 5.11 Browse NAS / UPnP Shares

```c
// 1. Get UPnP media discoverer
libvlc_media_discoverer_t *md = libvlc_media_discoverer_new(inst, "upnp");
libvlc_media_discoverer_start(md);

// 2. Get discovered media list
libvlc_media_list_t *ml = libvlc_media_discoverer_media_list(md);

// 3. Each item is a directory or media
libvlc_media_list_lock(ml);
int count = libvlc_media_list_count(ml);
for (int i = 0; i < count; i++) {
    libvlc_media_t *m = libvlc_media_list_item_at_index(ml, i);
    libvlc_media_type_t type = libvlc_media_get_type(m);
    if (type == libvlc_media_type_directory) {
        // Browse sub-items: parse, then check subitems
        libvlc_media_parse_with_options(m, libvlc_media_parse_network, 5000);
        libvlc_media_list_t *sub = libvlc_media_subitems(m);
        // ... recurse ...
    }
    libvlc_media_release(m);
}
libvlc_media_list_unlock(ml);
```

**C# (LibVLCSharp) — Local Network Browser with MediaDiscoverer:**

Discover LAN services (UPnP, SMB shares) and browse directories. This pattern is used in media browser applications:

```csharp
var libVLC = new LibVLC("--verbose=2");
var mediaDiscoverers = new List<MediaDiscoverer>();

// Find all LAN-type discoverers and start them
foreach (var md in libVLC.MediaDiscoverers(MediaDiscovererCategory.Lan))
{
    var discoverer = new MediaDiscoverer(libVLC, md.Name);

    // Listen for discovered items (e.g., UPnP servers, SMB shares)
    discoverer.MediaList.ItemAdded += (sender, e) =>
        Console.WriteLine($"Found: {e.Media.Meta(MetadataType.Title)}");
    discoverer.MediaList.ItemDeleted += (sender, e) =>
        Console.WriteLine($"Lost: {e.Media.Meta(MetadataType.Title)}");

    mediaDiscoverers.Add(discoverer);
}

// Start discovery
foreach (var md in mediaDiscoverers)
    md.Start();

// Browse into a discovered directory
async Task BrowseDirectory(Media directoryMedia)
{
    // Parse to discover sub-items
    directoryMedia.SubItems.ItemAdded += (sender, e) =>
        Console.WriteLine($"  Sub-item: {e.Media.Meta(MetadataType.Title)}");

    await directoryMedia.Parse(MediaParseOptions.ParseNetwork);
    // Sub-items are now accessible via directoryMedia.SubItems
}
```

### 5.12 Select Audio, Video, and Subtitle Tracks

Track selection must happen **after** playback starts (tracks are discovered during demuxing). Wait for the `MediaPlayerPlaying` event or poll until tracks are available.

**C — Enumerate and select tracks `[3.x]`:**
```c
// [3.x] Wait until playing (tracks aren't available before playback starts)
// Then enumerate audio tracks:
libvlc_track_description_t *tracks = libvlc_audio_get_track_description(mp);
for (libvlc_track_description_t *t = tracks; t != NULL; t = t->p_next) {
    printf("Audio track %d: %s\n", t->i_id, t->psz_name);
}
libvlc_track_description_list_release(tracks);

// Select audio track by ID (i_id from description):
libvlc_audio_set_track(mp, track_id);

// Disable audio: set track to -1
libvlc_audio_set_track(mp, -1);

// Video tracks (same pattern):
libvlc_track_description_t *vtracks = libvlc_video_get_track_description(mp);
libvlc_video_set_track(mp, video_track_id);
libvlc_track_description_list_release(vtracks);

// Subtitle tracks:
libvlc_track_description_t *stracks = libvlc_video_get_spu_description(mp);
libvlc_video_set_spu(mp, subtitle_track_id);
libvlc_track_description_list_release(stracks);

// Disable subtitles:
libvlc_video_set_spu(mp, -1);

// Add external subtitle file at runtime:
libvlc_media_player_add_slave(mp, libvlc_media_slave_type_subtitle,
    "file:///path/to/subtitles.srt", true);

// Add external audio track at runtime:
libvlc_media_player_add_slave(mp, libvlc_media_slave_type_audio,
    "file:///path/to/audio.aac", true);

// Adjust subtitle/audio sync:
libvlc_video_set_spu_delay(mp, 500000);   // +500ms (microseconds)
libvlc_audio_set_delay(mp, -200000);       // -200ms
```

**C# (LibVLCSharp):**
```csharp
player.Playing += (s, e) =>
{
    // Audio tracks (0 = disable, 1+ = track index)
    foreach (var track in player.AudioTrackDescription)
        Console.WriteLine($"Audio {track.Id}: {track.Name}");
    player.SetAudioTrack(trackId);

    // Subtitle tracks (SPU)
    foreach (var track in player.SpuDescription)
        Console.WriteLine($"Sub {track.Id}: {track.Name}");
    player.SetSpu(trackId);
    player.SetSpu(-1);  // Disable subtitles

    // Add external subtitle
    player.AddSlave(MediaSlaveType.Subtitle, "file:///path/to/subs.srt", true);

    // Subtitle delay
    player.SetSpuDelay(500000);  // +500ms in microseconds
};
```

**Python:**
```python
import vlc, time

player = vlc.MediaPlayer("video.mkv")
player.play()
time.sleep(2)  # Wait for tracks to become available

# Audio tracks
for t in player.audio_get_track_description():
    print(f"Audio {t[0]}: {t[1]}")
player.audio_set_track(track_id)

# Subtitle tracks
for t in player.video_get_spu_description():
    print(f"Sub {t[0]}: {t[1]}")
player.video_set_spu(track_id)
player.video_set_spu(-1)  # Disable

# External subtitle
player.add_slave(vlc.MediaSlaveType.subtitle, "file:///path/to/subs.srt", True)
```

**`[4.x]` Track selection with tracklist API (C):**
```c
// Get all audio tracks
libvlc_media_tracklist_t *tl =
    libvlc_media_player_get_tracklist(mp, libvlc_track_audio, false);
for (size_t i = 0; i < libvlc_media_tracklist_count(tl); i++) {
    libvlc_media_track_t *t = libvlc_media_tracklist_at(tl, i);
    printf("Audio '%s': %s %s\n", t->psz_id, t->psz_name,
           t->selected ? "(selected)" : "");
}

// Select a specific track
libvlc_media_player_select_track(mp, libvlc_media_tracklist_at(tl, 1));
libvlc_media_tracklist_delete(tl);

// Disable all subtitles
libvlc_media_player_unselect_track_type(mp, libvlc_track_text);

// Select by string ID
libvlc_media_player_select_tracks_by_ids(mp, libvlc_track_audio, "audio/0");

// Add external subtitle (same in both versions)
libvlc_media_player_add_slave(mp, libvlc_media_slave_type_subtitle,
    "file:///path/to/subs.srt", true);
```

**Key points:**
- `[3.x]` Track IDs come from the `i_id` field of `libvlc_track_description_t`, NOT sequential indices
- `[3.x]` Track ID `-1` typically means "disable" (no audio / no subtitle)
- `[4.x]` Track IDs are strings (`psz_id`), e.g., `"audio/0"`, `"video/0"`, `"spu/0"`
- `[4.x]` Use `unselect_track_type()` to disable all tracks of a type
- `add_slave()` can add external subtitles or audio tracks **during playback** — the `select` parameter (`true`) auto-selects the new track
- Subtitle and audio delays are in **microseconds** and reset when media changes

### 5.13 Video Mosaic (Multiple Players)

Play multiple video streams simultaneously using separate `MediaPlayer` instances sharing a single `LibVLC` instance. Common for CCTV/surveillance dashboards or multi-camera views.

**C:**
```c
// Single instance, multiple players
libvlc_instance_t *inst = libvlc_new(0, NULL);

libvlc_media_player_t *players[4];
const char *urls[] = {
    "rtsp://camera1/stream", "rtsp://camera2/stream",
    "rtsp://camera3/stream", "rtsp://camera4/stream"
};

for (int i = 0; i < 4; i++) {
    players[i] = libvlc_media_player_new(inst);
    libvlc_media_player_set_hwnd(players[i], window_handles[i]);  // One window per player
    libvlc_media_t *m = libvlc_media_new_location(inst, urls[i]);
    libvlc_media_player_set_media(players[i], m);
    libvlc_media_release(m);
    libvlc_media_player_play(players[i]);
}

// Cleanup: stop and release each player, then release instance
```

**C# (LibVLCSharp / Xamarin.Forms) — RTSP Mosaic:**
```csharp
const string VideoUrl = "rtsp://camera/stream";
var libvlc = new LibVLC();

// Create separate MediaPlayer for each VideoView in the layout
VideoView0.MediaPlayer = new MediaPlayer(libvlc);
using (var media = new Media(libvlc, new Uri(VideoUrl)))
    VideoView0.MediaPlayer.Play(media);

VideoView1.MediaPlayer = new MediaPlayer(libvlc);
using (var media = new Media(libvlc, new Uri(VideoUrl)))
    VideoView1.MediaPlayer.Play(media);

// Repeat for VideoView2, VideoView3, etc.
```

**Key points:**
- **Always share a single `LibVLC` instance** — each `MediaPlayer` has its own decoder pipeline but shares plugin infrastructure
- Each `MediaPlayer` needs its own video output window/surface — never share a window between players
- For RTSP streams, set `:network-caching=1000` to buffer against network jitter
- On mobile, consider CPU/GPU limits — 4+ simultaneous HD streams may drop frames

### 5.14 Mobile Foreground/Background Lifecycle (Android)

On Android, the native video surface is released when the app goes to background. You must save playback state, tear down the `VideoView`, and recreate it when returning to foreground.

**C# (LibVLCSharp.Forms / Xamarin.Forms):**
```csharp
LibVLC _libVLC;
MediaPlayer _mediaPlayer;
float _position;

// When app goes to background (OnPause):
MessagingCenter.Subscribe<string>(this, "OnPause", app =>
{
    _mediaPlayer.Pause();
    _position = _mediaPlayer.Position;  // Save position (0.0–1.0)
    _mediaPlayer.Stop();
    MainGrid.Children.Clear();          // Remove VideoView (releases native surface)
});

// When app returns to foreground (OnRestart):
MessagingCenter.Subscribe<string>(this, "OnRestart", app =>
{
    var videoView = new VideoView {
        HorizontalOptions = LayoutOptions.FillAndExpand,
        VerticalOptions = LayoutOptions.FillAndExpand
    };
    MainGrid.Children.Add(videoView);   // Create fresh VideoView

    videoView.MediaPlayer = _mediaPlayer;
    _mediaPlayer.Position = _position;   // Restore position
    _position = 0;
    _mediaPlayer.Play();
});
```

**Key points:**
- On Android, the native libvlc video surface is destroyed when the app is paused/stopped — this is a platform behavior, not a bug
- **Save** `Position` (or `Time`) before `Stop()`, and **remove** the `VideoView` from the layout
- On resume, create a **new** `VideoView` and add it to the layout — reattach the existing `MediaPlayer`
- The `MediaPlayer` object itself survives backgrounding — only the view surface needs recreation
- iOS does not have this issue — `UIView` survives background transitions
- For MAUI/.NET 8+, use `Application.Current.Windows[0].Activated` / `Deactivated` instead of `MessagingCenter`

### 5.15 Gesture-Based Playback Control

Map touch/pan gestures to seeking and volume control. Horizontal swipes control time position, vertical swipes control volume.

**C# (Xamarin.Forms — PanGestureRecognizer):**
```csharp
long _finalTime;
int _finalVolume;
bool _timeChanged, _volumeChanged;

void OnGesture(PanUpdatedEventArgs e)
{
    switch (e.StatusType)
    {
        case GestureStatus.Running:
            if (Math.Abs(e.TotalX) > Math.Abs(e.TotalY))
            {
                // Horizontal swipe → seek
                var timeDiff = Convert.ToInt64(e.TotalX * 1000);  // ms
                _finalTime = MediaPlayer.Time + timeDiff;
                _timeChanged = true;
            }
            else
            {
                // Vertical swipe → volume (up = louder)
                var volume = (int)(MediaPlayer.Volume + e.TotalY * -1);
                _finalVolume = Math.Clamp(volume, 0, 200);
                _volumeChanged = true;
            }
            break;

        case GestureStatus.Completed:
            if (_timeChanged)
                MediaPlayer.Time = _finalTime;
            if (_volumeChanged)
                MediaPlayer.Volume = _finalVolume;
            _timeChanged = _volumeChanged = false;
            break;
    }
}
```

**Key points:**
- Apply time/volume changes on `GestureStatus.Completed`, not `Running` — avoids excessive libvlc calls during the drag
- Volume range is 0–200 (100 = normal, >100 = amplification)
- `Time` is in milliseconds — multiply gesture distance by a scaling factor for natural feel
- This pattern works for 360° video too — map gestures to `UpdateViewpoint()` yaw/pitch instead

### 5.16 Hardware-Accelerated Playback (EnableHardwareDecoding)

Enable platform-specific hardware decoding for better performance and lower CPU usage.

**C:**
```c
const char *args[] = {"--avcodec-hw=any"};  // auto-select best HW decoder
libvlc_instance_t *inst = libvlc_new(1, args);
// Hardware decoding options: "any", "none", "d3d11va" (Win), "vaapi" (Linux),
// "videotoolbox" (macOS/iOS), "mediacodec" (Android)
```

**C# (LibVLCSharp):**
```csharp
var media = new Media(LibVLC,
    new Uri("http://example.com/video.mp4"));
var mediaPlayer = new MediaPlayer(media) { EnableHardwareDecoding = true };
media.Dispose();
mediaPlayer.Play();
```

**Key points:**
- `EnableHardwareDecoding = true` maps to `--avcodec-hw=any` in libvlc
- Hardware decoding reduces CPU usage significantly for H.264/H.265 content
- Falls back to software decoding automatically if hardware decoder is unavailable
- On Android, uses MediaCodec; on iOS/macOS, uses VideoToolbox; on Windows, uses D3D11VA or DXVA2
- If you see green/corrupt frames, try disabling hardware decoding as a diagnostic step (see §8.2)

### 5.17 Audio-Only Playback (Music Player)

Build a music player by disabling video output. Reduces resource usage and works headless.

**C# (LibVLCSharp) — Audio service with event-driven UI updates:**
```csharp
var libVLC = new LibVLC();
var mediaPlayer = new MediaPlayer(libVLC);

// Create media with video disabled
using var media = new Media(libVLC,
    new Uri("https://example.com/song.mp4"), ":no-video");
mediaPlayer.Media = media;

// Subscribe to playback events for UI updates
mediaPlayer.TimeChanged += (s, e) => UpdateTimeDisplay(e.Time);
mediaPlayer.PositionChanged += (s, e) => UpdateSeekBar(e.Position);
mediaPlayer.LengthChanged += (s, e) => UpdateDuration(e.Length);
mediaPlayer.EndReached += (s, e) => OnTrackFinished();
mediaPlayer.Playing += (s, e) => ShowPlayingState();
mediaPlayer.Paused += (s, e) => ShowPausedState();

mediaPlayer.Play();

// Seeking: offset by milliseconds
mediaPlayer.Time += 5000;   // Forward 5 seconds
mediaPlayer.Time -= 5000;   // Rewind 5 seconds
```

**Key points:**
- `:no-video` prevents video decoding entirely — not just hiding the output
- `TimeChanged` and `PositionChanged` fire frequently during playback — use them for scrubber/progress UI
- `LengthChanged` fires once the duration is known (may not be immediate for streams)
- Remember: never call libvlc from event callbacks — offload to UI thread

---


## §7. Streaming & Transcoding

### 7.1 Sout Chain Syntax

The stream output chain uses the `:sout=` option with `#module{params}:module{params}` syntax:

```
:sout=#transcode{<params>}:standard{<params>}
:sout=#transcode{<params>}:duplicate{dst=display,dst=standard{<params>}}
```

**Common sout modules:**

| Module | Purpose | Key Parameters |
|--------|---------|---------------|
| `transcode` | Convert codec | `vcodec`, `vb` (bitrate), `acodec`, `ab`, `channels`, `width`, `height`, `fps`, `scale` |
| `standard`/`std` | Output destination | `access` (file/http/udp), `mux` (ts/mp4/ogg/webm), `dst` (path/url) |
| `duplicate` | Split stream | `dst=display` (show locally), `dst=standard{...}` |
| `rtp` | RTP streaming | `dst`, `port`, `mux` |
| `http` | HTTP streaming | `dst`, `mux` |

### 7.2 Common Sout Recipes

**Save to file:**
```
:sout=#transcode{vcodec=h264,vb=2000,acodec=mp4a,ab=192}:std{access=file,mux=mp4,dst=/output.mp4}
```

**HTTP live stream:**
```
:sout=#transcode{vcodec=h264,acodec=mpga,ab=128}:http{mux=ts,dst=:8080/stream}
```

**UDP multicast:**
```
:sout=#transcode{vcodec=h264}:rtp{mux=ts,dst=239.0.0.1,port=1234}
```

**Display locally AND save:**
```
:sout=#transcode{vcodec=h264}:duplicate{dst=display,dst=std{access=file,mux=mp4,dst=out.mp4}}
```

**Audio only (extract audio):**
```
:sout=#transcode{acodec=mp3,ab=192}:std{access=file,mux=raw,dst=output.mp3}
:no-video
```

### 7.3 Video Codecs

| Codec ID | Codec | Notes |
|----------|-------|-------|
| `h264` | H.264/AVC | Most compatible |
| `h265` | H.265/HEVC | Better compression |
| `mp4v` | MPEG-4 Part 2 | Legacy |
| `VP80` | VP8 | WebM |
| `VP90` | VP9 | WebM, better |
| `theo` | Theora | Ogg |
| `none` | No video | Strip video track |

### 7.4 Audio Codecs

| Codec ID | Codec | Notes |
|----------|-------|-------|
| `mpga` | MP3 | Universal |
| `mp4a` | AAC | Better quality |
| `vorb` | Vorbis | Ogg |
| `opus` | Opus | Best for voice |
| `flac` | FLAC | Lossless |
| `none` | No audio | Strip audio track |

### 7.5 Container Formats (Mux)

| Mux | Format | Typical Use |
|-----|--------|-------------|
| `ts` | MPEG-TS | Streaming (HTTP, UDP) |
| `mp4` | MP4/MOV | File output |
| `ogg` | Ogg | Vorbis/Theora |
| `webm` | WebM | VP8/VP9 + Opus |
| `avi` | AVI | Legacy |
| `raw` | Raw | Single codec output |
| `asf` | ASF/WMV | Windows |

---

## §8. Troubleshooting & Gotchas

### 8.1 Critical Pitfalls (Will Bite You)

#### Deadlock from Event Callbacks
**Symptom:** Application freezes/hangs during playback event.
**Cause:** Calling any libvlc function from within a libvlc event callback.
**Fix:** Offload work to another thread. See §2.2 for per-language patterns.

#### Stop() Freezing
**Symptom:** `libvlc_media_player_stop()` blocks for seconds (especially RTSP streams in LibVLC 3).
**Fix:** Call `stop()` from a background thread:
```csharp
// C#
ThreadPool.QueueUserWorkItem(_ => player.Stop());
```
```java
// Java
mediaPlayer.submit(() -> mediaPlayer.controls().stop());
```

#### Memory Leaks from Event Handlers
**Symptom:** Growing memory usage over time.
**Cause (C#):** LibVLCSharp events are native callbacks. Failing to unsubscribe causes both managed and native memory leaks.
**Fix:** Always unsubscribe event handlers before disposing objects:
```csharp
player.Playing -= OnPlaying;
player.Dispose();
```

#### Multiple LibVLC Instances
**Symptom:** Crashes, undefined behavior, plugin conflicts.
**Cause:** Creating more than one `libvlc_instance_t`.
**Fix:** Create exactly ONE instance, share it across all players.

#### GC Collecting Active Players
**Symptom:** Random crashes, especially in Java/Python.
**Cause:** Player object goes out of scope while native thread still runs.
**Fix:** Keep strong references to all libvlc objects as class fields, not local variables.

#### Untrusted Input to `media_add_option` (Security)
**Symptom:** Media exfiltration, arbitrary file writes, or unexpected streaming behavior.
**Cause:** `libvlc_media_add_option()` treats the option as **trusted** — it can set `sout` chains, write files, open network streams, etc. If the option string comes from user input (e.g., a URL parameter, config file, or UI text field), an attacker can inject `:sout=#transcode{...}:std{access=file,dst=/etc/passwd}` or redirect media to a remote server.
**Fix:** Use `libvlc_media_add_option_flag()` with the **untrusted** flag (value `0x0`, the default when no flags are set) for any user-provided input. Only use `libvlc_media_option_trusted` (`0x2`) for options your application controls:
```c
// SAFE — user-provided options are untrusted (default flag = 0)
libvlc_media_add_option_flag(media, user_input, 0);

// TRUSTED — only for app-controlled options
libvlc_media_add_option_flag(media, ":network-caching=1000", libvlc_media_option_trusted);

// DANGEROUS — libvlc_media_add_option() always trusts the input
// Never pass user/network input to this function:
libvlc_media_add_option(media, user_input);  // ⚠️ DO NOT DO THIS
```
**Binding equivalents:**
- **C#** (LibVLCSharp): `media.AddOption(":option")` — trusted by default. Validate/sanitize user input before passing.
- **Python**: `media.add_option(":option")` — same caveat.
- **vlcj**: `media().play(mrl, ":option")` — trusted. Sanitize.

### 8.2 Common Issues

#### Green/Corrupt Video Frames
**Cause:** GPU driver issue or incompatible hardware decoding.
**Fix:**
1. Update GPU drivers
2. Disable hardware decoding: `--avcodec-hw=none`
3. Try different video output: `--vout=x11` (Linux), `--vout=directdraw` (Windows)

#### No Audio Output
**Cause:** Audio output device not configured or unavailable.
**Fix:**
1. List available outputs: `libvlc_audio_output_list_get()`
2. Set explicitly: `libvlc_audio_output_set(mp, "alsa")` (or `"directsound"`, `"coreaudio"`)
3. Check volume: `libvlc_audio_set_volume(mp, 100)`

#### Chromecast Not Found
**Cause:** VPN blocking mDNS discovery, or network isolation.
**Fix:**
1. Disconnect VPN
2. Ensure device is on same subnet
3. Check firewall (mDNS uses port 5353/UDP)

#### YouTube URLs Not Playing
**Cause:** YouTube requires network parsing to resolve actual stream URL.
**Fix:**
```c
libvlc_media_parse_with_options(media, libvlc_media_parse_network, 10000);
// Then play first sub-item:
libvlc_media_list_t *subs = libvlc_media_subitems(media);
libvlc_media_list_lock(subs);
libvlc_media_t *actual = libvlc_media_list_item_at_index(subs, 0);
libvlc_media_list_unlock(subs);
libvlc_media_player_set_media(mp, actual);
libvlc_media_player_play(mp);
```

#### Slow Startup / Plugin Scan
**Cause:** LibVLC scans all plugins on first `libvlc_new()`.
**Fix:**
1. Pre-generate `plugins.dat` cache file (or use `--reset-plugins-cache` once, then rely on cache)
2. Initialize LibVLC early (splash screen, app startup)
3. Reuse the instance — don't destroy and recreate
4. Use `--no-plugins-scan` to skip directory scanning and load only from cache (if cache exists)
5. See §2.7 for full plugin discovery details and `VLC_PLUGIN_PATH` usage

#### Video Callbacks Performance (LibVLC 3.x)
**Cause:** CPU-based pixel copying with no GPU acceleration.
**Fix:**
1. Use smallest necessary resolution
2. Use `I420` chroma (smaller than `RV32`)
3. Process frames asynchronously — don't block the lock/unlock callbacks

#### Subtitle Encoding Issues
**Fix:** Set encoding option:
```c
// Instance level:
"--subsdec-encoding=Windows-1252"
// Or per-media:
":subsdec-encoding=UTF-8"
```

### 8.3 Debugging Methodology

1. **Enable verbose logging:**
   ```c
   const char *args[] = {"--verbose=2"};
   libvlc_instance_t *inst = libvlc_new(1, args);
   ```
   Or set log callback to capture programmatically (see §2.5).

2. **Build minimal reproduction:** Isolate the issue in the smallest possible code.

3. **Check the logs:** Look for `[error]` and `[warning]` lines. Common indicators:
   - `no suitable decoder` — missing codec plugin
   - `connection refused` — network issue
   - `main decoder error` — corrupt media or unsupported format

4. **Regression test:** Does it work in official VLC app? Does it work with a different file? Different platform?

5. **Version check:** `libvlc_get_version()` — verify you're running expected version.

---

## §9. CLI Options Quick Reference

### Instance-Level (`--option=value` in constructor)

| Option | Description | Default |
|--------|-------------|---------|
| `--verbose=N` | Log verbosity: 0=errors, 1=warnings, 2=debug | 0 |
| `--no-video-title-show` | Don't show media title on video | off |
| `--no-video` | Disable video output entirely | off |
| `--no-audio` | Disable audio output entirely | off |
| `--avcodec-hw=MODE` | Hardware decoding: `any`, `none`, `d3d11va`, `vaapi`, `videotoolbox` | `any` |
| `--network-caching=MS` | Network stream buffer in ms | 1000 |
| `--file-caching=MS` | File stream buffer in ms | 300 |
| `--live-caching=MS` | Live stream buffer in ms | 300 |
| `--vout=MODULE` | Video output: `x11`, `gl`, `directdraw`, `d3d11`, `caca` | auto |
| `--aout=MODULE` | Audio output: `pulse`, `alsa`, `directsound`, `coreaudio`, `winstore` | auto |
| `--freetype-rel-fontsize=N` | Subtitle font size (relative) | 16 |
| `--freetype-color=N` | Subtitle color (decimal, e.g., 16711680 = red) | 16777215 |
| `--subsdec-encoding=ENC` | Subtitle encoding: `UTF-8`, `Windows-1252`, etc. | auto |
| `--hrtf-file=PATH` | 3D audio HRTF file path | — |
| `--no-plugins-cache` | Disable plugin cache, force re-scan every startup | cache enabled |
| `--no-plugins-scan` | Don't scan plugin dirs, load from cache only | scan enabled |
| `--reset-plugins-cache` | Rebuild `plugins.dat` cache on next startup | off |

### Media-Level (`:option=value` via `media_add_option`)

| Option | Description |
|--------|-------------|
| `:no-audio` | Disable audio for this media |
| `:no-video` | Disable video for this media |
| `:network-caching=MS` | Override network caching |
| `:start-time=SEC` | Start playback at N seconds |
| `:stop-time=SEC` | Stop playback at N seconds |
| `:run-time=SEC` | Play for N seconds |
| `:sub-file=PATH` | External subtitle file path |
| `:sub-language=LANG` | Preferred subtitle language (e.g., `"eng"`, `"none"`) |
| `:sout=CHAIN` | Stream output chain (see §7) |
| `:sout-keep` | Keep sout instance across media changes |
| `:no-sout-all` | Only stream first track of each type |
| `:sout-chromecast-conversion-quality=N` | Chromecast quality: 0=low, 1=medium, 2=high |
| `:input-repeat=N` | Repeat input N times (0=play once) |

**Format difference:** Instance options use `--double-dash`, Media options use `:colon-prefix`.

---

## §10. Deprecated API — Do NOT Use

The following functions are deprecated. Always suggest their modern replacements:

| Deprecated | Replacement |
|-----------|-------------|
| `libvlc_media_parse()` | `libvlc_media_parse_with_options()` |
| `libvlc_media_parse_async()` | `libvlc_media_parse_with_options()` |
| `libvlc_media_is_parsed()` | `libvlc_media_get_parsed_status()` |
| `libvlc_media_get_tracks_info()` | `libvlc_media_tracks_get()` |
| `libvlc_media_player_get_fps()` | `libvlc_media_tracks_get()` (get FPS from video track info) |
| `libvlc_video_get_height()` | `libvlc_video_get_size()` |
| `libvlc_video_get_width()` | `libvlc_video_get_size()` |
| `libvlc_video_set_subtitle_file()` | `libvlc_media_player_add_slave()` |
| `libvlc_track_description_release()` | `libvlc_track_description_list_release()` |
| `libvlc_media_player_set_agl()` | `libvlc_media_player_set_nsobject()` |
| `libvlc_media_discoverer_new_from_name()` | `libvlc_media_discoverer_new()` + `_start()` |
| `libvlc_media_discoverer_localized_name()` | `libvlc_media_discoverer_list_get()` |
| `libvlc_wait()` | `libvlc_set_exit_handler()` |
| `libvlc_log_open/close/count/clear/get_iterator/iterator_*()` | `libvlc_log_set()` with callback |
| `libvlc_playlist_play()` | `libvlc_media_list` + `libvlc_media_list_player` |
| `libvlc_audio_output_device_count/longname/id()` | `libvlc_audio_output_device_list_get()` |
| `libvlc_toggle_teletext()` | `libvlc_video_set_teletext()` |

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

## §12. Quick Decision Guide

**"Which binding should I use?"**

| Platform | Recommended Binding |
|----------|-------------------|
| Windows desktop (.NET) | LibVLCSharp |
| macOS/iOS/tvOS (Swift) | VLCKit |
| Android (Kotlin/Java) | libvlcjni + LibVLCSharp.Android |
| Cross-platform .NET (MAUI, Avalonia) | LibVLCSharp |
| Desktop Java/Kotlin | vlcj 4.x |
| Python scripting | python-vlc |
| Go application | libvlc-go |
| C/C++ application | libvlc / libvlcpp |
| Rust application | vlc-rs |
| Electron/Web | webchimera.js or LibVLC WASM (experimental) |

**"How should I render video?"**

| Need | Approach |
|------|----------|
| Embedded in native window | `set_hwnd`/`set_xwindow`/`set_nsobject` |
| Custom rendering / texture | `[3.x]` Video callbacks (lock/unlock/display). `[4.x]` GPU output callbacks (`set_output_callbacks`). |
| Headless (no display) | `--no-video` or video callbacks to `/dev/null`. `[4.x]` `libvlc_video_engine_disable`. |
| Off-screen thumbnail | `[3.x]` Video callbacks, capture first frame. `[4.x]` Use `libvlc_media_thumbnail_request_by_time()`. |
| Multiple simultaneous videos | Multiple MediaPlayers, one LibVLC instance |

**"How do I handle the end of playback?"**

All bindings: Listen for `EndReached` / `MediaPlayerEndReached` event. **Always** offload the next action to a different thread — never call libvlc from the callback.

---


## §3. API Reference by Domain

This file is a curated API guide, not the canonical signature source. Use it to choose the right libvlc domain, understand common version differences, and avoid recurring traps. Before generating or reviewing code that depends on exact function signatures, verify against the target project's installed `<vlc/vlc.h>` headers, the relevant binding documentation, or the official VideoLAN source/docs for that version.

The examples below are orientation snapshots. Prefer current headers, generated binding docs, and symbolic constants over copied raw integers or stale signatures, especially for libvlc 4.x.

### 3.1 Instance (`libvlc_instance_t`)

| Function | Description |
|----------|-------------|
| `libvlc_new(argc, argv)` | Create instance. `argv` = VLC CLI args (e.g., `"--verbose=2"`). Returns `NULL` on failure. |
| `libvlc_release(inst)` | Release instance (decrement refcount) |
| `libvlc_retain(inst)` | Increment refcount |
| `libvlc_add_intf(inst, name)` | `[3.x]` Add interface module (e.g., `"http"` for web control). `NULL` = default. Removed in 4.x. |
| `libvlc_set_exit_handler(inst, cb, opaque)` | `[3.x]` Callback when libvlc wants to exit. Removed in 4.x. |
| `libvlc_set_user_agent(inst, name, http)` | Set application name and HTTP User-Agent |
| `libvlc_set_app_id(inst, id, version, icon)` | Set app ID (e.g., `"com.example.myapp"`) |
| `libvlc_get_version()` | Returns version string (e.g., `"3.0.18 Vetinari"`) |
| `libvlc_get_compiler()` | Returns compiler used to build libvlc |
| `libvlc_get_changeset()` | Returns git changeset hash |
| `libvlc_abi_version()` | `[4.x]` Returns ABI version string for compatibility checks |

**Constructor arguments** use VLC CLI format: `"--option=value"`. Common:
```c
const char *args[] = {
    "--verbose=2",          // Debug logging
    "--no-video-title-show", // Don't show title overlay
    "--network-caching=1000", // 1 second network buffer
};
libvlc_instance_t *inst = libvlc_new(3, args);
```

### 3.2 Media (`libvlc_media_t`)

#### Creation

**`[4.x change]`** In 4.x, all media creation functions **drop** the `libvlc_instance_t*` parameter — media is no longer bound to an instance at creation time.

| Function (3.x) | Function (4.x) | Description |
|----------|----------|-------------|
| `libvlc_media_new_location(inst, mrl)` | `libvlc_media_new_location(mrl)` | From URL/MRL (e.g., `"https://..."`, `"rtsp://..."`) |
| `libvlc_media_new_path(inst, path)` | `libvlc_media_new_path(path)` | From local file path (auto-converts to `file://` MRL) |
| `libvlc_media_new_fd(inst, fd)` | `libvlc_media_new_fd(fd)` | From file descriptor (ownership transfers to libvlc) |
| `libvlc_media_new_callbacks(inst, open, read, seek, close, opaque)` | `libvlc_media_new_callbacks(open, read, seek, close, opaque)` | From custom bitstream callbacks |
| `libvlc_media_new_as_node(inst, name)` | `libvlc_media_new_as_node(name)` | Create empty node (for playlists) |

#### Options

```c
// Per-media options use ":option=value" format (note: colon, not double-dash)
libvlc_media_add_option(media, ":no-audio");
libvlc_media_add_option(media, ":network-caching=1000");
libvlc_media_add_option(media, ":sout=#transcode{...}:std{...}");
libvlc_media_add_option_flag(media, ":option", libvlc_media_option_trusted);
```

**Important:** Most audio/video filter options (text renderer, video filters) must be set at Instance level, not per-Media.

#### Parsing (Metadata Extraction)

```c
// [3.x] Asynchronous parsing
libvlc_media_parse_with_options(media,
    libvlc_media_parse_local | libvlc_media_fetch_local,
    5000);                      // timeout in ms (-1 = infinite)
```

```c
// [4.x] Asynchronous parsing — now takes instance, returns int
int ret = libvlc_media_parse_request(inst, media,
    libvlc_media_parse_local | libvlc_media_fetch_local,
    5000);                      // timeout in ms (-1 = infinite)
// ret: 0 on success, -1 on error
// Can cancel: libvlc_media_parse_stop(inst, media);
```

```c
// Check result (both versions)
libvlc_media_parsed_status_t status = libvlc_media_get_parsed_status(media);
// [3.x] Values: _skipped, _failed, _timeout, _done
// [4.x] Values: _none, _pending, _skipped, _failed, _timeout, _done, _cancelled
```

**Parse options flags (combinable):**

| Flag | 3.x Value | 4.x Value | Description |
|------|-----------|-----------|-------------|
| `libvlc_media_parse_local` | 0x00 | 0x01 | Parse local files |
| `libvlc_media_parse_network` | 0x01 | 0x02 | Parse network streams too |
| `libvlc_media_parse_forced` | — | 0x04 | `[4.x]` Force parsing even if already parsed |
| `libvlc_media_fetch_local` | 0x02 | 0x08 | Fetch art from local files |
| `libvlc_media_fetch_network` | 0x04 | 0x10 | Fetch art from network |
| `libvlc_media_do_interact` | 0x08 | 0x20 | Allow interaction (login dialogs) |

**Note:** Flag values changed between versions. Use the symbolic constants, not raw integers.

#### Metadata

```c
char *title = libvlc_media_get_meta(media, libvlc_meta_Title);
// Must free returned string with libvlc_free()
libvlc_free(title);

libvlc_media_set_meta(media, libvlc_meta_Title, "New Title");
libvlc_media_save_meta(media);       // [3.x] Persist to file
libvlc_media_save_meta(inst, media); // [4.x change] Now requires instance
```

**Meta types:** `Title`, `Artist`, `Genre`, `Copyright`, `Album`, `TrackNumber`, `Description`, `Rating`, `Date`, `Setting`, `URL`, `Language`, `NowPlaying`, `Publisher`, `EncodedBy`, `ArtworkURL`, `TrackID`, `TrackTotal`, `Director`, `Season`, `Episode`, `ShowName`, `Actors`, `AlbumArtist`, `DiscNumber`, `DiscTotal`

**`[4.x]` Meta Extra API** — custom key/value metadata beyond the predefined types:
```c
// [4.x] Get/set arbitrary metadata
char *val = libvlc_media_get_meta_extra(media, "MY_CUSTOM_KEY");
libvlc_free(val);

libvlc_media_set_meta_extra(media, "MY_CUSTOM_KEY", "value");

// Enumerate all extra meta keys
char **names;
unsigned count = libvlc_media_get_meta_extra_names(media, &names);
for (unsigned i = 0; i < count; i++)
    printf("Extra: %s\n", names[i]);
libvlc_media_meta_extra_names_release(names, count);
```

#### Track Information

```c
// [3.x] Track enumeration — flat array
libvlc_media_track_t **tracks;
unsigned count = libvlc_media_tracks_get(media, &tracks);
for (unsigned i = 0; i < count; i++) {
    switch (tracks[i]->i_type) {
        case libvlc_track_audio:
            printf("Audio: %d channels, %d Hz\n",
                   tracks[i]->audio->i_channels,
                   tracks[i]->audio->i_rate);
            break;
        case libvlc_track_video:
            printf("Video: %dx%d\n",
                   tracks[i]->video->i_width,
                   tracks[i]->video->i_height);
            break;
        case libvlc_track_text:
            printf("Subtitle: %s\n", tracks[i]->psz_description);
            break;
    }
}
libvlc_media_tracks_release(tracks, count);
```

```c
// [4.x] Tracklist API — typed tracklist, string IDs, hold/release
libvlc_media_tracklist_t *tl = libvlc_media_get_tracklist(media, libvlc_track_video);
size_t count = libvlc_media_tracklist_count(tl);
for (size_t i = 0; i < count; i++) {
    libvlc_media_track_t *t = libvlc_media_tracklist_at(tl, i);
    printf("Video track '%s': %dx%d (codec: %s)\n",
           t->psz_id, t->video->i_width, t->video->i_height,
           libvlc_media_get_codec_description(t->i_type, t->i_codec));
    // t->psz_name: human-readable name (when from media_player)
    // t->id_stable: true if ID is stable across playback sessions
    // t->selected: true if currently selected (when from media_player)
}
libvlc_media_tracklist_delete(tl);

// To keep a track beyond the tracklist lifetime:
libvlc_media_track_t *held = libvlc_media_track_hold(t);
// ... use held ...
libvlc_media_track_release(held);
```

#### Statistics

```c
libvlc_media_stats_t stats;
libvlc_media_get_stats(media, &stats);
// stats.i_decoded_video, stats.i_decoded_audio,
// stats.i_demux_read_bytes, stats.f_demux_bitrate,
// stats.i_lost_pictures, stats.i_played_abuffers, etc.
```

#### Other

| Function | Description |
|----------|-------------|
| `libvlc_media_get_mrl(media)` | Get MRL string (must free with `libvlc_free`) |
| `libvlc_media_duplicate(media)` | Clone media object |
| `libvlc_media_get_state(media)` | `[3.x]` Get state: `NothingSpecial`, `Opening`, `Buffering`, `Playing`, `Paused`, `Stopped`, `Ended`, `Error`. Removed in 4.x (use `libvlc_media_player_get_state()` instead, which adds `Stopping`). |
| `libvlc_media_get_duration(media)` | Duration in ms (-1 if unknown; parse first) |
| `libvlc_media_get_type(media)` | `unknown`, `file`, `directory`, `disc`, `stream`, `playlist` |
| `libvlc_media_subitems(media)` | Get sub-items as `libvlc_media_list_t` (for playlists, YouTube URLs, m3u8) |
| `libvlc_media_slaves_add(media, type, priority, uri)` | Add subtitle/audio slave |
| `libvlc_media_slaves_get(media, &slaves)` | Get attached slaves |
| `libvlc_media_retain(media)` / `libvlc_media_release(media)` | Refcounting |
| `libvlc_media_get_filestat(media, type, &val)` | `[4.x]` Get file stat: type 0 = mtime (epoch), type 1 = size (bytes) |
| `libvlc_media_get_codec_description(type, fourcc)` | `[4.x]` Get human-readable codec name from fourcc |

**`[4.x]` Thumbnail Request API** — asynchronous thumbnail generation from media (without playing):
```c
// [4.x] Request a thumbnail at a specific time
libvlc_media_thumbnail_request_t *req =
    libvlc_media_thumbnail_request_by_time(inst, media,
        10000000,                          // time in us (10 seconds)
        libvlc_media_thumbnail_seek_fast,  // or _precise
        320, 240,                          // width, height
        false,                             // crop (false = fit)
        libvlc_picture_Png,                // output format
        5000);                             // timeout in ms
// Or by position (same params as by_time, but with double pos instead of time):
// libvlc_media_thumbnail_request_by_pos(inst, media, 0.5,
//     libvlc_media_thumbnail_seek_fast, 320, 240, false,
//     libvlc_picture_Png, 5000);

// Listen for libvlc_MediaThumbnailGenerated event on media's event manager
// The event provides a libvlc_picture_t*

// Cancel / destroy
libvlc_media_thumbnail_request_cancel(req);
libvlc_media_thumbnail_request_destroy(req);
```

### 3.3 Media Player (`libvlc_media_player_t`)

The largest API surface (~123 C functions).

#### Creation & Media

| Function | Description |
|----------|-------------|
| `libvlc_media_player_new(inst)` | Create empty player |
| `libvlc_media_player_new_from_media(media)` | `[3.x]` Create player pre-loaded with media |
| `libvlc_media_player_new_from_media(inst, media)` | `[4.x change]` Now requires instance as first parameter |
| `libvlc_media_player_set_media(mp, media)` | Set/change current media |
| `libvlc_media_player_get_media(mp)` | Get current media (caller must release) |
| `libvlc_media_player_release(mp)` | Release player |
| `libvlc_media_player_retain(mp)` | Retain player |

#### Playback Control

| Function | Description |
|----------|-------------|
| `libvlc_media_player_play(mp)` | Start playback (async — returns immediately) |
| `libvlc_media_player_pause(mp)` | Toggle pause |
| `libvlc_media_player_set_pause(mp, pause)` | Set pause state (1=pause, 0=resume) |
| `libvlc_media_player_stop(mp)` | `[3.x]` Stop playback (synchronous, can be slow — offload to thread) |
| `libvlc_media_player_stop_async(mp)` | `[4.x]` Stop playback (async, returns 0 on success). Listen for `libvlc_MediaPlayerStopping` → `libvlc_MediaPlayerStopped` events. |
| `libvlc_media_player_is_playing(mp)` | Returns 1 `[3.x]` / `bool` `[4.x]` if playing |
| `libvlc_media_player_get_state(mp)` | Get player state enum. `[4.x]` adds `libvlc_Stopping` state. |
| `libvlc_media_player_get_length(mp)` | Duration in ms |
| `libvlc_media_player_get_time(mp)` | Current time in ms |
| `libvlc_media_player_set_time(mp, time)` | `[3.x]` Seek to time in ms |
| `libvlc_media_player_set_time(mp, time, b_fast)` | `[4.x change]` Seek to time in ms. `b_fast=true` for fast (imprecise) seek. |
| `libvlc_media_player_get_position(mp)` | Position 0.0–1.0 (`float` `[3.x]` / `double` `[4.x]`) |
| `libvlc_media_player_set_position(mp, pos)` | `[3.x]` Seek to position (float) |
| `libvlc_media_player_set_position(mp, pos, b_fast)` | `[4.x change]` Seek to position (double). `b_fast=true` for fast seek. |
| `libvlc_media_player_jump_time(mp, time)` | `[4.x]` Relative seek by `time` ms (positive = forward, negative = backward) |
| `libvlc_media_player_set_rate(mp, rate)` | Playback speed (1.0 = normal, 2.0 = 2x) |
| `libvlc_media_player_get_rate(mp)` | Get current rate |
| `libvlc_media_player_will_play(mp)` | `[3.x]` Can this media be played? Removed in 4.x. |
| `libvlc_media_player_is_seekable(mp)` | Is seeking supported? (`int` `[3.x]` / `bool` `[4.x]`) |
| `libvlc_media_player_can_pause(mp)` | Is pausing supported? (`int` `[3.x]` / `bool` `[4.x]`) |
| `libvlc_media_player_program_scrambled(mp)` | Is stream scrambled? |
| `libvlc_media_player_next_frame(mp)` | Advance one frame (while paused) |
| `libvlc_media_player_navigate(mp, nav)` | DVD navigation: `activate`, `up`, `down`, `left`, `right` |
| `libvlc_media_player_record(mp, enable, dir)` | `[4.x]` Start/stop recording. `dir` = output directory (NULL for default). Listen for `libvlc_MediaPlayerRecordChanged`. |

#### Video Output & Window Embedding

| Function | Platform | Description |
|----------|----------|-------------|
| `libvlc_media_player_set_hwnd(mp, hwnd)` | Windows | Set Win32 window handle (`HWND`) |
| `libvlc_media_player_set_xwindow(mp, xid)` | Linux/X11 | Set X11 window ID |
| `libvlc_media_player_set_nsobject(mp, view)` | macOS/iOS | Set `NSView*` / `UIView*`. `[4.x]` The view can implement `VLCDrawable` protocol for resize notifications and PictureInPicture support. |
| `libvlc_media_player_set_android_context(mp, ctx)` | Android | Set Android `AWindow` context |
| `libvlc_media_player_set_evas_object(mp, obj)` | Tizen/EFL | `[3.x]` Set Evas object. Removed in 4.x. |

**Windows `WS_CLIPCHILDREN` requirement:** When embedding video in a Win32 window, the parent window **must** have the `WS_CLIPCHILDREN` style set. Without it, GDI repaints will overwrite the video surface, causing flickering or a blank/white area. Set it either in `CreateWindowEx` flags or dynamically before calling `set_hwnd`:
```c
LONG style = GetWindowLong(hwnd, GWL_STYLE);
if (!(style & WS_CLIPCHILDREN))
    SetWindowLong(hwnd, GWL_STYLE, style | WS_CLIPCHILDREN);
libvlc_media_player_set_hwnd(mp, hwnd);
```

#### Video Properties

| Function | Description |
|----------|-------------|
| `libvlc_video_get_size(mp, num, &w, &h)` | Get video dimensions for track `num` |
| `libvlc_video_get_cursor(mp, num, &x, &y)` | Get cursor position in video |
| `libvlc_video_get_scale(mp)` / `set_scale` | Video scaling factor (0 = auto-fit) |
| `libvlc_video_get_aspect_ratio(mp)` / `set_aspect_ratio` | Aspect ratio string (e.g., `"16:9"`, `"4:3"`, `"fill"`) |
| `libvlc_video_set_crop_geometry(mp, geo)` | `[3.x]` Crop geometry (e.g., `"16:10"`). Removed in 4.x. |
| `libvlc_video_set_crop_ratio(mp, num, den)` | `[4.x]` Set crop ratio (e.g., 16,9). Set den=0 to disable. |
| `libvlc_video_set_crop_window(mp, x, y, w, h)` | `[4.x]` Crop to pixel rectangle |
| `libvlc_video_set_crop_border(mp, left, right, top, bottom)` | `[4.x]` Crop by border sizes |
| `libvlc_video_set_deinterlace(mp, mode)` | `[3.x]` Deinterlace mode: `"blend"`, `"linear"`, `"x"`, `"yadif"`, `"yadif2x"`, `""` (disable) |
| `libvlc_video_set_deinterlace(mp, state, mode)` | `[4.x change]` `state`: -1=auto, 0=off, 1=on. `mode`: filter name or NULL for default. |
| `libvlc_video_get_spu_delay(mp)` / `set_spu_delay` | Subtitle delay in microseconds |
| `libvlc_video_get_spu_text_scale(mp)` / `set_spu_text_scale` | `[4.x]` Subtitle text scale factor (0.1–5.0, default 1.0) |
| `libvlc_video_set_teletext(mp, page)` | Teletext page |
| `libvlc_video_set_teletext_transparency(mp, b)` / `get_` | `[4.x]` Teletext background transparency |
| `libvlc_video_take_snapshot(mp, num, path, w, h)` | Save screenshot to file |
| `libvlc_video_get_display_fit(mp)` / `set_display_fit` | `[4.x]` Display fit mode: `none`, `contain`, `cover`, `fit_width`, `fit_height` (`libvlc_video_fit_mode_t`) |
| `libvlc_video_get_video_stereo_mode(mp)` / `set_` | `[4.x]` Video stereo mode: `Auto`, `Stereo`, `LeftEye`, `RightEye`, `SideBySide` |
| `libvlc_video_set_projection_mode(mp, mode)` | `[4.x]` Force projection mode (rectangular, equirectangular, cubemap) for 360 content |
| `libvlc_video_unset_projection_mode(mp)` | `[4.x]` Remove forced projection mode |
| `libvlc_video_get_track_count(mp)` | `[3.x]` Number of video tracks. Use tracklist API in 4.x. |
| `libvlc_video_get_track(mp)` / `set_track` | `[3.x]` Select video track. Use tracklist API in 4.x. |
| `libvlc_video_get_track_description(mp)` | `[3.x]` List of track descriptions. Use tracklist API in 4.x. |
| `libvlc_video_get_spu(mp)` / `set_spu` | `[3.x]` Subtitle track selection. Use tracklist API in 4.x. |
| `libvlc_video_get_spu_count(mp)` | `[3.x]` Number of subtitle tracks. Use tracklist API in 4.x. |

#### Video Marquee (Text Overlay)

```c
libvlc_video_set_marquee_int(mp, libvlc_marquee_Enable, 1);
libvlc_video_set_marquee_string(mp, libvlc_marquee_Text, "Hello World");
libvlc_video_set_marquee_int(mp, libvlc_marquee_Color, 0xFF0000);    // Red
libvlc_video_set_marquee_int(mp, libvlc_marquee_Size, 24);           // Font size
libvlc_video_set_marquee_int(mp, libvlc_marquee_Position, 8);        // Bottom
libvlc_video_set_marquee_int(mp, libvlc_marquee_Timeout, 5000);      // 5 seconds
libvlc_video_set_marquee_int(mp, libvlc_marquee_Opacity, 200);       // 0-255
libvlc_video_set_marquee_int(mp, libvlc_marquee_X, 10);              // X position
libvlc_video_set_marquee_int(mp, libvlc_marquee_Y, 10);              // Y position
libvlc_video_set_marquee_int(mp, libvlc_marquee_Refresh, 1000);      // Refresh interval ms
```

#### Video Logo (Image Overlay)

```c
libvlc_video_set_logo_int(mp, libvlc_logo_enable, 1);
libvlc_video_set_logo_string(mp, libvlc_logo_file, "/path/to/logo.png");
libvlc_video_set_logo_int(mp, libvlc_logo_x, 10);
libvlc_video_set_logo_int(mp, libvlc_logo_y, 10);
libvlc_video_set_logo_int(mp, libvlc_logo_opacity, 200);  // 0-255
libvlc_video_set_logo_int(mp, libvlc_logo_delay, 0);      // ms between images
libvlc_video_set_logo_int(mp, libvlc_logo_repeat, -1);     // -1 = infinite
```

#### Audio

| Function | Description |
|----------|-------------|
| `libvlc_audio_get_volume(mp)` / `set_volume` | Volume 0–200 (100 = normal, >100 = amplify) |
| `libvlc_audio_get_mute(mp)` / `set_mute` / `toggle_mute` | Mute control |
| `libvlc_audio_get_track(mp)` / `set_track` | `[3.x]` Audio track selection. Use tracklist API in 4.x. |
| `libvlc_audio_get_track_count(mp)` | `[3.x]` Number of audio tracks. Use tracklist API in 4.x. |
| `libvlc_audio_get_track_description(mp)` | `[3.x]` List of track descriptions. Use tracklist API in 4.x. |
| `libvlc_audio_get_delay(mp)` / `set_delay` | Audio delay in microseconds |
| `libvlc_audio_get_channel(mp)` / `set_channel` | `[3.x]` Audio channel mode: `Stereo`, `RStereo`, `Left`, `Right`, `Dolbys` |
| `libvlc_audio_get_stereomode(mp)` / `set_stereomode` | `[4.x]` Replaces `get/set_channel`. Stereo mode: `Unset`, `Stereo`, `RStereo`, `Left`, `Right`, `Dolbys`, `Mono` |
| `libvlc_audio_get_mixmode(mp)` / `set_mixmode` | `[4.x]` Audio mix/upmix mode: `Unset`, `Stereo`, `Binaural`, `4_0`, `5_1`, `7_1`. Force channel layout regardless of source. |
| `libvlc_audio_output_list_get(inst)` | List available audio outputs |
| `libvlc_audio_output_set(mp, name)` | Set audio output module |
| `libvlc_audio_output_device_list_get(inst, aout)` | `[3.x]` List devices for output. Use `device_enum` in 4.x. |
| `libvlc_audio_output_device_enum(mp)` | List devices for current output (both versions, preferred in 4.x) |
| `libvlc_audio_output_device_set(mp, module, device_id)` | `[3.x]` Set specific audio device (3 params) |
| `libvlc_audio_output_device_set(mp, device_id)` | `[4.x change]` Set audio device (2 params, module param removed) |
| `libvlc_audio_output_device_get(mp)` | Get current audio device identifier (free with `free()`) |

#### Audio Equalizer

LibVLC provides a 10-band audio equalizer with 18 built-in presets (Flat, Classical, Club, Dance, Full bass, etc.). The equalizer is an independent object that you configure and then apply to a media player. Changes take effect immediately, even during playback.

**C — Full equalizer workflow:**
```c
// List available presets
unsigned preset_count = libvlc_audio_equalizer_get_preset_count();
for (unsigned i = 0; i < preset_count; i++)
    printf("Preset %u: %s\n", i, libvlc_audio_equalizer_get_preset_name(i));

// Create from preset (e.g., "Rock" = preset index 1)
libvlc_equalizer_t *eq = libvlc_audio_equalizer_new_from_preset(1);
// Or create blank (all bands at 0 dB):
// libvlc_equalizer_t *eq = libvlc_audio_equalizer_new();

// Pre-amplification: -20.0 to +20.0 dB
libvlc_audio_equalizer_set_preamp(eq, 12.0);

// 10 frequency bands — get frequencies:
unsigned band_count = libvlc_audio_equalizer_get_band_count();  // Always 10
for (unsigned i = 0; i < band_count; i++)
    printf("Band %u: %.0f Hz\n", i, libvlc_audio_equalizer_get_band_frequency(i));
// Bands: 60Hz, 170Hz, 310Hz, 600Hz, 1kHz, 3kHz, 6kHz, 12kHz, 14kHz, 16kHz

// Set amplification per band: -20.0 to +20.0 dB
libvlc_audio_equalizer_set_amp_at_index(eq, 8.0, 0);   // Boost 60Hz bass
libvlc_audio_equalizer_set_amp_at_index(eq, -3.0, 9);   // Cut 16kHz treble

// Apply to player (can be done before or during playback)
libvlc_media_player_set_equalizer(mp, eq);

// Disable equalizer:
libvlc_media_player_set_equalizer(mp, NULL);

// Release when done (player does NOT keep a reference)
libvlc_audio_equalizer_release(eq);
```

**C# (LibVLCSharp):**
```csharp
// Create from preset
using var eq = new Equalizer(presetIndex: 1);  // "Rock"

// Or blank:
// using var eq = new Equalizer();

// Configure
eq.SetPreamp(12.0f);
eq.SetAmp(8.0f, 0);   // Band 0 = 60Hz

// Apply
player.SetEqualizer(eq);

// Disable
player.UnsetEqualizer();

// List presets
for (uint i = 0; i < Equalizer.PresetCount; i++)
    Console.WriteLine($"Preset {i}: {Equalizer.PresetName(i)}");
```

**Python:**
```python
import vlc

# Create from preset
eq = vlc.AudioEqualizer.from_preset(1)  # "Rock"

# Configure
eq.set_preamp(12.0)
eq.set_amp_at_index(8.0, 0)  # Boost 60Hz

# Apply to player
player.set_equalizer(eq)

# Disable
player.set_equalizer(None)
```

**Key points:**
- The player does NOT keep a reference to the equalizer — you can release/modify it after `set_equalizer()` and re-apply
- Changes apply immediately to the currently playing audio
- If set before playback, settings persist for subsequently played media
- The equalizer object is independent of the player — you can reuse one equalizer across multiple players

#### Custom Video Rendering (Callbacks)

For rendering video frames yourself (e.g., into a texture, off-screen buffer, or custom UI):

```c
// Lock callback: allocate/return buffer for VLC to decode into
void *lock(void *opaque, void **planes) {
    my_context *ctx = (my_context *)opaque;
    *planes = ctx->pixel_buffer;
    return NULL;  // picture identifier (passed to unlock/display)
}

// Unlock callback: called after decoding
void unlock(void *opaque, void *picture, void *const *planes) {
    // Optional: post-processing
}

// Display callback: frame is ready to show
void display(void *opaque, void *picture) {
    my_context *ctx = (my_context *)opaque;
    // Render ctx->pixel_buffer to screen/texture
}

libvlc_video_set_callbacks(mp, lock, unlock, display, my_context);
libvlc_video_set_format(mp, "RV32", width, height, width * 4);  // BGRA 32-bit
// Or use format callback for dynamic sizing:
// libvlc_video_set_format_callbacks(mp, setup_cb, cleanup_cb);
```

**Chroma formats:** `"RV32"` (BGRA), `"RV24"` (BGR), `"RV16"`, `"I420"` (YUV planar), `"NV12"`, `"UYVY"`, `"YUYV"`

**Performance note (LibVLC 3.x):** Video callbacks involve CPU copies — no GPU acceleration. Minimize resolution and prefer `I420` chroma over `RV32` to reduce copy overhead.

#### Custom Audio Rendering (Callbacks)

```c
void audio_play(void *data, const void *samples, unsigned count, int64_t pts) {
    // Render audio samples
}
void audio_pause(void *data, int64_t pts) { /* pause output */ }
void audio_resume(void *data, int64_t pts) { /* resume output */ }
void audio_flush(void *data, int64_t pts) { /* flush buffers */ }
void audio_drain(void *data) { /* drain remaining */ }

libvlc_audio_set_callbacks(mp, audio_play, audio_pause, audio_resume,
                           audio_flush, audio_drain, my_context);
libvlc_audio_set_format(mp, "S16N", 44100, 2);  // 16-bit signed, 44.1kHz, stereo
// Or: libvlc_audio_set_format_callbacks(mp, setup_cb, cleanup_cb);
```

**C# (LibVLCSharp) — Full audio callbacks with NAudio playback + file recording:**

This example uses `SetAudioFormatCallback` to negotiate audio format, then `SetAudioCallbacks` to route decoded PCM samples to both a speaker (via NAudio `WaveOutEvent`) and a WAV file writer:

```csharp
using var libVLC = new LibVLC(enableDebugLogs: true);
using var media = new Media(libVLC,
    new Uri("http://example.com/video.mp4"), ":no-video");
using var mediaPlayer = new MediaPlayer(media);

// Set up audio output
var waveFormat = new WaveFormat(8000, 16, 1);  // 8kHz, 16-bit, mono
var writer = new WaveFileWriter("sound.wav", waveFormat);
var waveProvider = new BufferedWaveProvider(waveFormat);
using var outputDevice = new WaveOutEvent();
outputDevice.Init(waveProvider);

// Negotiate format — libvlc calls this to agree on sample rate/channels
mediaPlayer.SetAudioFormatCallback(
    (ref IntPtr opaque, ref IntPtr format, ref uint rate, ref uint channels) =>
    {
        channels = (uint)waveFormat.Channels;
        rate = (uint)waveFormat.SampleRate;
        return 0;
    },
    (IntPtr opaque) => { /* cleanup */ });

// Route decoded audio samples
mediaPlayer.SetAudioCallbacks(
    (IntPtr data, IntPtr samples, uint count, long pts) =>
    {
        int bytes = (int)count * 2;  // 16-bit mono = 2 bytes per sample
        var buffer = new byte[bytes];
        Marshal.Copy(samples, buffer, 0, bytes);
        waveProvider.AddSamples(buffer, 0, bytes);  // Speaker output
        writer.Write(buffer, 0, bytes);              // File recording
    },
    (IntPtr data, long pts) => outputDevice.Pause(),   // pause
    (IntPtr data, long pts) => outputDevice.Play(),    // resume
    (IntPtr data, long pts) => { writer.Flush(); waveProvider.ClearBuffer(); },  // flush
    (IntPtr data) => writer.Flush());                  // drain

mediaPlayer.Play();
outputDevice.Play();
```

**Key points for audio callbacks:**
- Use `:no-video` media option when only audio is needed — avoids video decoding overhead
- `SetAudioFormatCallback` is called **before** playback — use it to negotiate sample rate and channels
- The `play` callback receives raw PCM samples as `IntPtr` — use `Marshal.Copy` to get managed byte arrays
- `count` is the number of **samples**, not bytes — multiply by bytes-per-sample (e.g., `count * 2` for 16-bit mono)
- All callbacks run on libvlc's audio thread — keep processing fast to avoid audio glitches

#### Subtitle / Media Slave

```c
// Add external subtitle file
libvlc_media_player_add_slave(mp, libvlc_media_slave_type_subtitle,
                               "file:///path/to/subs.srt", true);
// Add external audio track
libvlc_media_player_add_slave(mp, libvlc_media_slave_type_audio,
                               "file:///path/to/audio.mp3", true);
```

#### Chapters & Titles (DVD/Blu-ray)

| Function | Description |
|----------|-------------|
| `libvlc_media_player_get_chapter(mp)` / `set_chapter` | Current chapter |
| `libvlc_media_player_get_chapter_count(mp)` | Total chapters |
| `libvlc_media_player_get_title(mp)` / `set_title` | Current title |
| `libvlc_media_player_get_title_count(mp)` | Total titles |
| `libvlc_media_player_get_full_title_descriptions(mp, &descs)` | Detailed title info |
| `libvlc_media_player_get_full_chapter_descriptions(mp, title, &descs)` | Detailed chapter info |
| `libvlc_media_player_previous_chapter(mp)` / `next_chapter` | Chapter navigation |

#### 360° Video

```c
libvlc_video_update_viewpoint(mp, &(libvlc_video_viewpoint_t){
    .f_yaw   = 45.0,   // Horizontal rotation (-180 to 180)
    .f_pitch = -10.0,   // Vertical rotation (-90 to 90)
    .f_roll  = 0.0,     // Rotation around axis
    .f_field_of_view = 80.0  // FOV in degrees
}, false);  // false = absolute, true = relative
```

#### Media Player Role

```c
libvlc_media_player_set_role(mp, libvlc_role_Music);
// Roles: None, Music, Video, Communication, Game, Notification,
//        Animation, Production, Accessibility, Test
```

### 3.4 Media List (`libvlc_media_list_t`)

Thread-safe ordered collection of media items. **Must lock before read/write operations.**

```c
libvlc_media_list_t *ml = libvlc_media_list_new(inst);    // [3.x] takes instance
// libvlc_media_list_t *ml = libvlc_media_list_new();     // [4.x] no instance

libvlc_media_list_lock(ml);       // MUST lock before modifying
libvlc_media_list_add_media(ml, media1);
libvlc_media_list_add_media(ml, media2);
libvlc_media_list_insert_media(ml, media3, 0);  // Insert at index
int count = libvlc_media_list_count(ml);
libvlc_media_t *m = libvlc_media_list_item_at_index(ml, 0);  // Must release
libvlc_media_list_remove_index(ml, 0);
libvlc_media_list_unlock(ml);     // MUST unlock after

libvlc_media_list_release(ml);
```

### 3.5 Media List Player (`libvlc_media_list_player_t`)

Plays through a media list with configurable playback mode.

```c
libvlc_media_list_player_t *mlp = libvlc_media_list_player_new(inst);
libvlc_media_list_player_set_media_player(mlp, mp);
libvlc_media_list_player_set_media_list(mlp, ml);

// Playback modes
libvlc_media_list_player_set_playback_mode(mlp, libvlc_playback_mode_default);  // Sequential
libvlc_media_list_player_set_playback_mode(mlp, libvlc_playback_mode_loop);     // Repeat all
libvlc_media_list_player_set_playback_mode(mlp, libvlc_playback_mode_repeat);   // Repeat one

libvlc_media_list_player_play(mlp);
libvlc_media_list_player_next(mlp);
libvlc_media_list_player_previous(mlp);
libvlc_media_list_player_play_item_at_index(mlp, 2);
libvlc_media_list_player_play_item(mlp, specific_media);

libvlc_media_list_player_pause(mlp);
libvlc_media_list_player_stop(mlp);       // [3.x] synchronous
// libvlc_media_list_player_stop_async(mlp); // [4.x] asynchronous
libvlc_media_list_player_is_playing(mlp);  // [3.x] returns int, [4.x] returns bool
libvlc_media_list_player_get_state(mlp);

libvlc_media_list_player_release(mlp);
```

### 3.6 Events (`libvlc_event_t`)

#### Event Types

**MediaPlayer events (most common):**

| Event | Extra Data | Notes |
|-------|-----------|-------|
| `libvlc_MediaPlayerMediaChanged` | `new_media` | |
| `libvlc_MediaPlayerOpening` | — | |
| `libvlc_MediaPlayerBuffering` | `new_cache` (float, 0–100%) | |
| `libvlc_MediaPlayerPlaying` | — | |
| `libvlc_MediaPlayerPaused` | — | |
| `libvlc_MediaPlayerStopped` | — | |
| `libvlc_MediaPlayerStopping` | — | `[4.x]` Fired before `Stopped` when `stop_async()` begins |
| `libvlc_MediaPlayerForward` | — | |
| `libvlc_MediaPlayerBackward` | — | |
| `libvlc_MediaPlayerEndReached` | — | |
| `libvlc_MediaPlayerEncounteredError` | — | |
| `libvlc_MediaPlayerTimeChanged` | `new_time` (int64_t, ms) | |
| `libvlc_MediaPlayerPositionChanged` | `new_position` | `[3.x]` float. `[4.x]` double. |
| `libvlc_MediaPlayerSeekableChanged` | `new_seekable` | |
| `libvlc_MediaPlayerPausableChanged` | `new_pausable` | |
| `libvlc_MediaPlayerTitleChanged` | `new_title` (int) | |
| `libvlc_MediaPlayerSnapshotTaken` | `psz_filename` (char*) | |
| `libvlc_MediaPlayerLengthChanged` | `new_length` (int64_t) | |
| `libvlc_MediaPlayerVout` | `new_count` (int) | |
| `libvlc_MediaPlayerScrambledChanged` | `new_scrambled` (int) | |
| `libvlc_MediaPlayerESAdded` | `[3.x]` `i_type`, `i_id` (int). `[4.x]` `i_type`, `psz_id` (string). | |
| `libvlc_MediaPlayerESDeleted` | Same as ESAdded | |
| `libvlc_MediaPlayerESSelected` | `[3.x]` `i_type`, `i_id`. `[4.x]` `psz_unselected_id`, `psz_selected_id`. | |
| `libvlc_MediaPlayerESUpdated` | `i_type`, `psz_id` | `[4.x]` Track info changed |
| `libvlc_MediaPlayerProgramAdded` | `i_id`, `psz_name` | `[4.x]` MPEG-TS program |
| `libvlc_MediaPlayerProgramDeleted` | `i_id` | `[4.x]` |
| `libvlc_MediaPlayerProgramUpdated` | `i_id`, `psz_name` | `[4.x]` |
| `libvlc_MediaPlayerProgramSelected` | `i_unselected_id`, `i_selected_id` | `[4.x]` |
| `libvlc_MediaPlayerTitleListChanged` | — | `[4.x]` Title list updated |
| `libvlc_MediaPlayerTitleSelectionChanged` | `title`, `index` | `[4.x]` |
| `libvlc_MediaPlayerRecordChanged` | `recording` (bool), `psz_recorded_file_path` | `[4.x]` |
| `libvlc_MediaPlayerCorked` | — | |
| `libvlc_MediaPlayerUncorked` | — | |
| `libvlc_MediaPlayerMuted` | — | |
| `libvlc_MediaPlayerUnmuted` | — | |
| `libvlc_MediaPlayerAudioVolume` | `volume` (float) | |
| `libvlc_MediaPlayerAudioDevice` | `device` (char*) | |
| `libvlc_MediaPlayerChapterChanged` | `new_chapter` (int) | |

**Media events:**

| Event | Extra Data | Notes |
|-------|-----------|-------|
| `libvlc_MediaMetaChanged` | `meta_type` | |
| `libvlc_MediaSubItemAdded` | `new_child` (media) | |
| `libvlc_MediaDurationChanged` | `new_duration` (int64_t) | |
| `libvlc_MediaParsedChanged` | `new_status` (int) | |
| `libvlc_MediaFreed` | `md` (media) | `[3.x]` Removed in 4.x. |
| `libvlc_MediaStateChanged` | `new_state` | `[3.x]` Removed in 4.x. |
| `libvlc_MediaSubItemTreeAdded` | `item` (media) | |
| `libvlc_MediaThumbnailGenerated` | `p_thumbnail` (libvlc_picture_t*) | `[4.x]` From thumbnail request |
| `libvlc_MediaAttachedThumbnailsFound` | `p_thumbnail` (libvlc_picture_t*) | `[4.x]` Embedded artwork |

**MediaList events:** `ItemAdded` (`item`, `index`), `WillAddItem`, `ItemDeleted`, `WillDeleteItem`, `EndReached` `[4.x]`

**MediaDiscoverer events:** `Started`, `Ended`

**RendererDiscoverer events:** `ItemAdded` (`item`), `ItemDeleted` (`item`)

**`[3.x]` VLM events:** `MediaAdded`, `MediaRemoved`, `MediaChanged`, `MediaInstanceStarted`, `MediaInstanceStopped`, `MediaInstanceStatusInit/Opening/Playing/Pause/End/Error` — VLM is removed in 4.x.

### 3.7 Dialog API (`libvlc_dialog_cbs`)

Handle login prompts, questions, and progress for user interaction:

```c
// [3.x] Error callback is part of the struct
const libvlc_dialog_cbs cbs = {
    .pf_display_error    = on_error,     // (title, text)
    .pf_display_login    = on_login,     // (id, title, text, default_user, ask_store)
    .pf_display_question = on_question,  // (id, title, text, type, cancel, action1, action2)
    .pf_display_progress = on_progress,  // (id, title, text, indeterminate, position, cancel)
    .pf_cancel           = on_cancel,    // (id)
    .pf_update_progress  = on_update,    // (id, position, text)
};
libvlc_dialog_set_callbacks(inst, &cbs, my_data);
```

```c
// [4.x change] Error callback is registered separately
const libvlc_dialog_cbs cbs = {
    .pf_display_login    = on_login,
    .pf_display_question = on_question,
    .pf_display_progress = on_progress,
    .pf_cancel           = on_cancel,
    .pf_update_progress  = on_update,
};
libvlc_dialog_set_callbacks(inst, &cbs, my_data);
libvlc_dialog_set_error_callback(inst, on_error, my_data);  // [4.x] separate
```

```c
// Respond to dialog (same in both versions):
libvlc_dialog_post_login(id, username, password, store);
libvlc_dialog_post_action(id, action_number);  // 1 or 2
libvlc_dialog_dismiss(id);
```

### 3.8 Media Discoverer (`libvlc_media_discoverer_t`)

Discover network services (UPnP, Bonjour, SAP, etc.):

```c
// List available discoverers by category
libvlc_media_discoverer_description_t **descs;
size_t count = libvlc_media_discoverer_list_get(inst,
    libvlc_media_discoverer_devices,  // or _lan, _podcasts, _localdirs
    &descs);
// Each has: psz_name, psz_longname, i_cat

// Create and start
libvlc_media_discoverer_t *md = libvlc_media_discoverer_new(inst, descs[0]->psz_name);
libvlc_media_discoverer_start(md);

// Get discovered items
libvlc_media_list_t *ml = libvlc_media_discoverer_media_list(md);
// Listen for ItemAdded/ItemDeleted events on the media list

libvlc_media_discoverer_stop(md);
libvlc_media_discoverer_release(md);
libvlc_media_discoverer_description_list_release(descs, count);
```

**Categories:**
- `libvlc_media_discoverer_devices` — Audio/video devices (webcam, mic)
- `libvlc_media_discoverer_lan` — LAN services (UPnP, SMB shares)
- `libvlc_media_discoverer_podcasts` — Podcast directories
- `libvlc_media_discoverer_localdirs` — Local directories

### 3.9 Renderer Discoverer (`libvlc_renderer_discoverer_t`)

Find Chromecast, UPnP renderers:

```c
libvlc_renderer_discoverer_description_t **descs;
size_t count = libvlc_renderer_discoverer_list_get(inst, &descs);

libvlc_renderer_discoverer_t *rd = libvlc_renderer_discoverer_new(inst, descs[0]->psz_name);

// Listen for renderer items
libvlc_event_manager_t *em = libvlc_renderer_discoverer_event_manager(rd);
libvlc_event_attach(em, libvlc_RendererDiscovererItemAdded, on_renderer_found, ctx);

libvlc_renderer_discoverer_start(rd);

// When renderer found:
void on_renderer_found(const libvlc_event_t *e, void *data) {
    libvlc_renderer_item_t *item = e->u.renderer_discoverer_item_added.item;
    const char *name = libvlc_renderer_item_name(item);
    // Check: libvlc_renderer_item_flags(item) & LIBVLC_RENDERER_CAN_VIDEO
    // To cast: libvlc_media_player_set_renderer(mp, item);
    // To stop casting: libvlc_media_player_set_renderer(mp, NULL);
}

libvlc_renderer_discoverer_stop(rd);
libvlc_renderer_discoverer_release(rd);
```

**Renderer flags:** `LIBVLC_RENDERER_CAN_AUDIO` (0x0001), `LIBVLC_RENDERER_CAN_VIDEO` (0x0002)

### 3.10 VLM (Video LAN Manager) `[3.x]`

> **Note:** The VLM API is **removed in libvlc 4.x**. For server-side streaming in 4.x, use the sout (stream output) chain via `libvlc_media_add_option()` instead.

Server-side broadcast/VOD streaming management:

```c
// Add a broadcast
libvlc_vlm_add_broadcast(inst, "mystream",
    "file:///path/to/video.mp4",     // input
    "#standard{access=http,mux=ts,dst=:8080/stream}",  // output
    0, NULL,                          // extra options
    1,   // enabled
    0);  // no loop

libvlc_vlm_play_media(inst, "mystream");
libvlc_vlm_pause_media(inst, "mystream");
libvlc_vlm_stop_media(inst, "mystream");
libvlc_vlm_seek_media(inst, "mystream", 50.0);  // 50%

// VOD
libvlc_vlm_add_vod(inst, "myvod", "file:///path/to/video.mp4",
    0, NULL, 1, "ts");

// Query state
float pos = libvlc_vlm_get_media_instance_position(inst, "mystream", 0);
int time = libvlc_vlm_get_media_instance_time(inst, "mystream", 0);

// JSON info (debugging)
const char *info = libvlc_vlm_show_media(inst, "mystream");

libvlc_vlm_del_media(inst, "mystream");
libvlc_vlm_release(inst);
```

**VLM transcode with presets and progress tracking (from official DVD ripper sample):**

The VLM API can be used for transcoding with progress monitoring. Define sout transcode strings as presets and track position via polling.

```c
/* Transcode preset strings */
// MP4 high quality:
"#transcode{vcodec=h264,venc=x264{cfr=16},scale=1,acodec=mp4a,ab=160,"
"channels=2,samplerate=44100}:file{dst=/output.mp4}"

// MP4 low quality:
"#transcode{vcodec=h264,venc=x264{cfr=40},scale=1,acodec=mp4a,ab=96,"
"channels=2,samplerate=44100}:file{dst=/output.mp4}"

// OGG high quality (Theora + Vorbis):
"#transcode{vcodec=theo,venc=theora{quality=9},scale=1,acodec=vorb,ab=160,"
"channels=2,samplerate=44100}:file{dst=/output.ogg}"

// WebM high quality (VP8 + Vorbis):
"#transcode{vcodec=VP80,vb=2000,scale=1,acodec=vorb,ab=160,"
"channels=2,samplerate=44100}:file{dst=/output.webm}"

/* Start VLM broadcast and track progress */
libvlc_vlm_add_broadcast(inst, "transcode_job",
    "file:///input.mp4",  /* input */
    sout_string,          /* transcode preset from above */
    0, NULL, 1, 0);       /* enabled=1, loop=0 */
libvlc_vlm_play_media(inst, "transcode_job");

/* Monitor progress via VLM events */
libvlc_event_manager_t *em = libvlc_vlm_get_event_manager(inst);
libvlc_event_attach(em, libvlc_VlmMediaInstanceStatusEnd, on_done, NULL);
libvlc_event_attach(em, libvlc_VlmMediaInstanceStatusError, on_error, NULL);

/* Or poll position (0.0 to 1.0) for progress bars */
float pos = libvlc_vlm_get_media_instance_position(inst, "transcode_job", 0);
// pos < 0 means not started; 0.0-1.0 = progress; >= 1.0 = finished
```

### 3.11 Tracklist API (Player-side) `[4.x]`

In 4.x, track selection uses the new tracklist API instead of the `get_track`/`set_track`/`get_track_description` functions:

```c
// Get all audio tracks from the player
libvlc_media_tracklist_t *tl =
    libvlc_media_player_get_tracklist(mp, libvlc_track_audio, false);
    // selected=true to get only selected tracks

size_t count = libvlc_media_tracklist_count(tl);
for (size_t i = 0; i < count; i++) {
    libvlc_media_track_t *t = libvlc_media_tracklist_at(tl, i);
    printf("Track '%s': %s %s\n",
           t->psz_id,          // stable string identifier
           t->psz_name,        // human-readable name
           t->selected ? "(selected)" : "");
}
libvlc_media_tracklist_delete(tl);

// Select a track by reference
libvlc_media_player_select_track(mp, track);

// Select by string ID
libvlc_media_player_select_tracks_by_ids(mp, libvlc_track_audio, "audio/0,audio/1");

// Unselect all tracks of a type (e.g., disable all subtitles)
libvlc_media_player_unselect_track_type(mp, libvlc_track_text);

// Get the currently selected track of a type
libvlc_media_track_t *sel = libvlc_media_player_get_selected_track(mp, libvlc_track_video);
if (sel) {
    printf("Selected: %s\n", sel->psz_id);
    libvlc_media_track_release(sel);  // must release
}

// Get a specific track by ID
libvlc_media_track_t *t = libvlc_media_player_get_track_from_id(mp, "audio/1");
if (t) {
    // use t...
    libvlc_media_track_release(t);
}
```

### 3.12 Program API `[4.x]`

For MPEG-TS and multi-program streams, 4.x adds a dedicated program selection API:

```c
// Get the program list
libvlc_player_programlist_t *pl = libvlc_media_player_get_programlist(mp);
size_t count = libvlc_player_programlist_count(pl);
for (size_t i = 0; i < count; i++) {
    const libvlc_player_program_t *prog = libvlc_player_programlist_at(pl, i);
    printf("Program %d: '%s' %s\n",
           prog->i_group_id, prog->psz_name,
           prog->b_selected ? "(selected)" : "");
    // prog->b_scrambled — whether scrambled
}
libvlc_player_programlist_delete(pl);

// Select a program by ID
libvlc_media_player_select_program_id(mp, group_id);

// Get selected/specific program (must release with libvlc_player_program_delete)
libvlc_player_program_t *prog = libvlc_media_player_get_selected_program(mp);
// libvlc_player_program_t *prog = libvlc_media_player_get_program_from_id(mp, id);
if (prog) {
    printf("Selected program: %s\n", prog->psz_name);
    libvlc_player_program_delete(prog);
}
```

Listen for `libvlc_MediaPlayerProgramAdded/Deleted/Updated/Selected` events.

### 3.13 GPU Rendering Pipeline `[4.x]`

LibVLC 4.x introduces GPU-accelerated video output via `libvlc_video_set_output_callbacks()`. Instead of receiving CPU pixel buffers (the 3.x `vmem` approach), the application provides GPU resources directly.

**Supported engines:**

| Engine | Enum | Platform |
|--------|------|----------|
| OpenGL | `libvlc_video_engine_opengl` | Linux, macOS |
| OpenGL ES 2 | `libvlc_video_engine_gles2` | Android, embedded |
| Direct3D 11 | `libvlc_video_engine_d3d11` | Windows |
| Direct3D 9 | `libvlc_video_engine_d3d9` | Windows (legacy) |
| Android Native Window | `libvlc_video_engine_anw` | Android (via ANativeWindow) |
| Disable | `libvlc_video_engine_disable` | No video output |

```c
// Set up GPU rendering (D3D11 example)
bool setup(void **opaque, const libvlc_video_setup_device_cfg_t *cfg,
           libvlc_video_setup_device_info_t *out) {
    // cfg->hardware_decoding: true if hardware decoding is requested
    // Set up your D3D11 device, return context in *opaque
    out->d3d11.device_context = my_d3d11_context;
    return true;
}

void cleanup(void *opaque) { /* Release GPU resources */ }

bool update_output(void *opaque, const libvlc_video_render_cfg_t *cfg,
                   libvlc_video_output_cfg_t *out) {
    // cfg->width, cfg->height — requested size
    // cfg->colorspace, cfg->primaries, cfg->transfer — color info
    // out->dxgi_format, out->d3d11_format — set output format
    // out->orientation — set orientation
    return true;
}

void swap(void *opaque) { /* Present frame to display */ }

libvlc_video_set_output_callbacks(mp,
    libvlc_video_engine_d3d11,
    setup, cleanup, NULL /*window_cb*/,
    update_output, swap,
    NULL /*makeCurrent*/, NULL /*getProcAddress*/,
    NULL /*metadata*/, NULL /*select_plane*/,
    my_opaque);
```

**Key concepts:**
- `update_output` is called when video size/format changes — resize your swap chain here
- `swap` is called each time a frame is ready to display
- For OpenGL: provide `makeCurrent` and `getProcAddress` callbacks
- For Android: use the helper `libvlc_video_set_anw_callbacks()` instead
- HDR metadata available via `libvlc_video_frame_hdr10_metadata_t` in the metadata callback
- Color space info: `libvlc_video_color_space_t`, `libvlc_video_color_primaries_t`, `libvlc_video_transfer_func_t`

### 3.14 A-B Loop API `[4.x]`

```c
// Set A-B loop by time (both points at once)
libvlc_media_player_set_abloop_time(mp, a_time_ms, b_time_ms);

// Or by position (0.0–1.0)
libvlc_media_player_set_abloop_position(mp, 0.1, 0.5);

// Query current loop state
libvlc_time_t a_time, b_time;
double a_pos, b_pos;
libvlc_abloop_t state = libvlc_media_player_get_abloop(mp, &a_time, &a_pos, &b_time, &b_pos);
// state: libvlc_abloop_none, libvlc_abloop_a, libvlc_abloop_b

// Clear loop
libvlc_media_player_reset_abloop(mp);
```

### 3.15 Picture API `[4.x]`

The `libvlc_picture_t` type represents an image (thumbnail, artwork) with reference counting:

```c
// Received from MediaThumbnailGenerated event or thumbnail request
libvlc_picture_t *pic = event->u.media_thumbnail_generated.p_thumbnail;
libvlc_picture_retain(pic);  // hold beyond event scope

// Properties
unsigned w = libvlc_picture_get_width(pic);
unsigned h = libvlc_picture_get_height(pic);
libvlc_picture_type_t type = libvlc_picture_type(pic);
// Types: libvlc_picture_Argb, _Png, _Jpg, _WebP, _Rgba
libvlc_time_t time = libvlc_picture_get_time(pic);  // ms

// Get raw buffer
size_t buf_size;
const unsigned char *buf = libvlc_picture_get_buffer(pic, &buf_size);
// For Argb/Rgba types: stride = libvlc_picture_get_stride(pic)

// Save to file
libvlc_picture_save(pic, "/path/to/output.png");

libvlc_picture_release(pic);

// Picture list (e.g., from attached thumbnails)
size_t count = libvlc_picture_list_count(list);
libvlc_picture_t *p = libvlc_picture_list_at(list, 0);
libvlc_picture_list_destroy(list);
```

---


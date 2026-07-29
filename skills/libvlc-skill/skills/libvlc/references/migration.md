## §13. Migration Guide: libVLC 3.x → 4.x

This file is a migration map, not a complete compatibility contract. Use it to identify likely 3.x to 4.x changes, then verify changed APIs against current headers, official VideoLAN docs/source, or binding-specific documentation for the target version before producing exact code.

Quick reference for porting 3.x code to 4.x. See inline `[4.x]` / `[4.x change]` markers throughout this document for details.

### Function Signature Changes

| 3.x | 4.x | Notes |
|-----|-----|-------|
| `libvlc_media_new_path(inst, path)` | `libvlc_media_new_path(path)` | All `_new_*` media creators drop `inst` |
| `libvlc_media_new_location(inst, mrl)` | `libvlc_media_new_location(mrl)` | |
| `libvlc_media_new_fd(inst, fd)` | `libvlc_media_new_fd(fd)` | |
| `libvlc_media_new_callbacks(inst, open, read, seek, close, opaque)` | `libvlc_media_new_callbacks(open, read, seek, close, opaque)` | |
| `libvlc_media_new_as_node(inst, name)` | `libvlc_media_new_as_node(name)` | |
| `libvlc_media_list_new(inst)` | `libvlc_media_list_new()` | |
| `libvlc_media_player_new_from_media(media)` | `libvlc_media_player_new_from_media(inst, media)` | Swapped: inst added |
| `libvlc_media_player_stop(mp)` | `libvlc_media_player_stop_async(mp)` | Async, returns int |
| `libvlc_media_list_player_stop(mlp)` | `libvlc_media_list_player_stop_async(mlp)` | Async |
| `libvlc_media_player_set_time(mp, t)` | `libvlc_media_player_set_time(mp, t, fast)` | Added `b_fast` |
| `libvlc_media_player_set_position(mp, p)` | `libvlc_media_player_set_position(mp, p, fast)` | `p` is `double`, added `b_fast` |
| `libvlc_media_player_get_position(mp)` | Same | Returns `double` (was `float`) |
| `libvlc_media_parse_with_options(m, f, t)` | `libvlc_media_parse_request(inst, m, f, t)` | Inst added, returns int |
| `libvlc_media_save_meta(media)` | `libvlc_media_save_meta(inst, media)` | Inst added |
| `libvlc_video_set_deinterlace(mp, mode)` | `libvlc_video_set_deinterlace(mp, state, mode)` | State: -1/0/1 |
| `libvlc_audio_output_device_set(mp, mod, id)` | `libvlc_audio_output_device_set(mp, id)` | Module param removed |
| `libvlc_video_set_crop_geometry(mp, geo)` | `libvlc_video_set_crop_ratio(mp, n, d)` | String → structured |

### Removed APIs (no 4.x equivalent)

| 3.x API | Alternative in 4.x |
|---------|-------------------|
| `libvlc_vlm_*()` (entire VLM API) | Use sout chains via `libvlc_media_add_option()` |
| `libvlc_add_intf(inst, name)` | No equivalent |
| `libvlc_set_exit_handler(inst, cb, op)` | No equivalent |
| `libvlc_media_tracks_get/release()` | `libvlc_media_get_tracklist()` + `_delete()` |
| `libvlc_audio_get_track_description()` | `libvlc_media_player_get_tracklist(mp, audio, false)` |
| `libvlc_video_get_track_description()` | `libvlc_media_player_get_tracklist(mp, video, false)` |
| `libvlc_video_get_spu_description()` | `libvlc_media_player_get_tracklist(mp, text, false)` |
| `libvlc_audio/video_set_track(mp, id)` | `libvlc_media_player_select_track(mp, track)` |
| `libvlc_video_set_spu(mp, id)` | `libvlc_media_player_select_track(mp, track)` |
| `libvlc_audio_get/set_channel()` | `libvlc_audio_get/set_stereomode()` |
| Event: `libvlc_MediaFreed` | No equivalent (use release directly) |
| Event: `libvlc_MediaStateChanged` | No equivalent (use player state events) |

### New APIs (4.x only)

| API | Purpose | See §  |
|-----|---------|--------|
| Tracklist API | String-ID track selection | §3.11 |
| Program API | MPEG-TS program selection | §3.12 |
| GPU rendering (`set_output_callbacks`) | D3D11/OpenGL/GLES2 video output | §3.13 |
| A-B Loop | Loop between two points | §3.14 |
| Picture API | Image type for thumbnails/art | §3.15 |
| Thumbnail Request | Async thumbnail generation | §3.2 Media |
| Watch Time | Precise time interpolation for UI | §2.2 |
| Concurrency (lock/wait/signal) | Built-in sync primitives | §2.2 |
| Recording | `media_player_record()` | §3.3 |
| Display Fit Mode | Contain/cover/fit display modes | §3.3 Video |
| Audio Mix Mode | Force stereo/5.1/7.1/binaural | §3.3 Audio |
| Meta Extra | Custom key-value metadata | §3.2 Media |
| Jump Time | Relative seeking | §3.3 Playback |
| `parse_stop()` | Cancel parsing | §3.2 Media |

### Type Changes

| What | 3.x | 4.x |
|------|-----|-----|
| `get_position()` return | `float` | `double` |
| `is_playing()` return | `int` | `bool` |
| `is_seekable()` return | `int` | `bool` |
| `can_pause()` return | `int` | `bool` |
| `is_running()` (discoverer) | `int` | `bool` |
| ES event track ID | `int i_id` | `const char *psz_id` |
| Position changed event | `float new_position` | `double new_position` |
| Parse flags | Values: 0x00–0x08 | Values: 0x01–0x20 (renumbered) |

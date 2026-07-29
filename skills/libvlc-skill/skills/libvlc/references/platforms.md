## §6. Platform Integration

### 6.1 Windows

**WPF:**
```csharp
// LibVLCSharp.WPF — uses WindowsFormsHost (airspace limitation)
<vlc:VideoView x:Name="VideoView" />

// Code-behind:
VideoView.MediaPlayer = new MediaPlayer(libVLC);
VideoView.MediaPlayer.Play(media);
```

**WinForms:**
```csharp
// Direct handle access
var videoView = new VideoView();
videoView.MediaPlayer = new MediaPlayer(libVLC);
videoView.MediaPlayer.Play(media);
```

**UWP:**
```csharp
// Requires SwapChainPanel + special options
using var libVLC = new LibVLC("--aout=winstore");
```

**Win32 (C) — Full player with drag-and-drop and aspect ratio control:**

Based on the official VLC sample (`doc/libvlc/win_player.c`). Key points: use `WS_CLIPCHILDREN` on the parent window to prevent GDI from painting over the video surface, and use `DragAcceptFiles` for drag-and-drop media loading.

```c
#include <windows.h>
#include <vlc/vlc.h>

struct vlc_context {
    libvlc_instance_t     *p_libvlc;
    libvlc_media_player_t *p_mediaplayer;
};

static LRESULT CALLBACK WindowProc(HWND hWnd, UINT message,
                                   WPARAM wParam, LPARAM lParam)
{
    if (message == WM_CREATE) {
        CREATESTRUCT *c = (CREATESTRUCT *)lParam;
        SetWindowLongPtr(hWnd, GWLP_USERDATA, (LONG_PTR)c->lpCreateParams);
        return 0;
    }

    LONG_PTR p_user_data = GetWindowLongPtr(hWnd, GWLP_USERDATA);
    if (p_user_data == 0)
        return DefWindowProc(hWnd, message, wParam, lParam);
    struct vlc_context *ctx = (struct vlc_context *)p_user_data;

    switch (message) {
        case WM_DESTROY:
            PostQuitMessage(0);
            return 0;

        case WM_DROPFILES: {
            HDROP hDrop = (HDROP)wParam;
            char file_path[MAX_PATH];
            libvlc_media_player_stop(ctx->p_mediaplayer);

            if (DragQueryFile(hDrop, 0, file_path, sizeof(file_path))) {
                libvlc_media_t *p_media = libvlc_media_new_path(
                    ctx->p_libvlc, file_path);
                libvlc_media_t *p_old = libvlc_media_player_get_media(
                    ctx->p_mediaplayer);
                libvlc_media_player_set_media(ctx->p_mediaplayer, p_media);
                libvlc_media_release(p_old);
                libvlc_media_player_play(ctx->p_mediaplayer);
            }
            DragFinish(hDrop);
            return 0;
        }

        case WM_KEYDOWN:
            if (tolower(MapVirtualKey((UINT)wParam, 2)) == 's')
                libvlc_media_player_stop(ctx->p_mediaplayer);
            break;
    }
    return DefWindowProc(hWnd, message, wParam, lParam);
}

int WINAPI WinMain(HINSTANCE hInstance, HINSTANCE hPrevInstance,
                   LPSTR lpCmdLine, int nCmdShow)
{
    struct vlc_context Context;
    Context.p_libvlc = libvlc_new(0, NULL);

    libvlc_media_t *p_media = libvlc_media_new_path(
        Context.p_libvlc, lpCmdLine);
    Context.p_mediaplayer = libvlc_media_player_new_from_media(p_media);

    WNDCLASSEX wc = {0};
    wc.cbSize = sizeof(WNDCLASSEX);
    wc.style = CS_HREDRAW | CS_VREDRAW;
    wc.lpfnWndProc = WindowProc;
    wc.hInstance = hInstance;
    wc.hCursor = LoadCursor(NULL, IDC_ARROW);
    wc.lpszClassName = "VLCPlayerClass";
    RegisterClassEx(&wc);

    /* WS_CLIPCHILDREN is REQUIRED — prevents GDI from overpainting the video */
    HWND hWnd = CreateWindowEx(0, "VLCPlayerClass", "libvlc Demo",
        WS_OVERLAPPEDWINDOW | WS_CLIPCHILDREN,
        CW_USEDEFAULT, CW_USEDEFAULT, 1500, 900,
        NULL, NULL, hInstance, &Context);

    DragAcceptFiles(hWnd, TRUE);           /* Enable drag-and-drop */
    libvlc_media_player_set_hwnd(Context.p_mediaplayer, hWnd);
    ShowWindow(hWnd, nCmdShow);
    libvlc_media_player_play(Context.p_mediaplayer);

    MSG msg;
    while (GetMessage(&msg, NULL, 0, 0)) {
        TranslateMessage(&msg);
        DispatchMessage(&msg);
    }

    libvlc_media_player_stop(Context.p_mediaplayer);
    libvlc_media_release(libvlc_media_player_get_media(Context.p_mediaplayer));
    libvlc_media_player_release(Context.p_mediaplayer);
    libvlc_release(Context.p_libvlc);
    return (int)msg.wParam;
}
```

**Win32 with external D3D11 SwapChain (advanced, for UWP/custom rendering):**

Pass a pre-created D3D11 device context and swap chain to libvlc via CLI args. The app owns the swap chain and signals size changes through private data GUIDs. Based on the official `d3d11_swapr.cpp` sample.

```c
// Key setup (after D3D11CreateDeviceAndSwapChain):
// 1. Enable multithread protection on the D3D11 device
ID3D10Multithread *pMultithread;
d3device->QueryInterface(&IID_ID3D10Multithread, (void **)&pMultithread);
pMultithread->SetMultithreadProtected(TRUE);
pMultithread->Release();

// 2. Share the context mutex via private data
HANDLE d3dctx_mutex = CreateMutexEx(NULL, NULL, 0, SYNCHRONIZE);
d3dctx->SetPrivateData(GUID_CONTEXT_MUTEX, sizeof(d3dctx_mutex), &d3dctx_mutex);

// 3. Set initial swapchain dimensions via private data
uint32_t w = width, h = height;
swapchain->SetPrivateData(GUID_SWAPCHAIN_WIDTH,  sizeof(w), &w);
swapchain->SetPrivateData(GUID_SWAPCHAIN_HEIGHT, sizeof(h), &h);

// 4. Pass pointers to libvlc as CLI args
char ctx_arg[64], swap_arg[64];
sprintf(ctx_arg, "--winrt-d3dcontext=0x%llx", (intptr_t)d3dctx);
sprintf(swap_arg, "--winrt-swapchain=0x%llx", (intptr_t)swapchain);
const char *params[] = { ctx_arg, swap_arg };
libvlc_instance_t *vlc = libvlc_new(2, params);

// 5. On WM_SIZE, update the private data (libvlc reads it to resize output):
swapchain->SetPrivateData(GUID_SWAPCHAIN_WIDTH,  sizeof(new_w), &new_w);
swapchain->SetPrivateData(GUID_SWAPCHAIN_HEIGHT, sizeof(new_h), &new_h);
// DON'T use libvlc_media_player_set_hwnd() with external swapchain
```

### 6.2 macOS / iOS / tvOS

**macOS AppKit (Objective-C) — Full player:**

Based on the official `appkit_player.m` sample. Uses ARC and `__bridge` casting.

```objc
#import <Cocoa/Cocoa.h>
#import <vlc/vlc.h>

@interface AppDelegate : NSObject <NSApplicationDelegate> {
    libvlc_instance_t *instance;
    libvlc_media_player_t *player;
    libvlc_media_t *media;
}
@property NSWindow *window;
@property NSView *view;
@end

@implementation AppDelegate
- (void)applicationDidFinishLaunching:(NSNotification *)aNotification {
    NSWindowStyleMask mask = NSWindowStyleMaskTitled |
        NSWindowStyleMaskMiniaturizable | NSWindowStyleMaskResizable |
        NSWindowStyleMaskClosable;
    _window = [[NSWindow alloc]
        initWithContentRect:NSMakeRect(300, 300, 800, 600)
                  styleMask:mask
                    backing:NSBackingStoreBuffered
                      defer:NO];
    [_window setTitle:@"LibVLC AppKit Player"];
    [_window makeKeyAndOrderFront:nil];

    _view = [[NSView alloc] initWithFrame:NSMakeRect(0, 0, 800, 600)];
    [_window setContentView:_view];

    const char *const vlc_args[] = { "-vv" };
    instance = libvlc_new(1, vlc_args);
    player = libvlc_media_player_new(instance);

    NSString *location = [[NSProcessInfo processInfo] arguments][1];
    media = libvlc_media_new_location(instance, [location UTF8String]);
    libvlc_media_player_set_media(player, media);

    /* __bridge cast required under ARC */
    libvlc_media_player_set_nsobject(player, (__bridge void *)_view);
    libvlc_media_player_play(player);
}
@end

int main(int argc, char *argv[]) {
    AppDelegate *delegate = [[AppDelegate alloc] init];
    [NSApplication sharedApplication];
    [NSApp setActivationPolicy:NSApplicationActivationPolicyRegular];
    [NSApp setDelegate:delegate];
    [NSApp activateIgnoringOtherApps:YES];
    return NSApplicationMain(argc, (const char **)argv);
}
```

**`[4.x]` VLCDrawable protocol (macOS/iOS):**

In libvlc 4.x, the NSView/UIView passed to `set_nsobject()` can optionally implement the `VLCDrawable` protocol, which provides:
- Resize notifications when the video surface changes
- PictureInPicture (PiP) support on supported platforms
- The view manages its own layer hosting for GPU rendering

**LibVLCSharp:**
```csharp
// VideoView is NSView/UIView based
<vlc:VideoView x:Name="VideoView" />
```

### 6.3 Linux

**GTK+ (C) — Full player with file chooser:**

Based on the official `gtk_player.c` sample. The video output must be set after the drawing area widget is realized (i.e., has a native X11 window).

```c
// Build: gcc -o gtk_player gtk_player.c `pkg-config --libs --cflags gtk+-2.0 libvlc`

#include <stdlib.h>
#include <gtk/gtk.h>
#include <gdk/gdkx.h>
#include <vlc/vlc.h>

libvlc_media_player_t *media_player;
libvlc_instance_t *vlc_inst;

/* Set the X11 window ID after the widget has a native window */
void on_realize(GtkWidget *widget, gpointer data) {
    libvlc_media_player_set_xwindow(media_player,
        GDK_WINDOW_XID(gtk_widget_get_window(widget)));
}

void on_open(GtkWidget *widget, gpointer data) {
    GtkWidget *dialog = gtk_file_chooser_dialog_new("Choose Media",
        data, GTK_FILE_CHOOSER_ACTION_OPEN,
        GTK_STOCK_CANCEL, GTK_RESPONSE_CANCEL,
        GTK_STOCK_OPEN, GTK_RESPONSE_ACCEPT, NULL);
    if (gtk_dialog_run(GTK_DIALOG(dialog)) == GTK_RESPONSE_ACCEPT) {
        char *uri = gtk_file_chooser_get_uri(GTK_FILE_CHOOSER(dialog));
        libvlc_media_t *media = libvlc_media_new_location(vlc_inst, uri);
        libvlc_media_player_set_media(media_player, media);
        libvlc_media_player_play(media_player);
        libvlc_media_release(media);
        g_free(uri);
    }
    gtk_widget_destroy(dialog);
}

int main(int argc, char *argv[]) {
    gtk_init(&argc, &argv);

    GtkWidget *window = gtk_window_new(GTK_WINDOW_TOPLEVEL);
    gtk_window_set_default_size(GTK_WINDOW(window), 800, 600);
    g_signal_connect(window, "destroy", G_CALLBACK(gtk_main_quit), NULL);

    GtkWidget *vbox = gtk_vbox_new(FALSE, 0);
    gtk_container_add(GTK_CONTAINER(window), vbox);

    /* Video drawing area — connect "realize" to set X11 window ID */
    GtkWidget *player_widget = gtk_drawing_area_new();
    gtk_box_pack_start(GTK_BOX(vbox), player_widget, TRUE, TRUE, 0);

    vlc_inst = libvlc_new(0, NULL);
    media_player = libvlc_media_player_new(vlc_inst);

    g_signal_connect(player_widget, "realize", G_CALLBACK(on_realize), NULL);

    gtk_widget_show_all(window);
    gtk_main();

    libvlc_media_player_release(media_player);
    libvlc_release(vlc_inst);
    return 0;
}
```

**Key GTK pattern:** The X11 window ID (`GDK_WINDOW_XID`) is only available after the widget is realized. Always connect the `"realize"` signal and set the window ID there, never before `gtk_widget_show_all()`.

### 6.3b Qt (C++)

**Qt player with cross-platform video embedding:**

Based on the official `QtPlayer` sample. Uses platform-conditional APIs for video embedding and a `QTimer` for polling playback state.

```cpp
// Build: qmake && make (requires libvlc and Qt5/6 development packages)
#include <QMainWindow>
#include <QSlider>
#include <QPushButton>
#include <QTimer>
#include <QFileDialog>
#include <vlc/vlc.h>

#ifdef Q_OS_WIN
#include <windows.h>
#endif

class VLCPlayer : public QMainWindow {
    Q_OBJECT
public:
    VLCPlayer() {
        vlcInstance = libvlc_new(0, NULL);
        vlcPlayer = NULL;

        videoWidget = new QWidget(this);
        videoWidget->setAutoFillBackground(true);
        QPalette plt = palette();
        plt.setColor(QPalette::Window, Qt::black);
        videoWidget->setPalette(plt);

        slider = new QSlider(Qt::Horizontal);
        slider->setMaximum(1000);
        connect(slider, &QSlider::sliderMoved, this, &VLCPlayer::seek);

        /* Poll playback position every 100ms */
        QTimer *timer = new QTimer(this);
        connect(timer, &QTimer::timeout, this, &VLCPlayer::updateUI);
        timer->start(100);
        // ... layout setup ...
    }

    ~VLCPlayer() {
        if (vlcPlayer) {
            libvlc_media_player_stop(vlcPlayer);
            libvlc_media_player_release(vlcPlayer);
        }
        if (vlcInstance) libvlc_release(vlcInstance);
    }

    void openFile() {
        QString file = QFileDialog::getOpenFileName(this, "Open Media");
        if (file.isEmpty()) return;

        if (vlcPlayer && libvlc_media_player_is_playing(vlcPlayer))
            stop();

        libvlc_media_t *media = libvlc_media_new_path(vlcInstance,
            file.toUtf8().constData());
        vlcPlayer = libvlc_media_player_new_from_media(media);
        libvlc_media_release(media);

        /* Platform-specific video embedding */
#if defined(Q_OS_MAC)
        libvlc_media_player_set_nsobject(vlcPlayer,
            (void *)videoWidget->winId());
#elif defined(Q_OS_UNIX)
        libvlc_media_player_set_xwindow(vlcPlayer, videoWidget->winId());
#elif defined(Q_OS_WIN)
        /* WS_CLIPCHILDREN required on Windows */
        HWND hwnd = (HWND)videoWidget->winId();
        LONG style = GetWindowLong(hwnd, GWL_STYLE);
        if (!(style & WS_CLIPCHILDREN))
            SetWindowLong(hwnd, GWL_STYLE, style | WS_CLIPCHILDREN);
        libvlc_media_player_set_hwnd(vlcPlayer, hwnd);
#endif
        libvlc_media_player_play(vlcPlayer);
    }

private slots:
    void updateUI() {
        if (!vlcPlayer) return;
        float pos = libvlc_media_player_get_position(vlcPlayer);
        slider->setValue((int)(pos * 1000.0));
        if (libvlc_media_player_get_state(vlcPlayer) == libvlc_Ended)
            stop();
    }

    void seek(int pos) {
        if (vlcPlayer)
            libvlc_media_player_set_position(vlcPlayer, (float)pos / 1000.0);
    }

    void stop() {
        if (vlcPlayer) {
            libvlc_media_player_stop(vlcPlayer);
            libvlc_media_player_release(vlcPlayer);
            vlcPlayer = NULL;
            slider->setValue(0);
        }
    }

private:
    libvlc_instance_t *vlcInstance;
    libvlc_media_player_t *vlcPlayer;
    QWidget *videoWidget;
    QSlider *slider;
};
```

**Key Qt patterns:**
- Use `QTimer` for polling playback state (position, ended) rather than libvlc events, to stay on the Qt event loop
- `videoWidget->winId()` returns the native window handle on all platforms
- On Windows, add `WS_CLIPCHILDREN` to the video widget's window style before setting the HWND

### 6.4 Android

```c
libvlc_media_player_set_android_context(mp, awindow);
```

**LibVLCSharp.Android:**
```csharp
// VideoView wraps SurfaceView
<vlc:VideoView android:id="@+id/videoView" />
```

**vlcj (Android via libvlcjni):**
- Uses `org.videolan.libvlc` from JitPack
- `IVLCVout` interface for surface management

### 6.5 Framework Comparison

| Framework | Binding | Video Surface | GPU Accel |
|-----------|---------|---------------|-----------|
| WPF | LibVLCSharp.WPF | WindowsFormsHost | Yes (D3D) |
| WinForms | LibVLCSharp.WinForms | Direct Handle | Yes (D3D) |
| UWP | LibVLCSharp.UWP | SwapChainPanel | Yes (D3D11) |
| Xamarin.iOS | LibVLCSharp | UIView | Yes (OpenGL) |
| Xamarin.Android | LibVLCSharp | SurfaceView | Yes (MediaCodec) |
| Swing | vlcj | AWT Canvas | Yes (platform) |
| JavaFX | vlcj | PixelBuffer callback | CPU copy |
| GTK | C/Python | DrawingArea | Yes (platform) |
| Qt | C++ | QWidget (winId) | Yes (platform) |
| Avalonia | LibVLCSharp.Avalonia | NativeControlHost | Yes (platform) |

### 6.6 Using MediaPlayerElement (Plug-and-Play UI Control)

`MediaPlayerElement` is a high-level control in LibVLCSharp.Forms that provides a ready-made video player UI with transport controls (play/pause, seek bar, volume, track selection, Chromecast). It replaces the need to build playback UI from scratch.

**Xamarin.Forms / MAUI XAML:**
```xml
<vlc:MediaPlayerElement
    EnableRendererDiscovery="True"
    LibVLC="{Binding LibVLC}"
    MediaPlayer="{Binding MediaPlayer}" />
```

**ViewModel:**
```csharp
public class MainViewModel : INotifyPropertyChanged
{
    public LibVLC LibVLC { get; private set; }
    public MediaPlayer MediaPlayer { get; private set; }

    public void OnAppearing()
    {
        Core.Initialize();
        LibVLC = new LibVLC(enableDebugLogs: true);

        var media = new Media(LibVLC,
            new Uri("http://example.com/video.mp4"));
        MediaPlayer = new MediaPlayer(media) { EnableHardwareDecoding = true };
        media.Dispose();
        MediaPlayer.Play();
    }

    public void OnDisappearing()
    {
        MediaPlayer.Dispose();
        LibVLC.Dispose();
    }
}
```

**Customization** — hide/show controls, change colors, toggle features:
```xml
<vlc:MediaPlayerElement LibVLC="{Binding LibVLC}" MediaPlayer="{Binding MediaPlayer}">
    <vlc:MediaPlayerElement.PlaybackControls>
        <vlc:PlaybackControls
            MainColor="Red"
            IsAspectRatioButtonVisible="False"
            IsAudioTracksSelectionButtonVisible="False"
            IsClosedCaptionsSelectionButtonVisible="False"
            KeepScreenOn="True"
            ShowAndHideAutomatically="True" />
    </vlc:MediaPlayerElement.PlaybackControls>
</vlc:MediaPlayerElement>
```

**Available customization properties:**
- `MainColor`, `ButtonColor`, `Foreground` — theme colors
- `IsPlayPauseButtonVisible`, `IsStopButtonVisible`, `IsSeekBarVisible`, `IsSeekEnabled` — transport controls
- `IsRewindButtonVisible`, `IsSeekButtonVisible` — skip forward/back buttons
- `IsAudioTracksSelectionButtonVisible`, `IsClosedCaptionsSelectionButtonVisible` — track pickers
- `IsCastButtonVisible` — Chromecast button (requires `EnableRendererDiscovery="True"`)
- `IsAspectRatioButtonVisible` — aspect ratio toggle
- `KeepScreenOn` — prevent screen dimming during playback
- `ShowAndHideAutomatically` — auto-hide controls after inactivity

### 6.7 Avalonia Desktop Integration

LibVLCSharp.Avalonia provides a `VideoView` control using Avalonia's `NativeControlHost`. This is suitable for cross-platform desktop apps on Windows, macOS, and Linux.

```csharp
// Avalonia ViewModel — proper Dispose pattern
public class MainWindowViewModel : IDisposable
{
    private readonly LibVLC _libVlc = new();
    public MediaPlayer MediaPlayer { get; }

    public MainWindowViewModel()
    {
        MediaPlayer = new MediaPlayer(_libVlc);
    }

    public void Play()
    {
        if (Design.IsDesignMode) return;  // Skip in XAML preview
        using var media = new Media(_libVlc,
            new Uri("http://example.com/video.mp4"));
        MediaPlayer.Play(media);
    }

    public void Dispose()
    {
        MediaPlayer.Stop();
        MediaPlayer.Dispose();
        _libVlc.Dispose();
    }
}
```

**Key points:**
- Check `Design.IsDesignMode` to avoid libvlc calls during XAML previewer rendering
- Implement `IDisposable` to properly clean up native resources
- `VideoView` in Avalonia wraps `NativeControlHost` — ensure `AllowsTransparency` is not set on the window (native video surfaces don't support transparency on all platforms)

---


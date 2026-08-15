# Makes the dashboard window cover the whole screen, taskbar included.
#
# We cannot use --kiosk: it does this natively but forces InPrivate, which
# wipes localStorage (the Spotify token) on every restart. So: --app for a
# persistent profile, plus one F11 here once the page has settled.
# F11 must come AFTER the first paint, otherwise Chromium leaves the newly
# exposed region unpainted.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class K {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int n);
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
  [DllImport("user32.dll")] public static extern int GetSystemMetrics(int i);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  public struct RECT { public int L, T, R, B; }
}
"@

$deadline = (Get-Date).AddSeconds(60)
do {
  $p = Get-Process -Name msedge -ErrorAction SilentlyContinue |
       Where-Object { $_.MainWindowTitle -like "*Dashboard*" } | Select-Object -First 1
  if ($p) { break }
  Start-Sleep -Milliseconds 750
} while ((Get-Date) -lt $deadline)

if (-not $p) { Write-Output "edge window not found"; exit }

# Let the page load and paint before changing the window size.
Start-Sleep -Seconds 12

$hwnd = $p.MainWindowHandle
[void][K]::ShowWindow($hwnd, 5)
[void][K]::SetForegroundWindow($hwnd)
Start-Sleep -Milliseconds 800

# Always toggle once. GetWindowRect already reports full height with
# --start-fullscreen even while the taskbar still paints on top, so the rect
# cannot be used to decide whether real fullscreen is active.
[K]::keybd_event(0x7A, 0, 0, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 60
[K]::keybd_event(0x7A, 0, 2, [UIntPtr]::Zero)
Write-Output "F11 sent"

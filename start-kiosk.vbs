' Launches the dashboard fullscreen on this display.
'
' Deliberately NOT --kiosk: kiosk mode forces InPrivate, which wipes
' localStorage (and therefore the Spotify token) on every restart.
' --app keeps a persistent profile; fullscreen.ps1 then sends one F11 so the
' window covers the Windows taskbar.
Set sh = CreateObject("WScript.Shell")
home    = sh.ExpandEnvironmentStrings("%USERPROFILE%")
root    = home & "\dashboard-display"
profile = home & "\.dashboard-edge-profile"
edge    = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\Microsoft\Edge\Application\msedge.exe"

opts = " --app=http://127.0.0.1:8080/ --start-fullscreen" _
     & " --user-data-dir=""" & profile & """" _
     & " --no-first-run --no-default-browser-check" _
     & " --disable-session-crashed-bubble --noerrdialogs"

sh.Run """" & edge & """" & opts, 1, False
sh.Run "powershell -NoProfile -ExecutionPolicy Bypass -File """ & root & "\fullscreen.ps1""", 0, True

' Launches the dashboard server with no console window.
' Used by the DashboardServer scheduled task (At logon, InteractiveToken).
' Paths resolve at runtime so this works for any user / install location.
Set sh = CreateObject("Wscript.Shell")
node = sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe"
root = sh.ExpandEnvironmentStrings("%USERPROFILE%") & "\dashboard-display"
sh.Run """" & node & """ """ & root & "\server.js""", 0, False

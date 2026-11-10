; Additions to Tauri's NSIS installer (bundle > windows > nsis > installerHooks in tauri.windows.conf.json).
; Install: the `relay` CLI for cmd and PowerShell in the user's PATH, as <install folder>\bin\relay.cmd. The app writes
; its own copy for the agents it starts (src-tauri/src/actions.rs), this one is for the user's own terminals.
; Uninstall: the PATH entry and the file go, and so does Task Scheduler's "Relay server" task (src-tauri/src/host_windows.rs),
; which would otherwise start a deleted relay.exe at every logon. An update (/UPDATE) leaves all of it in place.

; The user's Path read and written raw (DoNotExpandEnvironmentNames), so a %USERPROFILE% in it stays one. The folder
; comes in through RELAY_BIN, not the command line, so a quote in the user's name cannot break the script.
!define RELAY_PATH_OPEN `$$d=$$env:RELAY_BIN;$$k=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Environment');$$p=[string]$$k.GetValue('Path','','DoNotExpandEnvironmentNames');$$s=$$p -split ';'`
!define RELAY_PATH_ADD `if($$s -notcontains $$d){$$k.SetValue('Path',((($$p.TrimEnd(';')),$$d)|?{$$_})-join';','ExpandString')}`
!define RELAY_PATH_REMOVE `if($$s -contains $$d){$$n=($$s|?{$$_ -ne $$d})-join';';if($$n){$$k.SetValue('Path',$$n,'ExpandString')}else{$$k.DeleteValue('Path')}}`

; `script` names one of the defines above (a define, not its text, so its $$ are read once, on the line below)
!macro RELAY_PATH script
  System::Call 'kernel32::SetEnvironmentVariable(t "RELAY_BIN", t "$INSTDIR\bin")'
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -Command "${RELAY_PATH_OPEN};${${script}}"`
  Pop $0
  ; open terminals keep their PATH, new ones (and Explorer) read the new one
  SendMessage ${HWND_BROADCAST} ${WM_SETTINGCHANGE} 0 "STR:Environment" /TIMEOUT=5000
!macroend

!macro NSIS_HOOK_POSTINSTALL
  CreateDirectory "$INSTDIR\bin"
  FileOpen $0 "$INSTDIR\bin\relay.cmd" w
  FileWrite $0 `@"$INSTDIR\${MAINBINARYNAME}.exe" --cli %*$\r$\n`
  FileClose $0
  !insertmacro RELAY_PATH RELAY_PATH_ADD
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ${If} $UpdateMode <> 1
    !insertmacro RELAY_PATH RELAY_PATH_REMOVE
    Delete "$INSTDIR\bin\relay.cmd"
    RMDir "$INSTDIR\bin"
    RMDir "$INSTDIR"
    nsExec::Exec `"$SYSDIR\schtasks.exe" /End /TN "Relay server"`
    Pop $0
    nsExec::Exec `"$SYSDIR\schtasks.exe" /Delete /TN "Relay server" /F`
    Pop $0
  ${EndIf}
!macroend

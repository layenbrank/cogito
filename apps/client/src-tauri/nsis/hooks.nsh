; NSIS hook macros for Tauri bundler.
; This file is included by the generated installer script when configured via
; `bundle.windows.nsis.installerHooks`.
;
; Available hooks:
; - NSIS_HOOK_PREINSTALL
; - NSIS_HOOK_POSTINSTALL
; - NSIS_HOOK_PREUNINSTALL
; - NSIS_HOOK_POSTUNINSTALL
;
; Note: Keep these macros lightweight and non-interactive where possible.

!macro NSIS_HOOK_PREINSTALL
  ; Best-effort: close the app if it's running to avoid file-in-use errors.
  ; Ignore failures (process may not exist).
  ClearErrors
  ExecWait '"$SYSDIR\\taskkill.exe" /F /T /IM "cogito.exe"' $0
  Sleep 800
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Example: write custom registry values, telemetry opt-in, etc.
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ; Best-effort: close the app if it's running.
  ClearErrors
  ExecWait '"$SYSDIR\\taskkill.exe" /F /T /IM "cogito.exe"' $0
  Sleep 800
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; Cleanup: remove the installation directory.
  ; Your current requirement is to clean only the install directory.
  ; $INSTDIR is the app install directory chosen by the installer.
  RMDir /r "$INSTDIR"
!macroend

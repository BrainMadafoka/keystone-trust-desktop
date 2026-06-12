; Custom NSIS hooks for the Keystone Trust installer.
;
; Fixes the upgrade error:
;   "Échec de désinstallation des anciens fichiers d'application.
;    Veuillez réessayer d'exécuter l'installateur. : 2"
;
; Root cause: with oneClick:false, the new installer runs the PREVIOUS version's
; uninstaller before copying the new files. If the app is still running (window,
; tray icon, or the auto-updater/helper processes), the old "Keystone Trust.exe"
; holds a file lock, the uninstaller can't delete it, and NSIS aborts with code 2.
;
; We force-close every Keystone Trust process before the install proceeds. taskkill
; /T also terminates the Electron child processes (GPU, renderer, utility). If no
; process is running, taskkill returns a non-zero code which we simply discard.

!macro customInit
  nsExec::Exec 'taskkill /F /T /IM "Keystone Trust.exe"'
  Pop $0
!macroend

; Also kill on (re)install/uninstall of THIS version, so future upgrades and manual
; uninstalls don't hit the same locked-files failure.
!macro customUnInstall
  nsExec::Exec 'taskkill /F /T /IM "Keystone Trust.exe"'
  Pop $0
!macroend

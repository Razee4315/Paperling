; Paperling NSIS installer hooks (tauri.conf.json:
; bundle.windows.nsis.installerHooks). Keep this file ASCII-only.
;
; INST-01: refuse to install a build this PC cannot run.
; Both setup.exe files are 32-bit x86 programs, so
; Paperling_<version>_arm64-setup.exe opens and finishes normally on an
; ordinary Intel/AMD PC, and Tauri's installer template has no CPU check. It
; installed an ARM64 paperling.exe and made it the .md handler, so every
; double-click on a note showed Windows' "This app can't run on your PC".
; Reinstalling with the x64 .msi did not help: the per-user NSIS install and
; its per-user .md association stayed ahead of the per-machine one. (The
; arm64 .msi was always refused by Windows Installer; only the .exe let it
; through.) From a user report after the 1.0.51 release: GitHub lists the
; arm64 files first, so "the first .exe" is the wrong one on most PCs.
;
; Tauri includes this file BEFORE its template defines ${ARCH}, so nothing
; here may use ${ARCH} directly. NSIS expands defines where they are USED,
; so PAPERLING_ARCH_GUARD only turns into PaperlingArchGuard_x64 / _arm64 /
; _x86 at the points below that run after the template has set ARCH.

!include LogicLib.nsh
!include x64.nsh
!include WinVer.nsh

!define PAPERLING_ARCH_GUARD "PaperlingArchGuard_${ARCH}"
!define PAPERLING_DOWNLOAD_PAGE "https://github.com/Razee4315/Paperling/releases/latest"

; Normal installs: MUI calls this from .onGUIInit, before the first page, so
; the user is stopped before choosing anything.
!define MUI_CUSTOMFUNCTION_GUIINIT "${PAPERLING_ARCH_GUARD}"

; Silent (/S) installs never run .onGUIInit, so check again at the start of
; the Install section, before any file is copied or .md is associated.
!macro NSIS_HOOK_PREINSTALL
  Call "${PAPERLING_ARCH_GUARD}"
!macroend

; $0 = message, $1 = "1" to offer the download page. Never returns: exits
; with code 2 so winget, scripts and silent installs see a failure.
Function PaperlingWrongPC
  ${If} $1 == "1"
    MessageBox MB_YESNO|MB_ICONSTOP "$0$\r$\n$\r$\nOpen the Paperling download page now?" /SD IDNO IDNO paperling_no_page
    ExecShell "open" "${PAPERLING_DOWNLOAD_PAGE}"
    paperling_no_page:
  ${Else}
    MessageBox MB_OK|MB_ICONSTOP "$0" /SD IDOK
  ${EndIf}
  SetErrorLevel 2
  Quit
FunctionEnd

; The ARM64 build runs only on ARM64 Windows.
Function PaperlingArchGuard_arm64
  ${IfNot} ${IsNativeARM64}
    StrCpy $0 "This is the Paperling installer for Windows on ARM PCs (such as Snapdragon laptops), but this PC has an Intel or AMD processor, so this version would not start here.$\r$\n$\r$\nPlease download the file whose name ends in x64-setup.exe instead."
    StrCpy $1 "1"
    Call PaperlingWrongPC
  ${EndIf}
FunctionEnd

; The x64 build needs 64-bit Windows. ARM64 PCs run it through Windows 11's
; x64 emulation; Windows 10 on ARM has no x64 emulation (build 22000 is the
; first Windows 11 build).
Function PaperlingArchGuard_x64
  ${If} ${IsNativeIA32}
    StrCpy $0 "Paperling needs 64-bit Windows, and this PC is running 32-bit Windows, so it can't be installed here."
    StrCpy $1 "0"
    Call PaperlingWrongPC
  ${ElseIf} ${IsNativeARM64}
  ${AndIfNot} ${AtLeastBuild} 22000
    StrCpy $0 "This is the Paperling installer for PCs with an Intel or AMD processor. This PC has an ARM processor running Windows 10, which can't run it.$\r$\n$\r$\nPlease download the file whose name ends in arm64-setup.exe instead."
    StrCpy $1 "1"
    Call PaperlingWrongPC
  ${EndIf}
FunctionEnd

; Paperling ships no 32-bit build; defined so an x86 bundle still compiles.
Function PaperlingArchGuard_x86
FunctionEnd

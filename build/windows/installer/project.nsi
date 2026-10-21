Unicode true

####
## Konnekt's Windows installer, built by `wails build -nsis` (release.yml and
## snapshot.yml's build-windows jobs) into build\bin\konnekt-amd64-installer.exe
## and published as konnekt-windows-amd64-setup.exe beside the portable exe.
##
## wails writes this file only when it is missing, so the edits below are
## ours to keep. wails_tools.nsh beside it is regenerated on every -nsis build
## and is not tracked; its macros are used where they fit and replaced here
## where they do not.
##
## To iterate on the installer without a full build, run one `wails build -nsis`
## to render wails_tools.nsh and fetch the WebView2 bootstrapper, then:
## > makensis -DARG_WAILS_AMD64_BINARY=..\..\bin\konnekt.exe project.nsi
####

## A per-user install, deliberately. The in-app updater replaces konnekt.exe
## in place (backend/services/update.go, selfupdate.Apply), which an
## unelevated process can only do in a folder the user owns. Under Program
## Files every update would fail with ErrUpdatePermission.
!define REQUEST_EXECUTION_LEVEL "user"

!define INFO_COMPANYNAME "Kollektiv"
!define INFO_PRODUCTNAME "Konnekt"
!define UNINST_KEY_NAME  "Konnekt"

## CI writes version.nsh with the version it stamps into the binary (the tag
## without its v, or the snapshot version), so the installer and Installed
## apps name the build rather than wails.json's -dev base. A local build has
## no version.nsh and falls back to that base.
!include /NONFATAL "version.nsh"

!include "wails_tools.nsh"

!ifndef KONNEKT_VERSION
    !define KONNEKT_VERSION "${INFO_PRODUCTVERSION}"
!endif

# VIProductVersion takes four numbers and nothing else, so it gets the
# version's X.Y.Z core. The trailing "-" makes the parse match a bare
# version too.
!searchparse "${KONNEKT_VERSION}-" "" KONNEKT_VERSION_CORE "-"

VIProductVersion "${KONNEKT_VERSION_CORE}.0"
VIFileVersion    "${KONNEKT_VERSION_CORE}.0"

VIAddVersionKey "CompanyName"     "${INFO_COMPANYNAME}"
VIAddVersionKey "FileDescription" "${INFO_PRODUCTNAME} Installer"
VIAddVersionKey "ProductVersion"  "${KONNEKT_VERSION}"
VIAddVersionKey "FileVersion"     "${KONNEKT_VERSION}"
VIAddVersionKey "LegalCopyright"  "${INFO_COPYRIGHT}"
VIAddVersionKey "ProductName"     "${INFO_PRODUCTNAME}"

# Enable HiDPI support. https://nsis.sourceforge.io/Reference/ManifestDPIAware
ManifestDPIAware true

!include "MUI.nsh"

!define MUI_ICON "..\icon.ico"
!define MUI_UNICON "..\icon.ico"
!define MUI_ABORTWARNING # This will warn the user if they exit from the installer.
!define MUI_FINISHPAGE_RUN "$INSTDIR\${PRODUCT_EXECUTABLE}"
!define MUI_FINISHPAGE_RUN_TEXT "Start ${INFO_PRODUCTNAME}"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "English"

Name "${INFO_PRODUCTNAME}"
OutFile "..\..\bin\${INFO_PROJECTNAME}-${ARCH}-installer.exe"
InstallDir "$LOCALAPPDATA\Programs\${INFO_PRODUCTNAME}"
# A reinstall or upgrade goes where the last install did, even if the user
# picked another folder then.
InstallDirRegKey HKCU "${UNINST_KEY}" "InstallLocation"
ShowInstDetails show

# wails.writeUninstaller and wails.deleteUninstaller write HKLM, which a
# per-user installer cannot. These are the same entries under HKCU, which is
# where Installed apps looks for a per-user install.
!macro konnekt.writeUninstaller
    WriteUninstaller "$INSTDIR\uninstall.exe"

    WriteRegStr HKCU "${UNINST_KEY}" "Publisher" "${INFO_COMPANYNAME}"
    WriteRegStr HKCU "${UNINST_KEY}" "DisplayName" "${INFO_PRODUCTNAME}"
    WriteRegStr HKCU "${UNINST_KEY}" "DisplayVersion" "${KONNEKT_VERSION}"
    WriteRegStr HKCU "${UNINST_KEY}" "DisplayIcon" "$INSTDIR\${PRODUCT_EXECUTABLE}"
    WriteRegStr HKCU "${UNINST_KEY}" "InstallLocation" "$INSTDIR"
    WriteRegStr HKCU "${UNINST_KEY}" "UninstallString" "$\"$INSTDIR\uninstall.exe$\""
    WriteRegStr HKCU "${UNINST_KEY}" "QuietUninstallString" "$\"$INSTDIR\uninstall.exe$\" /S"
    WriteRegDWORD HKCU "${UNINST_KEY}" "NoModify" 1
    WriteRegDWORD HKCU "${UNINST_KEY}" "NoRepair" 1

    ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
    IntFmt $0 "0x%08X" $0
    WriteRegDWORD HKCU "${UNINST_KEY}" "EstimatedSize" "$0"
!macroend

Function .onInit
   !insertmacro wails.checkArchitecture
FunctionEnd

Section
    !insertmacro wails.setShellContext

    !insertmacro wails.webview2runtime

    SetOutPath $INSTDIR

    !insertmacro wails.files

    CreateShortcut "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk" "$INSTDIR\${PRODUCT_EXECUTABLE}"

    !insertmacro konnekt.writeUninstaller
SectionEnd

Section "uninstall"
    !insertmacro wails.setShellContext

    # Named files rather than RMDir /r $INSTDIR: the directory page lets the
    # user install into a folder that holds other things. .konnekt.exe.old is
    # what selfupdate leaves behind when Windows will not let it delete the
    # binary it replaced.
    Delete "$INSTDIR\${PRODUCT_EXECUTABLE}"
    Delete "$INSTDIR\.${PRODUCT_EXECUTABLE}.old"
    Delete "$INSTDIR\uninstall.exe"
    RMDir "$INSTDIR"

    Delete "$SMPROGRAMS\${INFO_PRODUCTNAME}.lnk"

    # The WebView2 cache Wails keeps beside the roaming profile, named after
    # the binary. The settings, server list and layouts in %APPDATA%\konnekt
    # stay: they are the user's, and a reinstall picks them back up. Servers
    # live wherever the user put them and are never touched.
    RMDir /r "$AppData\${PRODUCT_EXECUTABLE}"

    DeleteRegKey HKCU "${UNINST_KEY}"
SectionEnd

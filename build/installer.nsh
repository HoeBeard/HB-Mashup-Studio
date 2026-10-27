; Checks the computer before installing, so nobody ends up with an app that won't start.
!include WinVer.nsh
!include x64.nsh

!macro customInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "HB Mashup Studio needs a 64-bit version of Windows.$\r$\n$\r$\nThis computer is running 32-bit Windows, so the app can't be installed here."
    Quit
  ${EndIf}
  ${IfNot} ${AtLeastWin10}
    MessageBox MB_OK|MB_ICONSTOP "HB Mashup Studio needs Windows 10 or Windows 11.$\r$\n$\r$\nPlease update Windows, then run this installer again."
    Quit
  ${EndIf}
!macroend

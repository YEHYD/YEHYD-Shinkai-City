@echo off
rem Shinkai City -- double-click THIS file, not index.html.
rem Finds a local (or USB-bundled) Chrome/Edge and opens index.html with local-file
rem access allowed. Nothing is installed and no system setting is changed.
rem (Kept ASCII on purpose: a .bat is read in the OEM code page, so Chinese text here
rem  would show up as garbage. The Chinese notes live in README.txt.)
setlocal enabledelayedexpansion

set "HERE=%~dp0"
set "CHROME="

rem 1) portable browser shipped next to index.html
for %%D in ("%HERE%chrome\chrome.exe" "%HERE%chrome-win64\chrome.exe") do (
  if exist "%%~D" set "CHROME=%%~D"
)

rem 2) usual install locations
if not defined CHROME for %%D in (
  "D:\chrome-win64\chrome.exe"
  "%ProgramFiles%\Google\Chrome\Application\chrome.exe"
  "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"
  "%LocalAppData%\Google\Chrome\Application\chrome.exe"
) do (
  if exist "%%~D" if not defined CHROME set "CHROME=%%~D"
)

rem 3) Edge as the fallback
if not defined CHROME for %%D in (
  "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
  "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
) do (
  if exist "%%~D" if not defined CHROME set "CHROME=%%~D"
)

if defined CHROME (
  echo [Shinkai City] opening with %CHROME%
  start "" "%CHROME%" --allow-file-access-from-files --autoplay-policy=no-user-gesture-required "%HERE%index.html"
) else (
  echo [Shinkai City] no Chrome/Edge found, using the default program.
  echo                If the page stays blank, open index.html with Chrome or Edge.
  start "" "%HERE%index.html"
)
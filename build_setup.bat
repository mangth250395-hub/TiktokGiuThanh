@echo off
rem Builds release\TikTokGiuThanh-Setup-<version>.exe: tests, the app into build\setup-dist (dist may be open while
rem you build), then the installer. Needs Inno Setup 6 (https://jrsoftware.org/isinfo.php).
rem   build_setup.bat           -> builds the app again, then the installer
rem   build_setup.bat nobuild   -> the installer only, from dist\TikTokGiuThanh as it is (just built by build.bat)
cd /d "%~dp0"
set SRC=build\setup-dist\TikTokGiuThanh
if /i "%~1"=="nobuild" (
  set SRC=dist\TikTokGiuThanh
) else (
  call "%~dp0build.bat" build\setup-dist || exit /b 1
)
if not exist "%SRC%\TikTokGiuThanh.exe" (
  echo Khong thay %SRC%\TikTokGiuThanh.exe: chay build.bat truoc
  exit /b 1
)
set PY=.venv\Scripts\python.exe
if not exist %PY% if exist ..\TiktokMapLive\.venv\Scripts\python.exe set PY=..\TiktokMapLive\.venv\Scripts\python.exe
for /f "usebackq delims=" %%v in (`%PY% -c "from giuthanh.config import VERSION; print(VERSION)"`) do set APPVER=%%v
set "ISCC=%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" set "ISCC=%ProgramFiles%\Inno Setup 6\ISCC.exe"
if not exist "%ISCC%" (
  echo Khong thay Inno Setup 6: cai tu https://jrsoftware.org/isinfo.php
  exit /b 1
)
"%ISCC%" /Q /DAppVersion=%APPVER% /DSourceDir=%SRC% setup.iss || exit /b 1
echo.
echo Xong: release\TikTokGiuThanh-Setup-%APPVER%.exe
if /i "%~1"=="nobuild" exit /b 0
rem the same build also replaces dist\TikTokGiuThanh, the copy that runs without installing
rem (it cannot be replaced while that game is open: its files are in use)
powershell -NoProfile -Command "if (Get-Process TikTokGiuThanh -ErrorAction SilentlyContinue) { exit 1 }"
if errorlevel 1 (
  echo.
  echo Game dang mo: dong game roi chay lai build_setup.bat de cap nhat dist\TikTokGiuThanh
  exit /b 0
)
robocopy build\setup-dist\TikTokGiuThanh dist\TikTokGiuThanh /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS /NP >nul
if errorlevel 8 (
  echo Khong cap nhat duoc dist\TikTokGiuThanh
  exit /b 1
)
echo Xong: dist\TikTokGiuThanh\TikTokGiuThanh.exe (da cap nhat, mo truc tiep khong can cai)

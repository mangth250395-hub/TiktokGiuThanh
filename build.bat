@echo off
rem Builds TikTokGiuThanh.exe: a window app (no console), as a folder (starts faster, fewer antivirus false alarms).
rem Settings and the session live in %APPDATA%\TikTokGiuThanh, not next to the exe.
rem   build.bat                 -> dist\TikTokGiuThanh\TikTokGiuThanh.exe
rem   build.bat build\other     -> build\other\TikTokGiuThanh\
rem Needs Python 3.12 and Node.js 20 or newer on the PATH, and the pictures in web\public\ts (README: "Hình ảnh").
rem Python: this project's .venv; else the map game's when it is next to this one (..\TiktokMapLive\.venv, the same
rem packages); else a new .venv is made from requirements.txt.
cd /d "%~dp0"
set OUT=%~1
if "%OUT%"=="" set OUT=dist
set PY=.venv\Scripts\python.exe
if not exist %PY% if exist ..\TiktokMapLive\.venv\Scripts\python.exe set PY=..\TiktokMapLive\.venv\Scripts\python.exe
if not exist %PY% (
  python -m venv .venv || exit /b 1
  .venv\Scripts\python -m pip install -r requirements.txt pyinstaller==6.16.0 || exit /b 1
)
if not exist %PY% set PY=.venv\Scripts\python.exe
pushd web
if not exist node_modules call npm ci || (popd & exit /b 1)
call npm test || (popd & exit /b 1)
call npm run build || (popd & exit /b 1)
popd
rem the hub (the connection to TikTok LIVE) is packed into the app, from the copy this repository carries
rem (hub_src; tools\sync_hub.py brings it up to date from the hub's own project, and the tests fail while it is behind)
set HUBSRC=hub_src
if not exist %HUBSRC%\hub\server.py (
  echo Thieu ma nguon hub ^(hub_src\hub^): hub duoc dong goi kem ung dung
  exit /b 1
)
%PY% -m unittest discover -s tests -t . || exit /b 1
%PY% -m PyInstaller --noconfirm --clean --log-level WARN --name TikTokGiuThanh --windowed --onedir ^
  --distpath "%OUT%" --workpath build\work ^
  --icon web\public\icon.ico --version-file tools\version_info.txt --add-data "web\dist;web\dist" ^
  --paths %HUBSRC% --add-data "%HUBSRC%\hub\web;hub\web" --collect-submodules hub ^
  --collect-all TikTokLive --collect-all TikTokLiveProto --collect-all EulerApiSdk ^
  --collect-submodules betterproto2 --collect-submodules websockets ^
  --collect-all webview --collect-all edge_tts --collect-submodules httpx --collect-submodules aiohttp ^
  --collect-all vieneu --collect-all sea_g2p --collect-all onnxruntime --collect-all soundfile --collect-all _soundfile_data ^
  --collect-submodules tokenizers --collect-submodules huggingface_hub --hidden-import yaml ^
  --exclude-module torch --exclude-module torchaudio --exclude-module transformers --exclude-module accelerate ^
  --exclude-module omnivoice --exclude-module scipy --exclude-module gradio --exclude-module pandas ^
  --exclude-module sklearn --exclude-module librosa --exclude-module numba --exclude-module llvmlite ^
  --exclude-module tensorboardX --exclude-module webdataset ^
  run_giuthanh.py || exit /b 1
start "" /wait "%OUT%\TikTokGiuThanh\TikTokGiuThanh.exe" --selftest
if errorlevel 1 (
  echo Ban dong goi thieu thanh phan ^(--selftest that bai^)
  exit /b 1
)
echo.
echo Xong: %OUT%\TikTokGiuThanh\TikTokGiuThanh.exe  (chep ca thu muc khi mang sang may khac)

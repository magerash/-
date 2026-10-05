@echo off
rem Mera on Windows: starts the app at http://127.0.0.1:8765 and opens it in the browser.
rem Needs Python 3.11+ (python.org, "Add python.exe to PATH"). Node.js is only needed to rebuild the web app.
setlocal
cd /d "%~dp0"

where py >nul 2>nul && (set "PY=py -3") || (set "PY=python")
%PY% --version >nul 2>nul || (
  echo Python 3.11 or newer is needed: https://www.python.org/downloads/
  pause & exit /b 1
)

if not exist .venv\Scripts\python.exe (
  echo Creating a Python environment in .venv ...
  %PY% -m venv .venv || goto :fail
)
call .venv\Scripts\activate.bat
echo Checking Python packages ...
python -m pip install --quiet --disable-pip-version-check fastapi uvicorn python-multipart || goto :fail

if not exist web\dist\index.html (
  where npm >nul 2>nul || (
    echo web\dist is missing and Node.js is not installed: https://nodejs.org/
    pause & exit /b 1
  )
  echo Building the web app ...
  pushd web
  call npm ci || (popd & goto :fail)
  call npm run build || (popd & goto :fail)
  popd
)

echo.
echo Mera is starting at http://127.0.0.1:8765  (close this window to stop it)
start "" http://127.0.0.1:8765
python -m uvicorn server.app:app --host 127.0.0.1 --port 8765
goto :eof

:fail
echo.
echo Something above failed. Scroll up for the message.
pause
exit /b 1

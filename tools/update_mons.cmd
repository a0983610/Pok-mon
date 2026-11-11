@echo off
chcp 65001 >nul
rem 手動更新資料：在檔案總管點兩下執行，跑同資料夾的 update_mons.py，
rem 重寫 repo 根目錄的 mons-data.js 與 base-stats.js（逐頁抓 OP.GG，約 3～5 分鐘）
echo 正在從 OP.GG 抓資料，約 3～5 分鐘，請勿關閉視窗……
echo.
python "%~dp0update_mons.py"
echo.
if errorlevel 1 (
  echo 更新失敗，請看上面的錯誤訊息
) else (
  echo 更新完成，重新整理網頁就會看到新資料
)
pause

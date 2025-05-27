@echo off
REM -- Script pour commit + push automatique sur GitHub --

REM Se placer dans le dossier du projet (modifie le chemin si besoin)
cd /d "%~dp0"

REM Ajouter tous les fichiers modifiés
git add .

REM Demander un message de commit personnalisé
set /p commitmsg=Entre le message de commit :

REM Si le message est vide, mettre un message par défaut
if "%commitmsg%"=="" (
    set commitmsg=Update automatique
)

REM Faire le commit
git commit -m "%commitmsg%"

REM Pousser vers la branche main
git push origin main

echo.
echo Push terminé.
pause

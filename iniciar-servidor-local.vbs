' Life Sucos v18 — servidor local resiliente em segundo plano.
Option Explicit
Dim fso, shell, folder, cmd
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
cmd = "cmd.exe /d /s /c ""if not exist logs mkdir logs & node server\index.js >> logs\servidor-autostart.log 2>&1"""
shell.Run cmd, 0, False

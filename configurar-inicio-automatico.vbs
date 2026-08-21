Option Explicit
Dim fso, shell, folder, startup, link, wscriptPath, launcher
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
startup = shell.SpecialFolders("Startup")
wscriptPath = shell.ExpandEnvironmentStrings("%WINDIR%") & "\System32\wscript.exe"
launcher = folder & "\iniciar-servidor-local.vbs"
Set link = shell.CreateShortcut(startup & "\Life Sucos Servidor Local.lnk")
link.TargetPath = wscriptPath
link.Arguments = Chr(34) & launcher & Chr(34)
link.WorkingDirectory = folder
link.WindowStyle = 7
link.Description = "Life Sucos v18 - servidor local resiliente"
link.Save

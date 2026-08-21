' ============================================================
' Cria o atalho "Life Sucos" na Area de Trabalho.
' O atalho usa o icone da Life e abre o inicializador silencioso.
' ============================================================
Option Explicit
Dim fso, WshShell, scriptDir, launcherPath, iconPath, desktopPath, shortcut, wscriptPath
Set fso = CreateObject("Scripting.FileSystemObject")
Set WshShell = CreateObject("WScript.Shell")

scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
launcherPath = scriptDir & "\iniciar-app.vbs"
iconPath = scriptDir & "\life-sucos.ico"
desktopPath = WshShell.SpecialFolders("Desktop")
wscriptPath = WshShell.ExpandEnvironmentStrings("%WINDIR%") & "\System32\wscript.exe"

If Not fso.FileExists(launcherPath) Then
  MsgBox "Nao encontrei o arquivo iniciar-app.vbs nesta pasta." & vbCrLf & _
         "Mantenha os arquivos dentro da pasta do Life Sucos e tente novamente.", 16, "Life Sucos"
  WScript.Quit 1
End If

Set shortcut = WshShell.CreateShortcut(desktopPath & "\Life Sucos.lnk")
shortcut.TargetPath = wscriptPath
shortcut.Arguments = Chr(34) & launcherPath & Chr(34)
shortcut.WorkingDirectory = scriptDir
If fso.FileExists(iconPath) Then shortcut.IconLocation = iconPath & ",0"
shortcut.WindowStyle = 1
shortcut.Description = "Abrir Life Sucos v18 - Servidor Local + AION Sync"
shortcut.Save

MsgBox "Atalho atualizado com sucesso!" & vbCrLf & vbCrLf & _
       "Agora basta clicar duas vezes em 'Life Sucos' na Area de Trabalho." & vbCrLf & _
       "O atalho abre o servidor local resiliente. A nuvem sera sincronizada automaticamente quando estiver disponivel.", 64, "Life Sucos"

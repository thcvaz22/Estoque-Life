' Inicializador silencioso do Life Sucos.
' Mantem a tela preta do .BAT escondida; o servidor abre minimizado.
Option Explicit
Dim fso, shell, folder, bat, cmd, rc
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
bat = folder & "\iniciar-app.bat"

If Not fso.FileExists(bat) Then
  MsgBox "Nao encontrei iniciar-app.bat na pasta do Life Sucos.", 16, "Life Sucos"
  WScript.Quit 1
End If

cmd = "cmd.exe /c """ & bat & """"
' 0 = oculto; False = nao aguarda terminar.
shell.Run cmd, 0, False

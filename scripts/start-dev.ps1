$ErrorActionPreference = "Stop"

$launcher = Join-Path $PSScriptRoot "start-dev.cmd"
& $env:COMSPEC /d /s /c "`"$launcher`""

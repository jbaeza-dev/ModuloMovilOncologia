$ErrorActionPreference = 'Stop'
function Invoke-Native {
    param([string]$Executable, [Parameter(ValueFromRemainingArguments=$true)]$Arguments)
    $flat = @()
    foreach ($a in $Arguments) {
        if ($a -is [System.Collections.IEnumerable] -and $a -isnot [string]) {
            foreach ($item in $a) { $flat += $item }
        } else {
            $flat += $a
        }
    }
    & $Executable @flat
    if ($LASTEXITCODE -ne 0) { throw "$Executable failed (exit $LASTEXITCODE). Operation aborted." }
}
function Get-CheckedDirectory {
    param([string]$Path)
    $resolved = [IO.Path]::GetFullPath($Path)
    if (-not (Test-Path -LiteralPath $resolved -PathType Container)) { throw "Missing directory: $resolved" }
    if ((Get-Item -LiteralPath $resolved).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Symlink directory rejected.' }
    return $resolved
}

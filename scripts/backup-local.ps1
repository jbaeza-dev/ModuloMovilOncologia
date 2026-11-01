param(
    [Parameter(Mandatory)][string]$DatabaseContainer,
    [Parameter(Mandatory)][string]$Database,
    [Parameter(Mandatory)][string]$DatabaseUser,
    [Parameter(Mandatory)][string]$MediaRoot,
    [Parameter(Mandatory)][string]$SimulatorUrl,
    [Parameter(Mandatory)][string]$OperatorToken,
    [string]$BackupRoot = '.local_storage/backups'
)
. "$PSScriptRoot/local-io.ps1"
if ($Database -notmatch '^qc_[a-z0-9_]+$') { throw 'Invalid explicit database name.' }
$media = Get-CheckedDirectory $MediaRoot
$target = Join-Path ([IO.Path]::GetFullPath($BackupRoot)) ([guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $target | Out-Null
$headers = @{ Authorization = "Bearer $OperatorToken" }
$paused = $false
$remote = '/tmp/qc_backup_' + [guid]::NewGuid().ToString('N') + '.dump'
try {
    $result = Invoke-RestMethod -Uri "$SimulatorUrl/admin/api/v1/mantenimiento/pausar-publicacion" -Method Post -Headers $headers -TimeoutSec 20
    $paused = $true
    if (-not $result.ok -or $result.active_publishes -ne 0) { throw 'Publications were not drained.' }
    Invoke-Native docker @('exec', $DatabaseContainer, 'pg_dump', '-U', $DatabaseUser, '-d', $Database, '-Fc', '-f', $remote)
    Invoke-Native docker @('cp', "${DatabaseContainer}:$remote", (Join-Path $target 'source.dump'))
    $snapshot = Join-Path $target 'media'
    New-Item -ItemType Directory -Path $snapshot | Out-Null
    if (Get-ChildItem -LiteralPath $media -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Media symlink rejected.' }
    Get-ChildItem -LiteralPath $media -Force | ForEach-Object {
        if ($_.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Media symlink rejected.' }
        Copy-Item -LiteralPath $_.FullName -Destination $snapshot -Recurse
    }
    $targetPrefix = $target.TrimEnd('\', '/')
    $files = @(Get-ChildItem -LiteralPath $target -Recurse -File | ForEach-Object {
        $rel = $_.FullName.Substring($targetPrefix.Length).TrimStart('\', '/').Replace('\', '/')
        @{ path = $rel; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash }
    })
    @{ version = 1; database = $Database; created_utc = [DateTime]::UtcNow.ToString('o'); files = $files } |
        ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $target 'manifest.json') -Encoding utf8
    Write-Host "Backup confirmed: $target"
} finally {
    try { Invoke-Native docker @('exec', $DatabaseContainer, 'rm', '-f', $remote) }
    finally {
        if ($paused) { Invoke-RestMethod -Uri "$SimulatorUrl/admin/api/v1/mantenimiento/reanudar-publicacion" -Method Post -Headers $headers -TimeoutSec 10 | Out-Null }
    }
}

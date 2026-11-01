param(
    [Parameter(Mandatory)][string]$BackupDir,
    [Parameter(Mandatory)][string]$DatabaseContainer,
    [Parameter(Mandatory)][string]$DatabaseUser,
    [Parameter(Mandatory)][string]$NewDatabase,
    [Parameter(Mandatory)][string]$NewPowerSyncStorageDatabase,
    [Parameter(Mandatory)][string]$VerificationDatabaseUrl,
    [Parameter(Mandatory)][string]$NewMediaRoot
)
. "$PSScriptRoot/local-io.ps1"
foreach ($name in @($NewDatabase, $NewPowerSyncStorageDatabase)) {
    if ($name -notmatch '^qc_[a-z0-9_]+_test$') { throw 'Restore requires NEW explicit qc_*_test databases.' }
}
if ($NewDatabase -eq $NewPowerSyncStorageDatabase) { throw 'Source and sync storage must differ.' }
if (([uri]$VerificationDatabaseUrl).AbsolutePath.Trim('/') -ne $NewDatabase) { throw 'Verification URL must name the new disposable database.' }
$backup = Get-CheckedDirectory $BackupDir
if (Get-ChildItem -LiteralPath $backup -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }) { throw 'Backup symlink rejected.' }
$media = [IO.Path]::GetFullPath($NewMediaRoot)
if (Test-Path -LiteralPath $media) { throw 'Media destination must not exist.' }
$manifest = Get-Content -Raw -LiteralPath (Join-Path $backup 'manifest.json') | ConvertFrom-Json
if ($manifest.version -ne 1) { throw 'Unsupported backup.' }
if (-not ($manifest.files | Where-Object { $_.path -eq 'source.dump' })) { throw 'Missing dump checksum.' }
foreach ($entry in $manifest.files) {
    $path = [IO.Path]::GetFullPath((Join-Path $backup $entry.path))
    if (-not $path.StartsWith($backup + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid manifest path.' }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $entry.sha256) { throw 'Backup checksum mismatch.' }
}
# CREATE fails if either destination already exists. Never clean, drop or infer a working target.
Invoke-Native docker @('exec', $DatabaseContainer, 'createdb', '-U', $DatabaseUser, $NewDatabase)
Invoke-Native docker @('exec', $DatabaseContainer, 'createdb', '-U', $DatabaseUser, $NewPowerSyncStorageDatabase)
$remote = '/tmp/qc_restore_' + [guid]::NewGuid().ToString('N') + '.dump'
try {
    Invoke-Native docker @('cp', (Join-Path $backup 'source.dump'), "${DatabaseContainer}:$remote")
    Invoke-Native docker @('exec', $DatabaseContainer, 'pg_restore', '-U', $DatabaseUser, '-d', $NewDatabase, '--single-transaction', '--exit-on-error', $remote)
    New-Item -ItemType Directory -Path $media | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $backup 'media') -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $media -Recurse }
    $previousDatabaseUrl = $env:DATABASE_URL
    $previousMediaRoot = $env:EDUCATION_MEDIA_ROOT
    try {
        $env:DATABASE_URL = $VerificationDatabaseUrl
        $env:EDUCATION_MEDIA_ROOT = $media
        Invoke-Native node @("$PSScriptRoot/verify-education.mjs")
    } finally {
        $env:DATABASE_URL = $previousDatabaseUrl
        $env:EDUCATION_MEDIA_ROOT = $previousMediaRoot
    }
    Write-Host "Restored to isolated $NewDatabase and $media. Work services were NOT touched."
    Write-Host "Empty PowerSync storage: $NewPowerSyncStorageDatabase. Start a NEW instance against these targets; never repoint an active instance."
    Write-Host 'Verify integrity with verify-education.mjs before starting clients.'
} finally { Invoke-Native docker @('exec', $DatabaseContainer, 'rm', '-f', $remote) }

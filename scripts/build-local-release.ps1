# Offline diagnostic archives only. NOT compatible with the schema-2 CI installer.
param([Parameter(Mandatory)][ValidatePattern('^[a-z0-9][a-z0-9-]+$')][string]$Version)
. "$PSScriptRoot/local-io.ps1"
$root = Split-Path $PSScriptRoot -Parent
$output = Join-Path $root ".local_storage/releases/$Version"
if (Test-Path -LiteralPath $output) { throw 'Release destination already exists.' }
New-Item -ItemType Directory -Path $output | Out-Null
$manifest = @{ version = $Version; images = @{}; files = @{} }
Push-Location $root
try {
    foreach ($service in @('simulator', 'gateway')) {
        $tag = "localhost/quimiocare-${service}:$Version"
        Invoke-Native docker @('build', '--platform', 'linux/amd64', '-f', "infra/demo/Containerfile.$service", '-t', $tag, '.')
        $imageId = (& docker image inspect --format '{{.Id}}' $tag).Trim()
        if ($LASTEXITCODE -ne 0 -or $imageId -notmatch '^sha256:[a-f0-9]{64}$') { throw 'Cannot verify built image.' }
        $archive = Join-Path $output "$service.tar"
        Invoke-Native docker @('save', '-o', $archive, $tag)
        # Docker's containerd store reports a descriptor ID; Podman identifies loaded images by config digest.
        $savedManifest = (& tar -xOf $archive manifest.json | ConvertFrom-Json)
        if ($LASTEXITCODE -ne 0 -or @($savedManifest).Count -ne 1 -or $savedManifest[0].Config -notmatch '(?:^|/)([a-f0-9]{64})(?:\.json)?$') { throw 'Cannot verify exported image config.' }
        $configId = 'sha256:' + $Matches[1]
        $manifest.images[$service] = @{ tag = $tag; id = $configId; docker_descriptor = $imageId; archive = "$service.tar" }
        $manifest.files["$service.tar"] = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $quadlet = Join-Path $output 'quadlet'
    New-Item -ItemType Directory -Path $quadlet | Out-Null
    Get-ChildItem -LiteralPath (Join-Path $root 'infra/universidad/quadlet') -File | ForEach-Object {
        $content = Get-Content -LiteralPath $_.FullName -Raw
        $content = $content.Replace('@@SIMULATOR_IMAGE@@', $manifest.images.simulator.id).Replace('@@GATEWAY_IMAGE@@', $manifest.images.gateway.id)
        [IO.File]::WriteAllText((Join-Path $quadlet $_.Name), $content.Replace("`r`n", "`n"))
        $manifest.files["quadlet/$($_.Name)"] = (Get-FileHash -LiteralPath (Join-Path $quadlet $_.Name) -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    [IO.File]::WriteAllText((Join-Path $output 'images.tsv'), "simulator`t$($manifest.images.simulator.id)`ngateway`t$($manifest.images.gateway.id)`n")
    $manifest.files['images.tsv'] = (Get-FileHash -LiteralPath (Join-Path $output 'images.tsv') -Algorithm SHA256).Hash.ToLowerInvariant()
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $output 'manifest.json') -Encoding utf8
    $checksums = @($manifest.files.Keys | Sort-Object | ForEach-Object { "$($manifest.files[$_])  $_" })
    $checksums += "$((Get-FileHash -LiteralPath (Join-Path $output 'manifest.json') -Algorithm SHA256).Hash.ToLowerInvariant())  manifest.json"
    [IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS'), ($checksums -join "`n") + "`n")
    Write-Host "Local diagnostic archives built: $output. No image was pushed."
} finally { Pop-Location }

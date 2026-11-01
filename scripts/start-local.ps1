param(
    [Parameter(Mandatory)][string]$ConfigFile,
    [ValidateSet('clinical','ai','gateway','worker')][string]$Service = 'clinical',
    [switch]$EnablePreparation
)
. "$PSScriptRoot/local-io.ps1"
$root = Split-Path $PSScriptRoot -Parent
$config = (Resolve-Path -LiteralPath $ConfigFile).Path
Get-Content -LiteralPath $config | ForEach-Object {
    if ($_ -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process') }
}
Push-Location $root
try {
    if ($Service -in @('clinical','ai')) {
        $env:SIMULATOR_SERVICE = $Service
        if ($Service -eq 'ai') { $env:SIMULATOR_PORT = '3103' }
        $env:API_DOCS_ENABLED = if ($EnablePreparation -and $Service -eq 'clinical') { 'true' } else { 'false' }
        $env:PREPARATION_ENABLED = $env:API_DOCS_ENABLED
        Invoke-Native node @('apps/simulator/dist/migrate.js')
        Invoke-Native node @('apps/simulator/dist/server.js')
    } else {
        Invoke-Native node @('apps/gateway/dist/migrate.js')
        Invoke-Native node @("apps/gateway/dist/$(@{gateway='server'; worker='worker'}[$Service]).js")
    }
} finally { Pop-Location }

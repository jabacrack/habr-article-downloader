$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $projectRoot 'extension'
$manifest = Get-Content -LiteralPath (Join-Path $source 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$manifest.background.PSObject.Properties.Remove('service_worker')
$manifest.background.scripts = @($manifest.background.scripts | Where-Object { $_ -ne 'lib/dom-shim.js' })
$manifest | Add-Member -NotePropertyName browser_specific_settings -NotePropertyValue @{
    gecko_android = @{ strict_min_version = '142.0' }
    gecko = @{
        id = 'habr-article-downloader@shydamn'
        strict_min_version = '140.0'
        data_collection_permissions = @{
            required = @('websiteContent', 'browsingActivity', 'authenticationInfo')
        }
    }
}
# The journal is persistent, so do not offer this release in private windows.
$manifest | Add-Member -NotePropertyName incognito -NotePropertyValue 'not_allowed'
$dist = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$archive = Join-Path $dist "habr-article-downloader-$($manifest.version)-firefox.zip"
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem
$stream = [System.IO.File]::Open($archive, [System.IO.FileMode]::Create)
$zip = [System.IO.Compression.ZipArchive]::new($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($file in Get-ChildItem -LiteralPath $source -File -Recurse | Sort-Object FullName) {
        $relative = $file.FullName.Substring($source.Length + 1).Replace('\', '/')
        if ($relative -in @('manifest.json', 'lib/dom-shim.js', 'icons/icon.svg')) { continue }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $relative) | Out-Null
    }
    $entry = $zip.CreateEntry('manifest.json')
    $writer = [System.IO.StreamWriter]::new($entry.Open(), [System.Text.UTF8Encoding]::new($false))
    try { $writer.Write(($manifest | ConvertTo-Json -Depth 20) + "`n") } finally { $writer.Dispose() }
    [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, (Join-Path $projectRoot 'LICENSE'), 'LICENSE') | Out-Null
} finally {
    $zip.Dispose()
    $stream.Dispose()
}
Write-Output $archive

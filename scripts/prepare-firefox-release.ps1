#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$manifest = Get-Content -LiteralPath (Join-Path $projectRoot 'extension/manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$version = $manifest.version
if ($version -notmatch '^\d+(\.\d+){0,3}$') { throw 'Expected a numeric extension version.' }
$baseName = "habr-article-downloader-$version-firefox"
$dist = Join-Path $projectRoot 'dist'
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$stage = Join-Path $dist ('.prepare-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $stage | Out-Null
$utf8 = [System.Text.UTF8Encoding]::new($false)

function Expand-Template([string] $relativePath) {
    $text = [System.IO.File]::ReadAllText((Join-Path $projectRoot $relativePath))
    return $text.Replace('{{VERSION}}', $version).Replace('{{NAME}}', $manifest.name)
}

# JSON object property order is not significant; array order is significant.
function ConvertTo-CanonicalJson($value) {
    if ($null -eq $value) { return 'null' }
    if ($value -is [System.Management.Automation.PSCustomObject]) {
        $parts = foreach ($property in $value.PSObject.Properties | Sort-Object Name) {
            ($property.Name | ConvertTo-Json -Compress) + ':' + (ConvertTo-CanonicalJson $property.Value)
        }
        return '{' + ($parts -join ',') + '}'
    }
    if ($value -is [System.Array]) {
        $parts = foreach ($item in $value) { ConvertTo-CanonicalJson $item }
        return '[' + ($parts -join ',') + ']'
    }
    return ($value | ConvertTo-Json -Compress)
}

try {
    $snapshot = Join-Path $stage 'source'
    New-Item -ItemType Directory -Path $snapshot | Out-Null
    # Explicit allowlist: no .git, dist, downloaded articles or local settings.
    foreach ($directory in @('extension', 'tests')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $directory) -Destination $snapshot -Recurse
    }
    foreach ($directory in @('scripts', 'docs')) {
        New-Item -ItemType Directory -Path (Join-Path $snapshot $directory) | Out-Null
    }
    foreach ($file in @('LICENSE', 'README.md', 'scripts/package-firefox.ps1', 'scripts/prepare-firefox-release.ps1', 'docs/privacy-policy.html', 'docs/firefox-publishing.md')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot $file) -Destination (Join-Path $snapshot $file)
    }
    # Keep templates too, so the full preparation command works from sources.
    New-Item -ItemType Directory -Path (Join-Path $snapshot 'docs/templates') | Out-Null
    foreach ($file in @('BUILD-FIREFOX.md', 'amo-reviewer-notes.txt')) {
        Copy-Item -LiteralPath (Join-Path $projectRoot "docs/templates/$file") -Destination (Join-Path $snapshot "docs/templates/$file")
    }
    [System.IO.File]::WriteAllText((Join-Path $snapshot 'BUILD-FIREFOX.md'), (Expand-Template 'docs/templates/BUILD-FIREFOX.md'), $utf8)
    [System.IO.File]::WriteAllText((Join-Path $snapshot 'docs/amo-reviewer-notes.txt'), (Expand-Template 'docs/templates/amo-reviewer-notes.txt'), $utf8)

    $sourceZip = Join-Path $stage "$baseName-sources.zip"
    # Windows PowerShell Compress-Archive emits backslashes, rejected by AMO.
    Add-Type -AssemblyName System.IO.Compression
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [System.IO.Compression.ZipFile]::Open($sourceZip, [System.IO.Compression.ZipArchiveMode]::Create)
    try {
        foreach ($file in Get-ChildItem -LiteralPath $snapshot -File -Recurse | Sort-Object FullName) {
            $entryName = $file.FullName.Substring($snapshot.Length + 1).Replace('\', '/')
            [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip, $file.FullName, $entryName) | Out-Null
        }
    } finally { $zip.Dispose() }
    $zip = [System.IO.Compression.ZipFile]::OpenRead($sourceZip)
    try {
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName.Contains('\') -or $entry.FullName.StartsWith('/') -or $entry.FullName -match '(^|/)\.\.(/|$)') {
                throw "Invalid source archive entry: $($entry.FullName)"
            }
        }
    } finally { $zip.Dispose() }
    $package = & (Join-Path $snapshot 'scripts/package-firefox.ps1')

    $restored = Join-Path $stage 'restored'
    Expand-Archive -LiteralPath $sourceZip -DestinationPath $restored
    $rebuilt = & (Join-Path $restored 'scripts/package-firefox.ps1')
    $originalFiles = Join-Path $stage 'original-files'
    $rebuiltFiles = Join-Path $stage 'rebuilt-files'
    Expand-Archive -LiteralPath $package -DestinationPath $originalFiles
    Expand-Archive -LiteralPath $rebuilt -DestinationPath $rebuiltFiles
    $original = @(Get-ChildItem -LiteralPath $originalFiles -File -Recurse)
    $reproduction = @(Get-ChildItem -LiteralPath $rebuiltFiles -File -Recurse)
    if ($original.Count -ne $reproduction.Count) { throw 'Rebuild file count differs.' }
    foreach ($file in $original) {
        $relative = $file.FullName.Substring($originalFiles.Length + 1)
        $other = Join-Path $rebuiltFiles $relative
        if (-not (Test-Path -LiteralPath $other -PathType Leaf)) { throw "Missing rebuilt file: $relative" }
        if ($relative -eq 'manifest.json') {
            $left = ConvertTo-CanonicalJson (Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8 | ConvertFrom-Json)
            $right = ConvertTo-CanonicalJson (Get-Content -LiteralPath $other -Raw -Encoding UTF8 | ConvertFrom-Json)
            if ($left -cne $right) { throw 'Rebuilt manifest differs.' }
        } elseif ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $other).Hash) {
            throw "Rebuilt file differs: $relative"
        }
    }

    Copy-Item -LiteralPath $package -Destination (Join-Path $dist "$baseName.zip") -Force
    Copy-Item -LiteralPath $sourceZip -Destination (Join-Path $dist "$baseName-sources.zip") -Force
    Copy-Item -LiteralPath (Join-Path $snapshot 'docs/amo-reviewer-notes.txt') -Destination (Join-Path $dist "$baseName-reviewer-notes.txt") -Force
    Copy-Item -LiteralPath (Join-Path $snapshot 'BUILD-FIREFOX.md') -Destination (Join-Path $dist "$baseName-build-instructions.md") -Force
    Write-Output "Verified rebuild: $($original.Count) files match."
    Write-Output "Release files: $dist\$baseName*"
} finally {
    # Delete only the unique staging directory created by this invocation.
    $resolvedStage = [System.IO.Path]::GetFullPath($stage)
    $expectedParent = [System.IO.Path]::GetFullPath($dist)
    if ((Split-Path -Parent $resolvedStage) -ne $expectedParent -or (Split-Path -Leaf $resolvedStage) -notmatch '^\.prepare-[a-f0-9]{32}$') {
        throw 'Unsafe staging cleanup path.'
    }
    if (Test-Path -LiteralPath $resolvedStage) { Remove-Item -LiteralPath $resolvedStage -Recurse -Force }
}

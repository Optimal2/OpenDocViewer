#Requires -Version 5.1
<#
.SYNOPSIS
    Best-effort local-ci telemetry helpers: deterministic TRX counter parsing
    and a per-repo JSONL writer.

.DESCRIPTION
    Campaign local-ci-telemetri-30-dagarstrend. Every repository's
    scripts/local-ci.ps1 appends one compact schema_version=1 JSON line per run
    to %APPDATA%\@private\ai-orchestrator\local-ci-telemetry\<repo>.jsonl.
    One file per repo, so writers in different repositories never collide; the
    writer opens the file, appends one whole UTF-8 line and closes it. The DEV
    reader (board_charts.local_ci_trend_rows) skips and counts incomplete or
    corrupt lines individually, so a truncated write never destroys the history.

    Telemetry is best-effort but NEVER silent and NEVER gate-breaking: callers
    dot-source this file in a guarded way, invoke Write-LocalCiTelemetry inside
    their own try/catch AFTER the gate result is decided, Write-Warning on
    failure, and keep the run's exit code untouched. A test step that did not
    run records test_count=null with an explicit reason - never zero.

    Records contain no raw stdout, no absolute paths and no machine or user
    identity: only repo name, commit SHA, shell version, statuses and counters.
#>

function Get-LocalCiTrxCounters {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$ResultsDirectory,

        [Parameter(Mandatory = $true)]
        [string]$SuiteName
    )

    # Sums ResultSummary/Counters across the suite's .trx files (same anchoring
    # as the shared zero-execution gate: exactly one Counters node under
    # ResultSummary at the document root). Returns $null when no .trx file
    # exists at all - the caller then records an explicit null, never a zero.
    # Malformed/truncated files are counted, never blended into the sums.
    $suite = [ordered]@{
        name            = $SuiteName
        total           = 0
        executed        = 0
        passed          = 0
        failed          = 0
        notExecuted     = 0
        trx_files       = 0
        malformed_files = 0
    }
    if (-not (Test-Path -LiteralPath $ResultsDirectory -PathType Container)) {
        return $null
    }
    $trxFiles = @(Get-ChildItem -LiteralPath $ResultsDirectory -Filter '*.trx' -File)
    if ($trxFiles.Count -eq 0) {
        return $null
    }
    foreach ($trxFile in $trxFiles) {
        $suite.trx_files++
        try {
            # XmlDocument.Load honours the file's declared encoding.
            $trx = New-Object System.Xml.XmlDocument
            $trx.Load($trxFile.FullName)
            $counters = $trx.SelectSingleNode('/*[local-name()="TestRun"]/*[local-name()="ResultSummary"]/*[local-name()="Counters"]')
            if ($null -eq $counters) {
                $suite.malformed_files++
                continue
            }
            foreach ($attribute in @('total', 'executed', 'passed', 'failed', 'notExecuted')) {
                if ($counters.HasAttribute($attribute)) {
                    $suite[$attribute] = [int]$suite[$attribute] + [int]$counters.GetAttribute($attribute)
                }
            }
        }
        catch {
            $suite.malformed_files++
        }
    }
    return $suite
}

function Write-LocalCiTelemetry {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Repo,

        [Parameter(Mandatory = $true)]
        [string]$RepositoryRoot,

        # Overall gate verdict, decided BEFORE this call.
        [Parameter(Mandatory = $true)]
        [ValidateSet('pass', 'fail')]
        [string]$Status,

        [Parameter(Mandatory = $true)]
        [long]$DurationMs,

        # $null when no build step ran (or timing was impossible) - never 0.
        [Parameter(Mandatory = $false)]
        [Nullable[long]]$BuildDurationMs,

        [Parameter(Mandatory = $false)]
        [ValidateSet('passed', 'failed', 'not-run', 'skipped')]
        [string]$TestStatus = 'not-run',

        # $null when no test step ran - never 0.
        [Parameter(Mandatory = $false)]
        [Nullable[int]]$TestCount,

        [Parameter(Mandatory = $false)]
        [string]$TestSkipReason = '',

        [Parameter(Mandatory = $false)]
        [object[]]$Suites = @()
    )

    # Throws on failure; the caller's try/catch turns that into a visible
    # Write-Warning while the gate's exit code stays untouched.
    $appData = $env:APPDATA
    if ([string]::IsNullOrWhiteSpace($appData)) {
        throw 'APPDATA is not set; the telemetry directory cannot be resolved.'
    }
    $telemetryDirectory = Join-Path $appData '@private\ai-orchestrator\local-ci-telemetry'
    if (-not (Test-Path -LiteralPath $telemetryDirectory -PathType Container)) {
        $null = New-Item -ItemType Directory -Path $telemetryDirectory -Force
    }
    $targetFile = Join-Path $telemetryDirectory ($Repo + '.jsonl')

    $commitSha = 'unknown'
    try {
        $sha = (& git -C $RepositoryRoot rev-parse HEAD 2>$null)
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace("$sha")) {
            $commitSha = ([string]$sha).Trim()
        }
    }
    catch { <# no git or no repo: 'unknown' is the honest value #> }

    $record = [ordered]@{
        schema_version    = 1
        timestamp_utc     = [DateTime]::UtcNow.ToString('yyyy-MM-ddTHH:mm:ss.fffffffZ')
        repo              = $Repo
        commit_sha        = $commitSha
        shell_version     = $PSVersionTable.PSVersion.ToString()
        status            = $Status
        duration_ms       = $DurationMs
        build_duration_ms = $BuildDurationMs
        test_status       = $TestStatus
        test_count        = $TestCount
        test_skip_reason  = $TestSkipReason
        suites            = @($Suites)
    }
    $json = ConvertTo-Json -InputObject $record -Compress -Depth 8
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    if ($utf8NoBom.GetByteCount($json) -gt 4096) {
        # Compact records only: drop the per-suite detail first - the 4 KiB
        # line contract outranks suite counters.
        $record.suites = @()
        $json = ConvertTo-Json -InputObject $record -Compress -Depth 8
        if ($utf8NoBom.GetByteCount($json) -gt 4096) {
            throw 'Telemetry record exceeds 4096 UTF-8 bytes even without per-suite detail.'
        }
    }
    # Open, write one whole UTF-8 line, close. One file per repo, so no
    # cross-repository writer can ever interleave inside this file.
    [System.IO.File]::AppendAllText($targetFile, $json + "`n", $utf8NoBom)
}

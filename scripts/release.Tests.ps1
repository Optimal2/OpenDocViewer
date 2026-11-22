# File: scripts/release.Tests.ps1
<#
.SYNOPSIS
Pester tests for the decision logic of release.ps1.

.DESCRIPTION
release.ps1 is never run here. Its function definitions are read from the syntax tree and
defined in the test scope; the script body (fetch, version bump, commit, tag, push) is not
executed. The only external command a test starts is a read-only `git rev-parse`.

Run through scripts/release-script.test.mjs (part of `npx vitest run`) or directly:
  Invoke-Pester -Path scripts/release.Tests.ps1
#>

BeforeAll {
  $script:ReleaseScriptPath = Join-Path (Split-Path -Parent $PSScriptRoot) 'release.ps1'
  $tokens = $null
  $parseErrors = $null
  $script:ReleaseAst = [System.Management.Automation.Language.Parser]::ParseFile(
    $script:ReleaseScriptPath, [ref]$tokens, [ref]$parseErrors)
  if ($parseErrors.Count) { throw "release.ps1 does not parse: $($parseErrors[0].Message)" }
  $script:ReleaseText = $script:ReleaseAst.Extent.Text

  $definitions = $script:ReleaseAst.FindAll(
    { param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] }, $false)
  foreach ($definition in $definitions) {
    . ([scriptblock]::Create($definition.Extent.Text))
  }

  # release.ps1 runs with these settings; the functions are tested under the same ones.
  Set-StrictMode -Version Latest
  $ErrorActionPreference = 'Stop'

  $script:RepoRoot = Split-Path -Parent $PSScriptRoot
}

Describe 'Get-ReleaseTypeBetween' {
  It 'names the single step from <Base> to <New> as <Expected>' -ForEach @(
    @{ Base = '2.12.0'; New = '2.12.1'; Expected = 'patch' }
    @{ Base = '2.12.9'; New = '2.13.0'; Expected = 'minor' }
    @{ Base = '2.12.9'; New = '3.0.0'; Expected = 'major' }
    @{ Base = '2.12.0'; New = '2.12.2'; Expected = '' }
    @{ Base = '2.12.0'; New = '2.13.1'; Expected = '' }
    @{ Base = '2.12.0'; New = '2.12.0'; Expected = '' }
    @{ Base = '2.12.0'; New = '2.11.9'; Expected = '' }
    @{ Base = ''; New = '2.12.1'; Expected = '' }
    @{ Base = '2.12.0'; New = '2.12.1-rc.1'; Expected = '' }
  ) {
    Get-ReleaseTypeBetween $Base $New | Should -Be $Expected
  }
}

Describe 'Test-PreparedRelease' {
  BeforeAll {
    $script:Prepared = @{
      LocalHead = 'aaaa'; RemoteHead = 'bbbb'; ParentHead = 'bbbb'; TagCommit = 'aaaa'
      Subject = 'chore(release): 2.12.1'; Version = '2.12.1'
    }
  }

  It 'recognizes one release commit with its tag on top of origin' {
    Test-PreparedRelease @script:Prepared | Should -BeTrue
  }

  It 'rejects the state when <Name> differs' -ForEach @(
    @{ Name = 'the parent commit'; Key = 'ParentHead'; Value = 'cccc' }
    @{ Name = 'the tagged commit'; Key = 'TagCommit'; Value = 'bbbb' }
    @{ Name = 'the missing tag'; Key = 'TagCommit'; Value = '' }
    @{ Name = 'the subject line'; Key = 'Subject'; Value = 'Fix something' }
    @{ Name = 'the version in the subject'; Key = 'Subject'; Value = 'chore(release): 2.12.2' }
  ) {
    $state = $script:Prepared.Clone()
    $state[$Key] = $Value
    Test-PreparedRelease @state | Should -BeFalse
  }
}

Describe 'Get-PreparedReleaseArgumentProblem' {
  It 'accepts an omitted -ReleaseType' {
    Get-PreparedReleaseArgumentProblem -ReleaseType '' -BaseVersion '2.12.0' -PreparedVersion '2.12.1' | Should -Be ''
  }

  It 'accepts the -ReleaseType that matches the prepared version' {
    Get-PreparedReleaseArgumentProblem -ReleaseType 'patch' -BaseVersion '2.12.0' -PreparedVersion '2.12.1' | Should -Be ''
    Get-PreparedReleaseArgumentProblem -ReleaseType 'MINOR' -BaseVersion '2.12.4' -PreparedVersion '2.13.0' | Should -Be ''
  }

  It 'reports a -ReleaseType that does not match the prepared version' {
    $problem = Get-PreparedReleaseArgumentProblem -ReleaseType 'major' -BaseVersion '2.12.0' -PreparedVersion '2.12.1'
    $problem | Should -Match '-ReleaseType major'
    $problem | Should -Match '2\.12\.0 -> 2\.12\.1'
    $problem | Should -Match 'patch'
    $problem | Should -Match 'Nothing was pushed'
  }

  It 'reports a -ReleaseType that cannot be checked against the prepared version' {
    $problem = Get-PreparedReleaseArgumentProblem -ReleaseType 'patch' -BaseVersion '' -PreparedVersion '2.12.1'
    $problem | Should -Match 'Nothing was pushed'
  }
}

Describe 'Get-PreparedReleaseNotices' {
  It 'says that -SkipValidation has no effect on a prepared release' {
    $notices = @(Get-PreparedReleaseNotices -SkipValidation $true)
    $notices.Count | Should -Be 1
    $notices[0] | Should -Match '-SkipValidation has no effect'
  }

  It 'stays silent without -SkipValidation' {
    @(Get-PreparedReleaseNotices -SkipValidation $false).Count | Should -Be 0
  }
}

Describe 'Format-PreparedReleaseSummary' {
  It 'shows version, tag, branch and what is pushed' {
    $summary = Format-PreparedReleaseSummary -RepoRoot 'C:\repo' -Branch 'main' -BaseVersion '2.12.0' `
      -Version '2.12.1' -TagName 'v2.12.1' -ReleaseCommit 'aaaa1111' -BaseCommit 'bbbb2222' `
      -Notices @('-SkipValidation has no effect here.')
    $summary | Should -Match '2\.12\.0 -> 2\.12\.1 \(patch\)'
    $summary | Should -Match 'v2\.12\.1'
    $summary | Should -Match 'Branch:\s+main'
    $summary | Should -Match 'aaaa1111'
    $summary | Should -Match 'bbbb2222'
    $summary | Should -Match 'git push --atomic --no-follow-tags origin main refs/tags/v2\.12\.1'
    $summary | Should -Match 'no other tag'
    $summary | Should -Match 'Release workflow'
    $summary | Should -Match '-SkipValidation has no effect here\.'
  }
}

Describe 'Confirm-PreparedReleasePublish' {
  It 'does not ask when -Yes is given' {
    $script:asked = 0
    $result = Confirm-PreparedReleasePublish -Summary 'summary' -Yes $true -Prompt { $script:asked++; 'N' } 6> $null
    $result | Should -BeTrue
    $script:asked | Should -Be 0
  }

  It 'asks and publishes only on Y' {
    Confirm-PreparedReleasePublish -Summary 'summary' -Yes $false -Prompt { 'y' } 6> $null | Should -BeTrue
    Confirm-PreparedReleasePublish -Summary 'summary' -Yes $false -Prompt { ' Y ' } 6> $null | Should -BeTrue
  }

  It 'does not publish on <Answer>' -ForEach @(
    @{ Answer = 'N' }
    @{ Answer = '' }
    @{ Answer = 'yes please' }
    @{ Answer = $null }
  ) {
    $answer = $Answer
    Confirm-PreparedReleasePublish -Summary 'summary' -Yes $false -Prompt { $answer }.GetNewClosure() 6> $null |
      Should -BeFalse
  }

  It 'shows the summary before it asks' {
    $shown = Confirm-PreparedReleasePublish -Summary 'THE-SUMMARY' -Yes $false -Prompt { 'N' } 6>&1
    ($shown | Out-String) | Should -Match 'THE-SUMMARY'
  }
}

Describe 'Get-ReleasePushArguments' {
  It 'pushes exactly the branch and the release tag, atomically' {
    $arguments = @(Get-ReleasePushArguments -Branch 'main' -TagName 'v2.12.1')
    # --no-follow-tags overrides a user's push.followTags=true, which would add other tags.
    ($arguments -join ' ') | Should -Be 'push --atomic --no-follow-tags origin main refs/tags/v2.12.1'
  }

  It 'refuses a tag name that is not exactly vX.Y.Z: <Name>' -ForEach @(
    @{ Name = 'a trailing line feed'; TagName = "v2.12.1`n" }
    @{ Name = 'a capital V'; TagName = 'V2.12.1' }
    @{ Name = 'a leading space'; TagName = ' v2.12.1' }
    @{ Name = 'non-ASCII digits'; TagName = "v2.12.$([char]0x0661)" }
    @{ Name = 'a prerelease suffix'; TagName = 'v2.12.1-rc.1' }
  ) {
    { Get-ReleasePushArguments -Branch 'main' -TagName $TagName } | Should -Throw
  }

  It 'refuses to build a push without <Name>' -ForEach @(
    @{ Name = 'a tag'; Branch = 'main'; TagName = '' }
    @{ Name = 'a branch'; Branch = ''; TagName = 'v2.12.1' }
    @{ Name = 'a plain tag name'; Branch = 'main'; TagName = 'v2.12.1 --follow-tags' }
  ) {
    { Get-ReleasePushArguments -Branch $Branch -TagName $TagName } | Should -Throw
  }
}

Describe 'Get-PushFailureRollback' {
  It 'leaves a release that an earlier run prepared untouched' {
    @(Get-PushFailureRollback -CreatedInThisRun $false -TagName 'v2.12.1' -PrevHead 'bbbb').Count | Should -Be 0
  }

  It 'removes only what this run created' {
    $steps = @(Get-PushFailureRollback -CreatedInThisRun $true -TagName 'v2.12.1' -PrevHead 'bbbb')
    $steps.Count | Should -Be 2
    ($steps[0].GitArgs -join ' ') | Should -Be 'tag -d v2.12.1'
    ($steps[1].GitArgs -join ' ') | Should -Be 'reset --hard bbbb'
  }

  It 'never resets without a known previous commit' {
    @(Get-PushFailureRollback -CreatedInThisRun $true -TagName 'v2.12.1' -PrevHead '').Count | Should -Be 0
  }
}

Describe 'Exec' {
  It 'returns the exit code instead of failing when -AllowNonZero is given' {
    $result = Exec 'git' @('rev-parse', '--verify', '--quiet', 'refs/heads/odv-release-test-no-such-branch^{commit}') `
      -Cwd $script:RepoRoot -AllowNonZero -Quiet
    $result.Code | Should -Not -Be 0
  }

  It 'keeps stderr out of the error stream when -AllowNonZero is given' {
    # Without --quiet git writes "fatal: Needed a single revision" to stderr.
    { Exec 'git' @('rev-parse', '--verify', 'refs/heads/odv-release-test-no-such-branch') `
        -Cwd $script:RepoRoot -AllowNonZero -Quiet } | Should -Not -Throw
  }

  It 'fails with the command, the exit code and stderr without -AllowNonZero' {
    $failure = $null
    try {
      Exec 'git' @('rev-parse', '--verify', 'refs/heads/odv-release-test-no-such-branch') -Cwd $script:RepoRoot -Quiet
    } catch {
      $failure = $_.Exception.Message
    }
    $failure | Should -Match 'Command failed \(git rev-parse'
    $failure | Should -Match 'exit code'
    $failure | Should -Match 'fatal'
  }
}

Describe 'release.ps1 flow' {
  It 'does not treat origin as the rollback target of a prepared release' {
    $script:ReleaseText | Should -Not -Match '\$prevHead\s*=\s*\$remoteHead'
  }

  It 'checks the arguments and asks for confirmation before the push' {
    $check = $script:ReleaseText.IndexOf('$preparedProblem = Get-PreparedReleaseArgumentProblem')
    $confirm = $script:ReleaseText.IndexOf('Confirm-PreparedReleasePublish -Summary')
    $push = $script:ReleaseText.IndexOf('Exec ''git'' (Get-ReleasePushArguments -Branch $branch -TagName $tagName)')
    $check | Should -BeGreaterThan 0
    $confirm | Should -BeGreaterThan $check
    $push | Should -BeGreaterThan $confirm
  }

  It 'pushes through Get-ReleasePushArguments only, in both modes' {
    # One push statement serves the same-run and the prepared release. --follow-tags would also
    # push every other annotated tag reachable from HEAD, and a stray v* tag starts the Release
    # workflow.
    $script:ReleaseText | Should -Not -Match '(?<!--no-)follow-tags'
    $pushes = $script:ReleaseAst.FindAll({ param($node)
        $node -is [System.Management.Automation.Language.StringConstantExpressionAst] -and $node.Value -eq 'push' }, $true)
    @($pushes).Count | Should -Be 1
    $owner = $pushes[0].Parent
    while ($owner -and $owner -isnot [System.Management.Automation.Language.FunctionDefinitionAst]) { $owner = $owner.Parent }
    $owner.Name | Should -Be 'Get-ReleasePushArguments'
  }

  It 'suggests publishing with the confirmation question after a local preparation' {
    $script:ReleaseText | Should -Match 'Write-Host "  \.\\release\.ps1 -Publish" '
    $script:ReleaseText | Should -Not -Match 'Write-Host[^\r\n]*-Yes -Publish'
    $script:ReleaseText | Should -Match 'Write-Host[^\r\n]*-Yes skips'
  }

  It 'requires PowerShell 7' {
    $script:ReleaseAst.ScriptRequirements | Should -Not -BeNullOrEmpty
    $script:ReleaseAst.ScriptRequirements.RequiredPSVersion | Should -Be ([version]'7.0')
  }

  It 'lets the rollback plan decide what a failed push removes' {
    $catch = $script:ReleaseText.Substring($script:ReleaseText.IndexOf('Exec ''git'' (Get-ReleasePushArguments'))
    $catch | Should -Match 'Get-PushFailureRollback -CreatedInThisRun \(-not \$preparedRelease\)'
    $catch | Should -Not -Match "@\('tag', '-d'"
    $catch | Should -Not -Match "@\('reset', '--hard'"
  }

  It 'documents -ReleaseType without the removed npm release scripts' {
    $help = @{}
    foreach ($section in [regex]::Matches($script:ReleaseText, '(?ms)^\.PARAMETER (\w+)\s*$(.*?)(?=^\.[A-Z]+|^#>)')) {
      $help[$section.Groups[1].Value] = $section.Groups[2].Value
    }
    $help['ReleaseType'] | Should -Not -Match 'matching npm release script'
    $help['ReleaseType'] | Should -Match 'npm version'
    $help['Yes'] | Should -Match 'prepared'
    $help['SkipValidation'] | Should -Match 'prepared'
  }
}

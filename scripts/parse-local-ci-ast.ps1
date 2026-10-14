#requires -Version 5.1
<#
.SYNOPSIS
    Emits the PowerShell AST of a script file as flat JSON for the step-4
    remedy lock in scripts/local-ci-agent-docs-output.test.mjs.

.DESCRIPTION
    Parses -Path with PowerShell's own parser
    ([System.Management.Automation.Language.Parser]::ParseFile) and writes
    one JSON document to stdout: { parseErrors: [...], nodes: [...] }.
    Each node carries its AST type name, extent offsets, parent id and the
    scalar facts the JavaScript allowlist validator needs (variable path,
    string value, operator, command name). The script never executes the
    parsed file. Parse errors are reported in the JSON, not thrown, so the
    caller can fail with a named reason.
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$Path
)

$ErrorActionPreference = 'Stop'

$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile($Path, [ref]$tokens, [ref]$parseErrors)

$nodes = @()
if ($null -ne $ast) {
    $idGenerator = New-Object System.Runtime.Serialization.ObjectIDGenerator
    $all = $ast.FindAll({ param($node) $true }, $true)
    foreach ($node in $all) {
        $firstSeen = $false
        $id = $idGenerator.GetId($node, [ref]$firstSeen)
        $parentId = 0
        if ($null -ne $node.Parent) {
            $parentFirstSeen = $false
            $parentId = $idGenerator.GetId($node.Parent, [ref]$parentFirstSeen)
        }
        $entry = [ordered]@{
            id               = [long]$id
            parentId         = [long]$parentId
            type             = $node.GetType().Name
            start            = $node.Extent.StartOffset
            end              = $node.Extent.EndOffset
            text             = $node.Extent.Text
            value            = $null
            stringConstantType = $null
            operator         = $null
            userPath         = $null
            splatted         = $false
            commandName      = $null
            parameterName    = $null
            invocationOperator = $null
            clauseCount      = $null
            hasElse          = $null
        }
        if ($node -is [System.Management.Automation.Language.VariableExpressionAst]) {
            $entry.userPath = $node.VariablePath.UserPath
            $entry.splatted = [bool]$node.Splatted
        }
        elseif ($node -is [System.Management.Automation.Language.StringConstantExpressionAst]) {
            $entry.value = $node.Value
            $entry.stringConstantType = $node.StringConstantType.ToString()
        }
        elseif ($node -is [System.Management.Automation.Language.ExpandableStringExpressionAst]) {
            $entry.value = $node.Value
        }
        elseif ($node -is [System.Management.Automation.Language.ConstantExpressionAst]) {
            $entry.value = if ($null -eq $node.Value) { $null } else { $node.Value.ToString() }
        }
        if ($node -is [System.Management.Automation.Language.AssignmentStatementAst]) {
            $entry.operator = $node.Operator.ToString()
        }
        elseif ($node -is [System.Management.Automation.Language.BinaryExpressionAst]) {
            $entry.operator = $node.Operator.ToString()
        }
        elseif ($node -is [System.Management.Automation.Language.CommandAst]) {
            $entry.commandName = $node.GetCommandName()
            $entry.invocationOperator = $node.InvocationOperator.ToString()
        }
        elseif ($node -is [System.Management.Automation.Language.CommandParameterAst]) {
            $entry.parameterName = $node.ParameterName
        }
        elseif ($node -is [System.Management.Automation.Language.IfStatementAst]) {
            $entry.clauseCount = $node.Clauses.Count
            $entry.hasElse = ($null -ne $node.ElseClause)
        }
        $nodes += [pscustomobject]$entry
    }
}

$parseErrorTexts = @()
if ($null -ne $parseErrors) {
    foreach ($parseError in $parseErrors) {
        $parseErrorTexts += $parseError.Message
    }
}

[pscustomobject]@{ parseErrors = $parseErrorTexts; nodes = $nodes } | ConvertTo-Json -Depth 4

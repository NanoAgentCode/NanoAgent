param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("Add", "Remove")]
  [string]$Action,

  [Parameter(Mandatory = $true)]
  [string]$Path
)

$ErrorActionPreference = "Stop"

function Normalize-PathEntry {
  param([string]$Value)

  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ""
  }

  return [Environment]::ExpandEnvironmentVariables($Value.Trim().Trim('"')).TrimEnd("\")
}

$target = Normalize-PathEntry $Path
if (-not $target) {
  throw "PATH entry must not be empty"
}

$current = [Environment]::GetEnvironmentVariable("Path", "User")
$entries = @($current -split ";" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
$matchingEntries = @($entries | Where-Object { (Normalize-PathEntry $_) -ieq $target })

if ($Action -eq "Add") {
  if ($matchingEntries.Count -eq 0) {
    $entries = @($Path.Trim().TrimEnd("\")) + $entries
  }
} else {
  $entries = @($entries | Where-Object { (Normalize-PathEntry $_) -ine $target })
}

[Environment]::SetEnvironmentVariable("Path", ($entries -join ";"), "User")

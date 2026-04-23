param(
  [ValidateSet("start", "stop", "restart", "status", "logs")]
  [string]$Command = "status",
  [switch]$SkipInfra,
  [switch]$SkipInstall,
  [switch]$SkipGenerate,
  [switch]$Migrate,
  [switch]$Seed,
  [switch]$NoApps
)

$ErrorActionPreference = "Stop"

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot "../..")
$LogRoot = Join-Path $RepoRoot ".codex-logs"
$StatePath = Join-Path $LogRoot "local-launcher.json"

if (-not (Test-Path $LogRoot)) {
  New-Item -ItemType Directory -Path $LogRoot | Out-Null
}

Set-Location $RepoRoot
. "$PSScriptRoot/local-env.ps1"
$Runtime = Use-LocalRuntimeEnv ".env"

function Get-EnvOrDefault([string]$Name, [string]$DefaultValue) {
  $value = (Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue).Value
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }

  return $value
}

$Ports = @{
  api = [int](Get-EnvOrDefault "API_PORT" "4000")
  worker = [int](Get-EnvOrDefault "WORKER_PORT" "4001")
  connector = [int](Get-EnvOrDefault "CONNECTOR_PORT" "4010")
  web = [int](Get-EnvOrDefault "WEB_PORT" "3000")
}

$Components = @(
  @{
    Name = "api"
    Port = $Ports.api
    Script = "dev:api"
    Url = "http://localhost:$($Ports.api)/health"
    Log = Join-Path $RepoRoot ".local-api.log"
    Err = Join-Path $RepoRoot ".local-api.err.log"
  },
  @{
    Name = "worker"
    Port = $Ports.worker
    Script = "dev:worker"
    Url = "http://localhost:$($Ports.worker)/health"
    Log = Join-Path $RepoRoot ".local-worker.log"
    Err = Join-Path $RepoRoot ".local-worker.err.log"
  },
  @{
    Name = "connector"
    Port = $Ports.connector
    Script = "dev:connector"
    Url = "http://localhost:$($Ports.connector)/health"
    Log = Join-Path $RepoRoot ".local-connector.log"
    Err = Join-Path $RepoRoot ".local-connector.err.log"
  },
  @{
    Name = "web"
    Port = $Ports.web
    Script = "dev:web"
    Url = "http://localhost:$($Ports.web)/inventory"
    Log = Join-Path $RepoRoot ".local-web.log"
    Err = Join-Path $RepoRoot ".local-web.err.log"
  }
)

function Write-Section([string]$Message) {
  Write-Host ""
  Write-Host "== $Message =="
}

function Get-PortOwner([int]$Port) {
  $connection = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $connection) {
    return $null
  }

  return Get-CimInstance Win32_Process -Filter "ProcessId = $($connection.OwningProcess)" -ErrorAction SilentlyContinue
}

function Test-Http([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
    return @{
      Ok = $true
      Status = $response.StatusCode
      Detail = "HTTP $($response.StatusCode)"
    }
  } catch {
    return @{
      Ok = $false
      Status = $null
      Detail = $_.Exception.Message
    }
  }
}

function Stop-ProcessTree([int]$ProcessId) {
  $children = Get-CimInstance Win32_Process -Filter "ParentProcessId = $ProcessId" -ErrorAction SilentlyContinue
  foreach ($child in $children) {
    Stop-ProcessTree -ProcessId $child.ProcessId
  }

  $process = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if ($process) {
    Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Get-CurrentProcessFamilyIds {
  $ids = New-Object System.Collections.Generic.HashSet[int]
  $current = Get-CimInstance Win32_Process -Filter "ProcessId = $PID" -ErrorAction SilentlyContinue

  while ($current) {
    [void]$ids.Add([int]$current.ProcessId)
    if (-not $current.ParentProcessId) {
      break
    }

    $current = Get-CimInstance Win32_Process -Filter "ProcessId = $($current.ParentProcessId)" -ErrorAction SilentlyContinue
  }

  return $ids
}

function Stop-WorkspaceDevProcesses {
  $currentFamily = Get-CurrentProcessFamilyIds
  $rootPath = $RepoRoot.Path
  $candidates = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object {
      if (-not $_.CommandLine) {
        return $false
      }

      if ($currentFamily.Contains([int]$_.ProcessId)) {
        return $false
      }

      $commandLine = $_.CommandLine
      $isWorkspaceProcess = $commandLine.Contains($rootPath) -or $commandLine.Contains("MOLLIE_LOCAL_COMPONENT=")
      $isDevProcess =
        $commandLine.Contains("pnpm.cmd dev:") -or
        $commandLine.Contains("tsx\dist\cli.mjs") -or
        $commandLine.Contains("tsx/dist/cli.mjs") -or
        ($commandLine.Contains("next") -and $commandLine.Contains("dev"))

      return $isWorkspaceProcess -and $isDevProcess
    }

  foreach ($process in $candidates) {
    Stop-ProcessTree -ProcessId $process.ProcessId
  }
}

function Wait-ForPortsToClose([int[]]$PortsToCheck, [int]$TimeoutSeconds = 10) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)

  while ((Get-Date) -lt $deadline) {
    $openPorts = @($PortsToCheck | Where-Object { Get-PortOwner -Port $_ })
    if ($openPorts.Count -eq 0) {
      return
    }

    Start-Sleep -Milliseconds 300
  }
}

function Read-State {
  if (-not (Test-Path $StatePath)) {
    return @{}
  }

  try {
    return (Get-Content $StatePath -Raw | ConvertFrom-Json -AsHashtable)
  } catch {
    return @{}
  }
}

function Write-State([hashtable]$State) {
  $State | ConvertTo-Json -Depth 6 | Set-Content -Path $StatePath -Encoding UTF8
}

function Stop-Component([hashtable]$Component) {
  $name = $Component.Name
  $state = Read-State
  $knownPid = $null

  if ($state.ContainsKey($name)) {
    $knownPid = [int]$state[$name].Pid
  }

  if ($knownPid) {
    Stop-ProcessTree -ProcessId $knownPid
  }

  $markerProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine.Contains("MOLLIE_LOCAL_COMPONENT='$name'") }

  foreach ($process in $markerProcesses) {
    Stop-ProcessTree -ProcessId $process.ProcessId
  }

  $owner = Get-PortOwner -Port $Component.Port
  if ($owner -and $owner.CommandLine -and $owner.CommandLine.Contains($RepoRoot.Path)) {
    Stop-ProcessTree -ProcessId $owner.ProcessId
  } elseif ($owner) {
    Write-Warning "$name port $($Component.Port) is owned by PID $($owner.ProcessId), but it does not look like this workspace. Leaving it running."
  }
}

function Start-Component([hashtable]$Component) {
  $owner = Get-PortOwner -Port $Component.Port
  if ($owner) {
    Write-Host "$($Component.Name) already has a listener on port $($Component.Port) (PID $($owner.ProcessId))."
    return $owner.ProcessId
  }

  if (Test-Path $Component.Log) {
    Clear-Content -Path $Component.Log -ErrorAction SilentlyContinue
  }
  if (Test-Path $Component.Err) {
    Clear-Content -Path $Component.Err -ErrorAction SilentlyContinue
  }

  $componentName = $Component.Name
  $port = $Component.Port
  $script = $Component.Script
  $command = @"
`$ErrorActionPreference = 'Stop'
`$env:MOLLIE_LOCAL_COMPONENT='$componentName'
`$env:PORT='$port'
Set-Location '$($RepoRoot.Path)'
. '$PSScriptRoot/local-env.ps1'
Use-LocalRuntimeEnv '.env' | Out-Null
`$env:PORT='$port'
pnpm.cmd $script
"@

  $process = Start-Process -FilePath "powershell.exe" `
    -ArgumentList @("-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", $command) `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $Component.Log `
    -RedirectStandardError $Component.Err `
    -WindowStyle Hidden `
    -PassThru

  return $process.Id
}

function Start-Local {
  Write-Section "Preparing local runtime"

  if (-not $SkipInfra) {
    docker compose --env-file .env up -d
  }

  if (-not $SkipInstall) {
    pnpm.cmd install
  }

  if (-not $SkipGenerate) {
    pnpm.cmd --filter @reselleros/db db:generate
  }

  if ($Migrate) {
    pnpm.cmd db:migrate
  }

  if ($Seed) {
    pnpm.cmd db:seed
  }

  if ($NoApps) {
    Show-Status
    return
  }

  Write-Section "Starting app processes"
  $state = @{}

  foreach ($component in $Components) {
    $componentPid = Start-Component -Component $component
    $state[$component.Name] = @{
      Pid = $componentPid
      Port = $component.Port
      StartedAt = (Get-Date).ToString("o")
      Log = $component.Log
      Err = $component.Err
    }
    Write-Host "$($component.Name) -> port $($component.Port), pid $componentPid"
  }

  Write-State -State $state
  Start-Sleep -Seconds 3
  Show-Status
}

function Stop-Local {
  Write-Section "Stopping app processes"
  foreach ($component in $Components) {
    Stop-Component -Component $component
    Write-Host "$($component.Name) stopped or skipped."
  }

  Stop-WorkspaceDevProcesses
  Wait-ForPortsToClose -PortsToCheck @($Ports.api, $Ports.worker, $Ports.connector, $Ports.web)

  if (Test-Path $StatePath) {
    Remove-Item -LiteralPath $StatePath -Force
  }

  if (-not $SkipInfra) {
    Write-Section "Stopping Docker services"
    docker compose --env-file .env stop
  }
}

function Show-Status {
  Write-Section "Docker"
  if ($SkipInfra) {
    Write-Host "Docker status skipped."
  } else {
    docker compose --env-file .env ps
  }

  Write-Section "Apps"
  foreach ($component in $Components) {
    $owner = Get-PortOwner -Port $component.Port
    $health = Test-Http -Url $component.Url
    $pidText = if ($owner) { "pid $($owner.ProcessId)" } else { "no listener" }
    $healthText = if ($health.Ok) { $health.Detail } else { "not ready: $($health.Detail)" }
    Write-Host ("{0,-10} port {1,-5} {2,-18} {3}" -f $component.Name, $component.Port, $pidText, $healthText)
  }

  Write-Host ""
  Write-Host "Web:       http://localhost:$($Ports.web)/inventory"
  Write-Host "API:       http://localhost:$($Ports.api)"
  Write-Host "Worker:    http://localhost:$($Ports.worker)/health"
  Write-Host "Connector: http://localhost:$($Ports.connector)/health"
  Write-Host "Grid:      $($Runtime.BrowserGridUrl)"
}

function Show-Logs {
  foreach ($component in $Components) {
    Write-Section "$($component.Name) stdout"
    if (Test-Path $component.Log) {
      Get-Content $component.Log -Tail 80
    } else {
      Write-Host "No log at $($component.Log)"
    }

    Write-Section "$($component.Name) stderr"
    if (Test-Path $component.Err) {
      Get-Content $component.Err -Tail 80
    } else {
      Write-Host "No log at $($component.Err)"
    }
  }
}

switch ($Command) {
  "start" {
    Start-Local
  }
  "stop" {
    Stop-Local
  }
  "restart" {
    Stop-Local
    Start-Local
  }
  "status" {
    Show-Status
  }
  "logs" {
    Show-Logs
  }
}

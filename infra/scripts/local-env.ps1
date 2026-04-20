function Import-EnvFile([string]$PathValue) {
  Get-Content $PathValue |
    ForEach-Object { $_.Trim() } |
    Where-Object { $_ -and -not $_.StartsWith("#") } |
    ForEach-Object {
      $parts = $_ -split "=", 2
      if ($parts.Length -eq 2) {
        Set-Item -Path "Env:$($parts[0])" -Value $parts[1]
      }
    }
}

function Set-DefaultEnvValue([string]$Name, [string]$Value) {
  if ([string]::IsNullOrWhiteSpace((Get-Item -Path "Env:$Name" -ErrorAction SilentlyContinue).Value)) {
    Set-Item -Path "Env:$Name" -Value $Value
  }
}

function Use-LocalRuntimeEnv([string]$PathValue = ".env") {
  if (-not (Test-Path $PathValue)) {
    Copy-Item .env.example $PathValue
  }

  Import-EnvFile $PathValue

  $postgresUser = if ($env:POSTGRES_USER) { $env:POSTGRES_USER } else { "postgres" }
  $postgresPassword = if ($env:POSTGRES_PASSWORD) { $env:POSTGRES_PASSWORD } else { "postgres" }
  $postgresDatabase = if ($env:POSTGRES_DB) { $env:POSTGRES_DB } else { "reselleros" }
  $postgresHostPort = if ($env:POSTGRES_HOST_PORT) { $env:POSTGRES_HOST_PORT } else { "5432" }
  $redisHostPort = if ($env:REDIS_HOST_PORT) { $env:REDIS_HOST_PORT } else { "6379" }
  $browserGridHostPort = if ($env:BROWSER_GRID_HOST_PORT) { $env:BROWSER_GRID_HOST_PORT } else { "3100" }
  $derivedDatabaseUrl = "postgresql://$postgresUser`:$postgresPassword@localhost:$postgresHostPort/$postgresDatabase"
  $derivedRedisUrl = "redis://localhost:$redisHostPort"
  $derivedBrowserGridUrl = "ws://localhost:$browserGridHostPort/"

  Set-DefaultEnvValue "DATABASE_URL" $derivedDatabaseUrl
  Set-DefaultEnvValue "DIRECT_URL" $derivedDatabaseUrl
  Set-DefaultEnvValue "REDIS_URL" $derivedRedisUrl
  Set-DefaultEnvValue "BROWSER_GRID_URL" $derivedBrowserGridUrl

  return @{
    PostgresHostPort = $postgresHostPort
    RedisHostPort = $redisHostPort
    BrowserGridHostPort = $browserGridHostPort
    DatabaseUrl = $env:DATABASE_URL
    DirectUrl = $env:DIRECT_URL
    RedisUrl = $env:REDIS_URL
    BrowserGridUrl = $env:BROWSER_GRID_URL
  }
}

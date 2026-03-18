param(
  [string]$BaseUrl = "http://172.20.13.1:8080/v1",
  [string]$ApiKey = "pwd",
  [string]$Model = "qwen_3_5_ksg_gmzz",
  [switch]$SkipChat,
  [int]$TimeoutSeconds = 60
)

$ErrorActionPreference = "Stop"

function Fail([string]$Message) {
  Write-Host "[verify-8080] FAIL: $Message" -ForegroundColor Red
  exit 1
}

function Step([string]$Message) {
  Write-Host "[verify-8080] $Message" -ForegroundColor Cyan
}

function Pass([string]$Message) {
  Write-Host "[verify-8080] PASS: $Message" -ForegroundColor Green
}

function Read-StreamAsUtf8 {
  param(
    [Parameter(Mandatory = $true)]
    [System.IO.Stream]$Stream
  )

  $buffer = New-Object System.IO.MemoryStream
  try {
    if ($Stream.CanSeek) {
      $Stream.Position = 0
    }
    $Stream.CopyTo($buffer)
    return [System.Text.Encoding]::UTF8.GetString($buffer.ToArray())
  } finally {
    $buffer.Dispose()
  }
}

function Assert-ChatResponse {
  param(
    [object]$Response,
    [string]$ExpectedModel,
    [string]$ScenarioName,
    [int]$MinLength = 1
  )

  if ($null -eq $Response.choices -or $Response.choices.Count -lt 1) {
    Fail "${ScenarioName}: Chat response did not contain any choices."
  }

  $text = [string]$Response.choices[0].message.content
  if ([string]::IsNullOrWhiteSpace($text)) {
    Fail "${ScenarioName}: Chat response content was empty."
  }

  if ($text.Trim().Length -lt $MinLength) {
    Fail "${ScenarioName}: Chat response was shorter than expected."
  }

  if ($Response.model -ne $ExpectedModel) {
    Fail "${ScenarioName}: Expected outward response model '$ExpectedModel', got '$($Response.model)'"
  }

  return $text
}

function Invoke-JsonRequest {
  param(
    [ValidateSet("GET", "POST")]
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers,
    [object]$Body = $null
  )

  $params = @{
    Method = $Method
    Uri = $Url
    Headers = $Headers
    TimeoutSec = $TimeoutSeconds
    UseBasicParsing = $true
  }

  if ($null -ne $Body) {
    $params.ContentType = "application/json"
    $params.Body = ($Body | ConvertTo-Json -Depth 20)
  }

  try {
    $response = Invoke-WebRequest @params
    $content = if ($response.RawContentStream) {
      Read-StreamAsUtf8 -Stream $response.RawContentStream
    } else {
      [string]$response.Content
    }

    if ([string]::IsNullOrWhiteSpace($content)) {
      return $null
    }

    return $content | ConvertFrom-Json
  } catch {
    $response = $_.Exception.Response
    if ($null -ne $response) {
      $responseBody = Read-StreamAsUtf8 -Stream $response.GetResponseStream()
      $statusCode = [int]$response.StatusCode
      throw "HTTP $statusCode from $Url`n$responseBody"
    }
    throw
  }
}

Step "Checking model list at $BaseUrl/models"

$models = Invoke-JsonRequest -Method GET -Url "$BaseUrl/models" -Headers @{}

if ($null -eq $models.data) {
  Fail "Response from /models did not contain a data array."
}

$modelIds = @($models.data | ForEach-Object { $_.id })
if ($modelIds.Count -ne 1) {
  Fail "Expected exactly 1 public model, got $($modelIds.Count): $($modelIds -join ', ')"
}

if ($modelIds[0] -ne $Model) {
  Fail "Expected public model '$Model', got '$($modelIds[0])'"
}

Pass "Public model exposure is correct: $Model"

if ($SkipChat) {
  Pass "SkipChat set, stopping after model validation"
  exit 0
}

$serviceRoot = if ($BaseUrl.EndsWith("/v1")) {
  $BaseUrl.Substring(0, $BaseUrl.Length - 3)
} else {
  $BaseUrl
}

Step "Checking auth status at $serviceRoot/auth/status"

$authStatus = Invoke-JsonRequest -Method GET -Url "$serviceRoot/auth/status" -Headers @{}

if (-not $authStatus.authenticated) {
  Fail "Server is up, but no Codex account is logged in. Open http://localhost:8080 and complete login first."
}

if ($authStatus.proxy_api_key -and $ApiKey -eq "pwd" -and $authStatus.proxy_api_key -ne $ApiKey) {
  $ApiKey = [string]$authStatus.proxy_api_key
  Step "Using active proxy API key returned by /auth/status"
}

Pass "Proxy auth status is healthy"

$headers = @{
  Authorization = "Bearer $ApiKey"
}

$requestBody = @{
  model = $Model
  stream = $false
  messages = @(
    @{
      role = "user"
      content = "Reply with exactly: VERIFY_OK"
    }
  )
}

Step "Checking end-to-end chat completion with model $Model"

try {
  $chat = Invoke-JsonRequest -Method POST -Url "$BaseUrl/chat/completions" -Headers $headers -Body $requestBody
} catch {
  $message = $_.Exception.Message
  if ($message -match "Invalid proxy API key") {
    Fail "Proxy API key was rejected. Current script default is 'pwd'; pass -ApiKey with the active key if you changed it."
  }
  if ($message -match "401") {
    Fail "Chat endpoint returned 401. Confirm the account is still logged in and the active proxy API key matches /auth/status."
  }
  Fail $message
}

$assistantText = Assert-ChatResponse -Response $chat -ExpectedModel $Model -ScenarioName "Deterministic reply"

Pass "Chat completion succeeded and outward model stayed at $Model"
Write-Host "[verify-8080] Assistant reply: $assistantText"

$suffixBody = @{
  model = "$Model-high"
  stream = $false
  messages = @(
    @{
      role = "user"
      content = "Reply with exactly: SUFFIX_OK"
    }
  )
}

Step "Checking suffix parsing with model $Model-high"

$suffixChat = Invoke-JsonRequest -Method POST -Url "$BaseUrl/chat/completions" -Headers $headers -Body $suffixBody

$suffixText = Assert-ChatResponse -Response $suffixChat -ExpectedModel $Model -ScenarioName "Suffix parsing"

Pass "Suffix parsing succeeded and outward model stayed at $Model"
Write-Host "[verify-8080] Assistant suffix reply: $suffixText"

$weatherBody = @{
  model = $Model
  stream = $false
  messages = @(
    @{
      role = "system"
      content = "你是一个简洁的中文助手。如果你没有实时天气能力，要明确说明，并给出一般性的穿衣建议。"
    },
    @{
      role = "user"
      content = "今天杭州天气怎样？需要穿什么衣服"
    }
  )
}

Step "Checking general OpenAI chat request with a natural Chinese prompt"

$weatherChat = Invoke-JsonRequest -Method POST -Url "$BaseUrl/chat/completions" -Headers $headers -Body $weatherBody
$weatherText = Assert-ChatResponse -Response $weatherChat -ExpectedModel $Model -ScenarioName "Natural language prompt" -MinLength 12

Pass "Natural language chat request returned a normal answer"
Write-Host "[verify-8080] Natural chat reply: $weatherText"
Write-Host "[verify-8080] Note: This checks dialogue availability only, not live weather accuracy."

$dialogueBody = @{
  model = $Model
  stream = $false
  messages = @(
    @{
      role = "user"
      content = "我在杭州。"
    },
    @{
      role = "assistant"
      content = "好的，我知道你在杭州。"
    },
    @{
      role = "user"
      content = "那今天出门大概适合穿什么衣服？请用两句话回答。"
    }
  )
}

Step "Checking multi-turn OpenAI dialogue with message history"

$dialogueChat = Invoke-JsonRequest -Method POST -Url "$BaseUrl/chat/completions" -Headers $headers -Body $dialogueBody
$dialogueText = Assert-ChatResponse -Response $dialogueChat -ExpectedModel $Model -ScenarioName "Multi-turn dialogue" -MinLength 8

Pass "Multi-turn message-history dialogue returned a normal answer"
Write-Host "[verify-8080] Multi-turn reply: $dialogueText"
Pass "All verification steps passed"
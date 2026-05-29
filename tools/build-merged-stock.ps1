param(
  [string]$MasterPath = "E:\Download\도서관리_260528.csv",
  [string]$StockPath = "E:\Download\재고현황_260528.csv",
  [string]$OutPath = ".\merged-stock.csv",
  [int]$RiskThreshold = 50
)

function Clean-Cell($Value) {
  if ($null -eq $Value) { return "" }
  return (([string]$Value) -replace [string]([char]0xFEFF), "").Trim()
}

function Normalize-Title($Title) {
  return (Clean-Cell $Title) -replace '\s*\(([A-Za-z][0-9]{3})\)\s*$', '' -replace '\s+', ' '
}

function Get-Number($Value) {
  $text = (Clean-Cell $Value).Replace(",", "")
  $number = 0
  if ([int]::TryParse($text, [ref]$number)) { return $number }
  return 0
}

function Get-Location($Title) {
  $text = Clean-Cell $Title
  if ($text -match '\(([A-Za-z])([0-9])([0-9])([0-9])\)\s*$') {
    $building = $Matches[1].ToUpper()
    $line = $Matches[2]
    $position = $Matches[3]
    $floor = $Matches[4]
    return @{
      Code = "$building$line$position$floor"
      Text = "${building}동 ${line}번 라인, 앞에서 ${position}번째, ${floor}층"
    }
  }
  return @{
    Code = ""
    Text = "위치 정보가 없습니다."
  }
}

function Get-StockClass($HasStock, $WarehouseStock, $Threshold) {
  if (-not $HasStock) { return "" }
  if ($WarehouseStock -eq 0) { return "0재고" }
  if ($WarehouseStock -gt 0 -and $WarehouseStock -le $Threshold) { return "위험" }
  return ""
}

$master = Get-Content -LiteralPath $MasterPath -Raw -Encoding Default | ConvertFrom-Csv

$stockLines = Get-Content -LiteralPath $StockPath -Encoding Default
$stock = ($stockLines | Select-Object -Skip 1) -join "`r`n" | ConvertFrom-Csv

$stockMap = @{}
foreach ($row in $stock) {
  $key = Normalize-Title $row.도서명
  if ($key) { $stockMap[$key] = $row }
}

$merged = New-Object System.Collections.Generic.List[object]
$stoppedCount = 0

foreach ($book in $master) {
  $bookTitle = Clean-Cell $book.도서명
  $key = Normalize-Title $bookTitle
  $stockRow = $stockMap[$key]
  $hasStock = $null -ne $stockRow
  $status = if ($hasStock) { Clean-Cell $stockRow.거래상태 } else { Clean-Cell $book.거래중지 }

  if ($status -like "*중지*") {
    $stoppedCount += 1
    continue
  }

  $location = Get-Location $bookTitle
  $warehouseStock = if ($hasStock) { Get-Number $stockRow.창고재고 } else { "" }
  $stockClass = if ($hasStock) { Get-StockClass $true $warehouseStock $RiskThreshold } else { "" }

  $merged.Add([pscustomobject]@{
    "ISBN" = ((Clean-Cell $book.ISBN) -replace '[^0-9Xx]', '')
    "도서명" = $key
    "원도서명" = $bookTitle
    "출판사" = if (Clean-Cell $book.출판사) { Clean-Cell $book.출판사 } elseif ($hasStock) { Clean-Cell $stockRow.출판사명 } else { "" }
    "정가" = if (Clean-Cell $book.정가) { Clean-Cell $book.정가 } elseif ($hasStock) { Clean-Cell $stockRow.정가 } else { "" }
    "위치코드" = $location.Code
    "위치설명" = $location.Text
    "정품" = if ($hasStock) { Get-Number $stockRow.정품 } else { "" }
    "반품" = if ($hasStock) { Get-Number $stockRow.반품 } else { "" }
    "창고재고" = $warehouseStock
    "재고구분" = $stockClass
    "위험재고" = if ($stockClass -eq "위험") { "위험" } else { "" }
    "거래상태" = $status
    "재고매칭" = if ($hasStock) { "일치" } else { "재고없음" }
  })
}

$merged | Export-Csv -LiteralPath $OutPath -NoTypeInformation -Encoding UTF8
Write-Output "merged=$($merged.Count); stopped=$stoppedCount; out=$OutPath"

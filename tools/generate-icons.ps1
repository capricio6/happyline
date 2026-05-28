param(
  [string]$OutDir = "assets"
)

Add-Type -AssemblyName System.Drawing

if (!(Test-Path -LiteralPath $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

function New-IconPng {
  param(
    [int]$Size,
    [string]$Path
  )

  $bmp = New-Object System.Drawing.Bitmap $Size, $Size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.Clear([System.Drawing.Color]::Transparent)

  $scale = $Size / 512.0
  $round = 112 * $scale
  $rect = New-Object System.Drawing.RectangleF 0, 0, $Size, $Size
  $pathBg = New-Object System.Drawing.Drawing2D.GraphicsPath
  $diam = $round * 2
  $pathBg.AddArc($rect.X, $rect.Y, $diam, $diam, 180, 90)
  $pathBg.AddArc($rect.Right - $diam, $rect.Y, $diam, $diam, 270, 90)
  $pathBg.AddArc($rect.Right - $diam, $rect.Bottom - $diam, $diam, $diam, 0, 90)
  $pathBg.AddArc($rect.X, $rect.Bottom - $diam, $diam, $diam, 90, 90)
  $pathBg.CloseFigure()

  $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $rect, ([System.Drawing.Color]::FromArgb(31,138,168)), ([System.Drawing.Color]::FromArgb(15,63,86)), 45
  $g.FillPath($bgBrush, $pathBg)

  $book = New-Object System.Drawing.RectangleF (118*$scale), (85*$scale), (276*$scale), (304*$scale)
  $bookBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush $book, ([System.Drawing.Color]::White), ([System.Drawing.Color]::FromArgb(220,234,240)), 70
  $g.FillRectangle($bookBrush, $book)
  $g.FillRectangle((New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(240,93,79))), (72*$scale), (112*$scale), (62*$scale), (280*$scale))

  $linePen = New-Object System.Drawing.Pen ([System.Drawing.Color]::FromArgb(154,180,192)), (18*$scale)
  $linePen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $linePen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  $g.DrawLine($linePen, (170*$scale), (126*$scale), (342*$scale), (126*$scale))
  $g.DrawLine($linePen, (170*$scale), (166*$scale), (342*$scale), (166*$scale))
  $g.DrawLine($linePen, (170*$scale), (206*$scale), (288*$scale), (206*$scale))

  $pinBrush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(245,184,75))
  $g.FillEllipse($pinBrush, (200*$scale), (228*$scale), (144*$scale), (144*$scale))

  $dark = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(18,56,74))
  $center = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::White)
  $g.FillEllipse($dark, (214*$scale), (242*$scale), (116*$scale), (116*$scale))
  $g.FillEllipse($center, (245*$scale), (273*$scale), (54*$scale), (54*$scale))
  $g.FillPolygon($dark, @(
    (New-Object System.Drawing.PointF (236*$scale), (344*$scale)),
    (New-Object System.Drawing.PointF (308*$scale), (344*$scale)),
    (New-Object System.Drawing.PointF (272*$scale), (394*$scale))
  ))

  $bmp.Save($Path, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose()
  $bmp.Dispose()
}

New-IconPng -Size 180 -Path (Join-Path $OutDir "icon-180.png")
New-IconPng -Size 192 -Path (Join-Path $OutDir "icon-192.png")
New-IconPng -Size 512 -Path (Join-Path $OutDir "icon-512.png")

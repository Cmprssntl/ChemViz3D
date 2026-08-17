# ChemViz3D - Lightweight HTTP Server
# Double-click start.bat to launch

$port = 8080
$root = Join-Path $PSScriptRoot "dist"

$mime = @{
    ".html" = "text/html"
    ".js"   = "application/javascript"
    ".css"  = "text/css"
    ".wasm" = "application/wasm"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

$inUse = $false
try {
    $tester = New-Object System.Net.Sockets.TcpClient
    $tester.Connect("127.0.0.1", $port)
    $tester.Close()
    $inUse = $true
} catch {}

if ($inUse) {
    Write-Host ""
    Write-Host "[WARNING] Port $port is already in use!"
    Write-Host "Please close the other program or change the port."
    Write-Host ""
    Start-Sleep 3
    exit 1
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "  +--------------------------------------------+"
Write-Host "  |        ChemViz3D - Ready to use!           |"
Write-Host "  |                                            |"
Write-Host "  |  URL: http://localhost:$port                   |"
Write-Host "  |  Press Ctrl+C to stop the server           |"
Write-Host "  +--------------------------------------------+"
Write-Host ""

Start-Process "http://localhost:$port"

try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $req = $context.Request
        $res = $context.Response

        $path = $req.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($path)) { $path = "index.html" }

        $filePath = Join-Path $root $path
        if (-not (Test-Path $filePath -PathType Leaf)) {
            $filePath = Join-Path $root "index.html"
        }

        try {
            $content = [System.IO.File]::ReadAllBytes((Resolve-Path $filePath))
            $ext = [System.IO.Path]::GetExtension($filePath)
            if ($mime.ContainsKey($ext)) {
                $res.ContentType = $mime[$ext]
            } else {
                $res.ContentType = "application/octet-stream"
            }
            $res.ContentLength64 = $content.Length
            $res.OutputStream.Write($content, 0, $content.Length)
        } catch {
            $res.StatusCode = 404
        }

        $res.Close()
    }
} finally {
    if ($listener.IsListening) { $listener.Stop() }
}

Write-Host "Server stopped."
Start-Sleep 2

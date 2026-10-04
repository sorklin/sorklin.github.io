# serve.ps1 -- local preview server for www.sorklin.com. Windows PowerShell 5.1 or newer.
#
# This file is DEV TOOLING. It never runs on GitHub Pages and nothing on this site
# depends on it. Pages serves the committed files as-is; this exists only so your
# browser can answer root-absolute URLs (/assets/css/site.css) the same way the
# production domain does. Double-clicking index.html cannot do that: on file:// a
# path starting with / resolves to your drive root (C:\assets\...) and the page
# renders unstyled.
#
# OTHER DEVICES: by default this binds EVERY interface, so a phone or another PC on
# the same network can open the site (and play Rolling Thunder) at
# http://<this-pc-ip>:<port>/ -- the exact URLs are printed at startup. Windows
# (http.sys) lets a standard account bind "localhost" and nothing else, so if the
# all-interfaces bind is refused the server falls back to localhost-only and prints
# the one-line `netsh` command that unlocks it (run once, as Administrator). If
# devices still cannot connect, it is the Windows Firewall prompt: allow the port.
# serve.mjs (Node) never needs admin for this. -LocalOnly restores the old behaviour.
#
# Usage (from this folder, in PowerShell):
#   powershell -ExecutionPolicy Bypass -File .\serve.ps1
#   .\serve.ps1 -Port 9000
#   .\serve.ps1 -LocalOnly                       # localhost only (old behaviour)
#   .\serve.ps1 -Assets D:\work\rthunder\app     # serve a Rolling Thunder build from elsewhere
#
# Or double-click serve.cmd, which does the -ExecutionPolicy Bypass dance for you.

[CmdletBinding()]
param(
    [int]    $Port      = 8080,
    [string] $Assets    = '',      # folder containing wasm/ roms/ boot-probe.txt
    [switch] $NoOpen,             # do not launch a browser
    [switch] $LocalOnly           # bind localhost only, even if the LAN bind would work
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------------ roots --
$Root = $PSScriptRoot
if (-not $Root) { $Root = (Get-Location).Path }
$Root = [System.IO.Path]::GetFullPath($Root).TrimEnd('\')

# The play page probes ./assets/boot-probe.txt at boot. The build now ships in the
# repo (projects/rthunder/play/assets/), so this mount is only needed to preview a
# DIFFERENT build without staging it: pointing -Assets at an app folder overrides
# /projects/rthunder/play/assets/* with that folder's contents.
$AssetsRoot = $null
if ($Assets) {
    if (-not (Test-Path -LiteralPath $Assets -PathType Container)) {
        Write-Warning "-Assets '$Assets' is not a folder; the game will use the committed assets instead."
    } else {
        $AssetsRoot = [System.IO.Path]::GetFullPath($Assets).TrimEnd('\')
    }
}
$MountPrefix = '/projects/rthunder/play/assets/'

# ------------------------------------------------------------------ mime --
# application/wasm is a main reason this file exists. Python's http.server does
# not send it, and the emulator will not start without it.
$Mime = @{
    '.html'  = 'text/html; charset=utf-8'
    '.css'   = 'text/css; charset=utf-8'
    '.js'    = 'text/javascript; charset=utf-8'
    '.mjs'   = 'text/javascript; charset=utf-8'
    '.json'  = 'application/json; charset=utf-8'
    '.md'    = 'text/plain; charset=utf-8'
    '.txt'   = 'text/plain; charset=utf-8'
    '.svg'   = 'image/svg+xml'
    '.png'   = 'image/png'
    '.jpg'   = 'image/jpeg'
    '.jpeg'  = 'image/jpeg'
    '.gif'   = 'image/gif'
    '.webp'  = 'image/webp'
    '.ico'   = 'image/x-icon'
    '.woff'  = 'font/woff'
    '.woff2' = 'font/woff2'
    '.wasm'  = 'application/wasm'
    '.zip'   = 'application/zip'
    '.bdf'   = 'application/octet-stream'
    '.map'   = 'application/json'
    '.xml'   = 'application/xml'
}

function Get-MimeFor([string]$Path) {
    $ext = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($Mime.ContainsKey($ext)) { return $Mime[$ext] }
    return 'application/octet-stream'
}

# Is $File inside $Dir? Both sides get a trailing separator first: GetFullPath may
# or may not keep one, and "D:\site" must not be treated as inside "D:\site-evil".
function Test-Under([string]$Dir, [string]$File) {
    $sep = [System.IO.Path]::DirectorySeparatorChar
    return ($File + $sep).StartsWith($Dir + $sep, [System.StringComparison]::OrdinalIgnoreCase)
}

function Write-Text([System.Net.HttpListenerContext]$Ctx, [int]$Status, [string]$Body, [string]$Type) {
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($Body)
    $Ctx.Response.StatusCode      = $Status
    $Ctx.Response.ContentType     = $Type
    $Ctx.Response.ContentLength64 = $bytes.Length
    $Ctx.Response.SendChunked     = $false
    $Ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
}

function Send-File([System.Net.HttpListenerContext]$Ctx, [string]$FullPath, [bool]$IsMount, [int]$Status) {
    if ($Status -le 0) { $Status = 200 }
    $ext = [System.IO.Path]::GetExtension($FullPath).ToLowerInvariant()
    $fs  = [System.IO.File]::OpenRead($FullPath)
    try {
        $Ctx.Response.StatusCode      = $Status
        $Ctx.Response.ContentType     = Get-MimeFor $FullPath
        $Ctx.Response.ContentLength64 = $fs.Length
        $Ctx.Response.SendChunked     = $false
        if ($ext -eq '.html') {
            # never cache pages, or your own edits look like they did not take
            $Ctx.Response.Headers.Add('Cache-Control', 'no-store')
        } else {
            $Ctx.Response.Headers.Add('Cache-Control', 'public, max-age=300')
        }
        if ($IsMount) {
            # mirrors what a real CDN or Worker must send for the remote build
            $Ctx.Response.Headers.Add('Access-Control-Allow-Origin', '*')
        }
        $fs.CopyTo($Ctx.Response.OutputStream)
    } finally {
        $fs.Dispose()
    }
}

# --------------------------------------------------------------- listening --
# Default: bind every interface so phones and other machines can reach the site.
# Windows (http.sys) refuses a non-localhost bind for standard accounts -- "localhost"
# is the one prefix such an account may always bind -- so fall back to it and say
# exactly how to unlock the LAN bind.

function Start-Listener([string[]]$Prefixes) {
    $l = New-Object System.Net.HttpListener
    foreach ($p in $Prefixes) { [void]$l.Prefixes.Add($p) }
    $l.Start()
    return $l
}

function Get-LanIPv4 {
    $ips = @()
    try {
        Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop | ForEach-Object {
            $ip = $_.IPAddress
            if ($ip -ne '127.0.0.1' -and $ip -notlike '169.254.*') { $ips += $ip }
        }
    } catch {
        try {
            [System.Net.Dns]::GetHostAddresses($env:COMPUTERNAME) | ForEach-Object {
                $ip = $_.ToString()
                if ($_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and $ip -ne '127.0.0.1') { $ips += $ip }
            }
        } catch { }
    }
    return @($ips | Select-Object -Unique)
}

$Listener = $null
$BoundAll = $false
if (-not $LocalOnly) {
    try { $Listener = Start-Listener @("http://+:$Port/"); $BoundAll = $true } catch { }
}
if (-not $Listener) {
    try {
        $Listener = Start-Listener @("http://localhost:$Port/")
    } catch {
        Write-Host ''
        Write-Warning "Could not listen on port $Port."
        Write-Host '  Most likely something else is already using it. Try another port:'
        Write-Host "      .\serve.ps1 -Port 9000"
        Write-Host '  If PowerShell itself was refused, the port needs a reservation (run as admin):'
        Write-Host "      netsh http add urlacl url=http://localhost:$Port/ user=$env:USERDOMAIN\$env:USERNAME"
        Write-Host ''
        exit 1
    }
    if (-not $LocalOnly) {
        Write-Host ''
        Write-Warning 'Binding every interface needs admin rights (or a URLACL) - serving localhost only.'
        Write-Host '  Other devices cannot reach this server until ONE of these has been done once:'
        Write-Host ("      netsh http add urlacl url=http://+:$Port/ user=$env:USERDOMAIN\$env:USERNAME")
        Write-Host '      (run as Administrator), or simply use the Node server, which needs neither:'
        Write-Host "      node serve.mjs $Port"
        Write-Host ''
    }
}

$Url = "http://localhost:$Port/"
Write-Host ''
Write-Host '  The Sorklin Group - local preview' -ForegroundColor Cyan
Write-Host "  root     $Root"
if ($AssetsRoot) { Write-Host "  game     $MountPrefix -> $AssetsRoot" -ForegroundColor DarkCyan }
Write-Host "  open     $Url" -ForegroundColor Green
if ($BoundAll) {
    $lan = Get-LanIPv4
    foreach ($ip in $lan) {
        Write-Host ("  open     http://" + $ip + ":$Port/   (other devices on this network)") -ForegroundColor Green
    }
    if ($lan.Count -gt 0) {
        Write-Host '  If another device cannot connect, it is the Windows Firewall: allow this port,'
        Write-Host ("  e.g.  New-NetFirewallRule -DisplayName 'Sorklin site' -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow")
    }
}
Write-Host '  stop     Ctrl-C (or close this window)'
Write-Host ''

if (-not $NoOpen) {
    try { Start-Process $Url } catch { Write-Host "  (open $Url yourself - the browser did not launch)" }
}

try {
    while ($Listener.IsListening) {
        # Wait in slices rather than blocking forever, so Ctrl-C lands promptly.
        $task = $Listener.GetContextAsync()
        while (-not $task.Wait(500)) { }
        $Ctx  = $task.Result

        try {
            $Path = [System.Uri]::UnescapeDataString($Ctx.Request.Url.AbsolutePath)

            # --- the game build mount, if -Assets was given ---
            $IsMount  = $false
            $FullPath = $null
            if ($AssetsRoot -and $Path.StartsWith($MountPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
                $rel      = $Path.Substring($MountPrefix.Length).Replace('/', [System.IO.Path]::DirectorySeparatorChar)
                $FullPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($AssetsRoot, $rel))
                $IsMount  = $true
                if (-not (Test-Under $AssetsRoot $FullPath)) {
                    Write-Text $Ctx 403 'Forbidden' 'text/plain; charset=utf-8'
                    continue
                }
            } else {
                $Rel = $Path.TrimStart('/')
                if ($Rel -match '\.\.' -or $Rel.IndexOf([char]0) -ge 0) {
                    Write-Text $Ctx 400 'Bad request' 'text/plain; charset=utf-8'
                    continue
                }
                $Rel = $Rel.Replace('/', [System.IO.Path]::DirectorySeparatorChar)
                $FullPath = [System.IO.Path]::GetFullPath([System.IO.Path]::Combine($Root, $Rel))
                if (-not (Test-Under $Root $FullPath)) {
                    Write-Text $Ctx 403 'Forbidden' 'text/plain; charset=utf-8'
                    continue
                }
            }

            # directory -> index.html ; extensionless URL -> .html
            if (Test-Path -LiteralPath $FullPath -PathType Container) {
                $FullPath = [System.IO.Path]::Combine($FullPath, 'index.html')
            } elseif (-not [System.IO.Path]::HasExtension($FullPath)) {
                $WithExt = $FullPath + '.html'
                if (Test-Path -LiteralPath $WithExt -PathType Leaf) { $FullPath = $WithExt }
            }

            if (Test-Path -LiteralPath $FullPath -PathType Leaf) {
                Send-File $Ctx $FullPath $IsMount 200
                Write-Host ("  200  " + $Path) -ForegroundColor DarkGreen
            } else {
                $NotFound = [System.IO.Path]::Combine($Root, '404.html')
                if (Test-Path -LiteralPath $NotFound -PathType Leaf) {
                    Send-File $Ctx $NotFound $false 404
                } else {
                    Write-Text $Ctx 404 'Not found' 'text/plain; charset=utf-8'
                }
                Write-Host ("  404  " + $Path) -ForegroundColor DarkYellow
            }
        } catch {
            try { Write-Text $Ctx 500 ('Server error: ' + $_.Exception.Message) 'text/plain; charset=utf-8' } catch { }
            Write-Host ("  500  " + $_.Exception.Message) -ForegroundColor Red
        } finally {
            try { $Ctx.Response.OutputStream.Flush() } catch { }
            $Ctx.Response.Close()
        }
    }
} finally {
    $Listener.Stop()
    $Listener.Close()
    Write-Host '  stopped.'
}

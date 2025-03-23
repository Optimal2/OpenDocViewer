# Set the source folder
$srcPath = "E:\Linus Dunkers\Documents\GitHub\OpenDocViewer\src"

# Recursively get all files and output their full path and content
Get-ChildItem -Path $srcPath -Recurse -File | ForEach-Object {
    $filePath = $_.FullName
    Write-Output "===== FILE: $filePath ====="
    Write-Output "----- CONTENT START -----"
    Get-Content -Path $filePath
    Write-Output "----- CONTENT END -----"
    Write-Output ""  # Blank line for separation
}

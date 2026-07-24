# PDF spooler binary (overlay print path)

Drop **`SumatraPDF.exe`** (the *portable* build, 64-bit or 32-bit — the app is
shipped as 32-bit, and a 32-bit Windows can only run the 32-bit one) into this
folder. Nothing else is needed; the file is picked up automatically.

    vendor/pdfprint/SumatraPDF.exe

Download: <https://www.sumatrapdfreader.org/download-free-pdf-viewer> → the
"portable version" (a single .exe, no installer).

`PDFtoPrinter.exe` is also accepted under the same folder if you prefer it.

## Why this exists

The overlay path prints VALUES ONLY onto pre-printed slips. Handing that page
straight to the Canon LBP6030 driver let the driver "fit to page" and
auto-rotate it — the values came out sideways, shrunken, and partly off the
sheet. Instead the app now renders an exact-size PDF (215.9 × 139.7 mm) and
spools it with scaling explicitly disabled:

    SumatraPDF.exe -print-to "<printer>" -print-settings "noscale,copies=N" -silent -exit-when-done file.pdf

## If the binary is missing

Printing still works: `electron/overlayForm.cjs` falls back to the hardened
`webContents.print` path and writes `overlay-pdf-spool-failed … reason=pdf-spooler-missing`
into `print-log.txt`. That fallback is at the mercy of the driver's own scaling
rules, so the sideways/shrunken print can come back. Check the print log before
concluding the geometry is wrong.

The packaged build copies this folder to `resources/bin/` (see
`build.extraResources` in package.json). `GOLDLAB_PDF_PRINT_EXE=<full path>`
overrides the lookup for testing.

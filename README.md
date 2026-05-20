# Netwrix Data Sizer

A portable utility for Netwrix SEs and partners to scan local drives and network shares, measure data volumes, and generate hardware sizing recommendations for **Netwrix Data Classification (NDC)** deployments.

## Features

- Scan local drives and UNC network shares
- Detect file types, sizes, and OCR candidates (images, PDFs, Office docs)
- Recommend CPU / RAM / Storage tiers based on NDC 5.7 sizing guidelines
- Export results to **PDF** and **Excel** (6-sheet workbook)
- Optional deep OCR analysis (inspects file content, not just extensions)
- Include/exclude hidden files
- Runs entirely offline — no internet connection required

## Sizing Tiers (NDC 5.7)

| Tier | Objects |
|---|---|
| POC / Small | ≤ 1M |
| Mid-Size | ≤ 16M |
| Large | ≤ 32M |
| Large Clustered | ≤ 64M |
| Extra-Large | > 64M |

Storage estimates: **11 KB/object** (SQL DB) + **35% of scanned data size** (index).

---

## Installation

### Option A — Windows Portable EXE (recommended)

No Node.js required.

1. Download `NDC-Sizer.exe` from the [Releases](../../releases) page.
2. Double-click `NDC-Sizer.exe` — the tool starts automatically.
3. Open your browser and navigate to `http://localhost:3737`.

> The EXE is self-contained (~45 MB). No install, no dependencies.

### Option B — Run from Source (macOS / Linux / Windows)

**Requirements:** Node.js 18+

```bash
# Clone the repo
git clone https://github.com/KarimAzzouzi/netwrix-data-sizer.git
cd netwrix-data-sizer

# Install dependencies
npm install

# Start the server
npm start
```

Then open `http://localhost:3737` in your browser.

**Shortcuts:**
- Windows: double-click `start.bat`
- macOS/Linux: run `./start.sh`

---

## Build the EXE (developers only)

Requires Node.js 18 and `pkg` installed globally:

```bash
npm install -g pkg
npx pkg server.js --targets node18-win-x64 --output dist/NDC-Sizer.exe --compress GZip
```

Output: `dist/NDC-Sizer.exe`

---

## Tech Stack

| Component | Library |
|---|---|
| Server | Node.js 18 + Express |
| PDF export | pdf-lib |
| Excel export | exceljs |
| ZIP/DOCX inspection | adm-zip |
| Packaging | pkg |

---

## Usage

1. Launch the tool and open `http://localhost:3737`.
2. Enter one or more paths to scan (local drive or UNC share, e.g. `\\server\share`).
3. Configure options (hidden files, deep OCR analysis).
4. Click **Start Scan**.
5. Review the sizing recommendation and export to PDF or Excel.

---

## Credits

© 2025 Netwrix Corporation  
Developed by **Karim Azzouzi** & **Russell McDermott**

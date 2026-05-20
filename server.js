const express = require('express');
const path = require('path');
const fs = require('fs');
const { execSync, exec, spawn } = require('child_process');
const ExcelJS = require('exceljs');
const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const AdmZip = require('adm-zip');

const app = express();
app.use(express.json({ limit: '50mb' }));

// ── Extension constants ───────────────────────────────────────────────────────

// Always require OCR — pure raster image files
const OCR_EXTENSIONS = new Set([
  '.bmp','.dcm','.gif','.jif','.jpeg','.jpg','.png','.tif','.tiff','.webp'
]);

// May contain embedded images — PDFs (often scanned) and Office/ODF documents
// Conservative assumption: 30% of these will actually need OCR processing
const OCR_POTENTIAL_EXTENSIONS = new Set([
  '.pdf','.doc','.docx','.docm','.odt','.odf',
  '.ppt','.pptx','.pptm','.pps','.ppsx',
  '.xls','.xlsx','.xlsm','.ods','.rtf'
]);
const OCR_POTENTIAL_FACTOR = 0.30; // 30% assumed to contain embedded images

const CATEGORIES = [
  { name: 'Documents',    color: '#3B82F6', exts: new Set(['.doc','.docm','.docx','.dotm','.dotx','.rtf','.wp','.wpd','.odt','.odf','.txt','.pdf','.xps']) },
  { name: 'Spreadsheets', color: '#10B981', exts: new Set(['.xls','.xlsm','.xlsx','.xlsb','.xlam','.xltm','.xltx','.ods','.csv']) },
  { name: 'Presentations',color: '#F59E0B', exts: new Set(['.ppt','.pptm','.pptx','.potm','.potx','.ppam','.pps','.ppsm','.ppsx']) },
  { name: 'Images',       color: '#EC4899', exts: new Set(['.bmp','.dcm','.gif','.jif','.jpeg','.jpg','.png','.psd','.tif','.tiff','.webp']) },
  { name: 'Email',        color: '#8B5CF6', exts: new Set(['.eml','.msg','.mlm']) },
  { name: 'Archives',     color: '#64748B', exts: new Set(['.7z','.rar','.tar','.zip']) },
  { name: 'Media',        color: '#EF4444', exts: new Set(['.aiff','.avi','.flv','.mkv','.mp3','.mp4','.wav']) },
  { name: 'Web/Markup',   color: '#F97316', exts: new Set(['.chm','.htm','.html','.xml']) },
  { name: 'CAD/Design',   color: '#14B8A6', exts: new Set(['.dwg','.vsd']) },
  { name: 'Office Other', color: '#A78BFA', exts: new Set(['.mpp','.pub','.one','.onetoc2','.onepkg']) },
  { name: 'Code/Text',    color: '#0EA5E9', exts: new Set(['.java','.vtl']) }
];

// Build NDC_EXTENSIONS as union of all category exts
const NDC_EXTENSIONS = new Set();
for (const cat of CATEGORIES) {
  for (const ext of cat.exts) NDC_EXTENSIONS.add(ext);
}

// Build reverse map ext -> category
const EXT_TO_CATEGORY = {};
for (const cat of CATEGORIES) {
  for (const ext of cat.exts) {
    if (!EXT_TO_CATEGORY[ext]) EXT_TO_CATEGORY[ext] = cat;
  }
}

// ── Deep OCR content inspection ───────────────────────────────────────────────

// ZIP-based Office formats and where their embedded images live
const ZIP_MEDIA_PATHS = {
  '.docx': 'word/media/', '.docm': 'word/media/', '.dotx': 'word/media/', '.dotm': 'word/media/',
  '.pptx': 'ppt/media/',  '.pptm': 'ppt/media/',  '.ppsx': 'ppt/media/',  '.ppsm': 'ppt/media/',
  '.potx': 'ppt/media/',  '.potm': 'ppt/media/',
  '.xlsx': 'xl/media/',   '.xlsm': 'xl/media/',   '.xltx': 'xl/media/',   '.xltm': 'xl/media/',
  '.odt':  'Pictures/',   '.ods':  'Pictures/',    '.odf':  'Pictures/'
};
const RASTER_EXTS = new Set(['.jpg','.jpeg','.png','.tif','.tiff','.bmp','.gif','.webp','.jif','.dcm']);

// Returns true if file actually needs OCR, false if it is text-based / cannot be determined
function inspectFileForOCR(filePath, ext) {
  try {
    if (ext === '.pdf') {
      // Read up to 256 KB — look for positive image markers (embedded or scanned images)
      const stat = fs.statSync(filePath);
      const readSize = Math.min(262144, stat.size);
      const buf = Buffer.alloc(readSize);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buf, 0, readSize, 0);
      fs.closeSync(fd);
      const chunk = buf.toString('latin1');
      return chunk.includes('/Subtype/Image') ||
             chunk.includes('/Subtype /Image') ||
             chunk.includes('/DCTDecode') ||
             chunk.includes('/CCITTFaxDecode') ||
             chunk.includes('/JBIG2Decode') ||
             chunk.includes('/JPXDecode');
    }

    if (ZIP_MEDIA_PATHS[ext]) {
      // Open as ZIP and check for raster images in the media folder
      const mediaPrefix = ZIP_MEDIA_PATHS[ext].toLowerCase();
      const zip = new AdmZip(filePath);
      for (const entry of zip.getEntries()) {
        const name = entry.entryName.toLowerCase();
        if (name.startsWith(mediaPrefix) && RASTER_EXTS.has(path.extname(name))) {
          return true; // has at least one embedded raster image
        }
      }
      return false;
    }

    if (ext === '.rtf') {
      // Scan full file — \pict can appear anywhere, not just the header
      const stat = fs.statSync(filePath);
      const readSize = Math.min(10 * 1024 * 1024, stat.size); // cap at 10 MB
      const buf = Buffer.alloc(readSize);
      const fd = fs.openSync(filePath, 'r');
      fs.readSync(fd, buf, 0, readSize, 0);
      fs.closeSync(fd);
      return buf.toString('latin1').includes('\\pict');
    }

    // .doc / .xls / .ppt — legacy OLE2 binary format, cannot reliably inspect
    return false;
  } catch {
    return false; // unreadable / corrupt → don't flag
  }
}

// ── Scan helpers ──────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return '0 B';
  const k = 1024, sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(Math.max(bytes, 1)) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function scanDirectory(dirPath, depth, maxDepth, maps, deepScan, includeHidden) {
  if (depth === undefined) depth = 0;
  if (maxDepth === undefined) maxDepth = 5;
  if (deepScan === undefined) deepScan = false;
  if (includeHidden === undefined) includeHidden = false;

  const isRoot = maps === null || maps === undefined;
  if (isRoot) {
    maps = {
      supported: {},
      unsupported: {},
      ocr: {},
      ocrPotential: {},
      categories: {}
    };
    for (const cat of CATEGORIES) {
      maps.categories[cat.name] = { name: cat.name, color: cat.color, count: 0, size: 0 };
    }
  }

  let totalSize = 0, fileCount = 0, ndcSize = 0, ndcCount = 0,
      ocrSize = 0, ocrCount = 0, ocrPotentialSize = 0, ocrPotentialCount = 0;
  let children = [];
  let entries;
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch (err) {
    return {
      name: path.basename(dirPath) || dirPath,
      path: dirPath,
      size: 0, fileCount: 0,
      ndcSize: 0, ndcCount: 0,
      ocrSize: 0, ocrCount: 0,
      children: []
    };
  }

  for (const entry of entries) {
    // Skip hidden files/folders (starting with .) unless explicitly requested
    if (!includeHidden && entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);
    try {
      if (entry.isDirectory()) {
        const sub = scanDirectory(fullPath, depth + 1, maxDepth, maps, deepScan, includeHidden);
        totalSize += sub.size;
        fileCount += sub.fileCount;
        ndcSize   += sub.ndcSize;
        ndcCount  += sub.ndcCount;
        ocrSize   += sub.ocrSize;
        ocrCount  += sub.ocrCount;
        ocrPotentialSize  += sub.ocrPotentialSize;
        ocrPotentialCount += sub.ocrPotentialCount;
        if (depth < maxDepth) children.push(sub);
      } else if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        const sz = stat.size;
        totalSize += sz;
        fileCount++;
        const ext = path.extname(entry.name).toLowerCase();

        if (NDC_EXTENSIONS.has(ext)) {
          ndcSize += sz;
          ndcCount++;

          // supported map
          if (!maps.supported[ext]) {
            const cat = EXT_TO_CATEGORY[ext] || null;
            maps.supported[ext] = { ext, count: 0, size: 0, category: cat ? cat.name : 'Other' };
          }
          maps.supported[ext].count++;
          maps.supported[ext].size += sz;

          // category map
          const cat = EXT_TO_CATEGORY[ext];
          if (cat && maps.categories[cat.name]) {
            maps.categories[cat.name].count++;
            maps.categories[cat.name].size += sz;
          }

          // definite OCR — pure image files
          if (OCR_EXTENSIONS.has(ext)) {
            ocrSize += sz; ocrCount++;
            if (!maps.ocr[ext]) maps.ocr[ext] = { ext, count: 0, size: 0, tier: 'definite' };
            maps.ocr[ext].count++; maps.ocr[ext].size += sz;
          }
          // potential OCR — docs/PDFs that may contain embedded images
          if (OCR_POTENTIAL_EXTENSIONS.has(ext)) {
            if (deepScan) {
              // Open file and inspect content — 100% accurate
              const needsOCR = inspectFileForOCR(fullPath, ext);
              if (needsOCR) {
                // Promote to definite OCR
                ocrSize += sz; ocrCount++;
                if (!maps.ocr[ext]) maps.ocr[ext] = { ext, count: 0, size: 0, tier: 'definite', inspected: true };
                maps.ocr[ext].count++; maps.ocr[ext].size += sz;
              }
              // Files that don't pass inspection are simply text-based — not flagged
            } else {
              // Fast mode: extension-only, 30% assumption
              ocrPotentialSize += sz; ocrPotentialCount++;
              if (!maps.ocrPotential[ext]) maps.ocrPotential[ext] = { ext, count: 0, size: 0, tier: 'potential' };
              maps.ocrPotential[ext].count++; maps.ocrPotential[ext].size += sz;
            }
          }
        } else {
          // unsupported
          const key = ext || '(no extension)';
          if (!maps.unsupported[key]) maps.unsupported[key] = { ext: key, count: 0, size: 0, sample: fullPath };
          maps.unsupported[key].count++;
          maps.unsupported[key].size += sz;
        }
      }
    } catch (e) { /* skip inaccessible */ }
  }

  const node = {
    name: path.basename(dirPath) || dirPath,
    path: dirPath,
    size: totalSize, fileCount,
    ndcSize, ndcCount,
    ocrSize, ocrCount,
    ocrPotentialSize, ocrPotentialCount,
    children: children.sort((a, b) => b.size - a.size).slice(0, 50)
  };

  if (isRoot) {
    node.supported      = Object.values(maps.supported).sort((a, b) => b.count - a.count);
    node.unsupported    = Object.values(maps.unsupported).sort((a, b) => b.count - a.count);
    node.ocr            = Object.values(maps.ocr).sort((a, b) => b.count - a.count);
    node.ocrPotential   = Object.values(maps.ocrPotential).sort((a, b) => b.count - a.count);
    node.categories     = Object.values(maps.categories).filter(c => c.count > 0).sort((a, b) => b.count - a.count);
  }

  return node;
}

function mergeScans(results) {
  if (!results || results.length === 0) return null;
  if (results.length === 1) return results[0];

  const root = {
    name: 'Multiple Paths',
    path: '(multiple)',
    size: 0, fileCount: 0,
    ndcSize: 0, ndcCount: 0,
    ocrSize: 0, ocrCount: 0,
    ocrPotentialSize: 0, ocrPotentialCount: 0,
    children: [],
    supported: {}, unsupported: {}, ocr: {}, ocrPotential: {}, categories: {}
  };

  for (const cat of CATEGORIES) {
    root.categories[cat.name] = { name: cat.name, color: cat.color, count: 0, size: 0 };
  }

  for (const r of results) {
    root.size      += r.size;
    root.fileCount += r.fileCount;
    root.ndcSize   += r.ndcSize;
    root.ndcCount  += r.ndcCount;
    root.ocrSize          += r.ocrSize;
    root.ocrCount         += r.ocrCount;
    root.ocrPotentialSize += r.ocrPotentialSize || 0;
    root.ocrPotentialCount+= r.ocrPotentialCount || 0;
    root.children.push(r);

    for (const s of (r.supported || [])) {
      if (!root.supported[s.ext]) root.supported[s.ext] = { ext: s.ext, count: 0, size: 0, category: s.category };
      root.supported[s.ext].count += s.count; root.supported[s.ext].size += s.size;
    }
    for (const u of (r.unsupported || [])) {
      if (!root.unsupported[u.ext]) root.unsupported[u.ext] = { ext: u.ext, count: 0, size: 0, sample: u.sample };
      root.unsupported[u.ext].count += u.count; root.unsupported[u.ext].size += u.size;
    }
    for (const o of (r.ocr || [])) {
      if (!root.ocr[o.ext]) root.ocr[o.ext] = { ext: o.ext, count: 0, size: 0, tier: 'definite' };
      root.ocr[o.ext].count += o.count; root.ocr[o.ext].size += o.size;
    }
    for (const o of (r.ocrPotential || [])) {
      if (!root.ocrPotential[o.ext]) root.ocrPotential[o.ext] = { ext: o.ext, count: 0, size: 0, tier: 'potential' };
      root.ocrPotential[o.ext].count += o.count; root.ocrPotential[o.ext].size += o.size;
    }
    for (const c of (r.categories || [])) {
      if (root.categories[c.name]) {
        root.categories[c.name].count += c.count; root.categories[c.name].size += c.size;
      }
    }
  }

  root.supported      = Object.values(root.supported).sort((a, b) => b.count - a.count);
  root.unsupported    = Object.values(root.unsupported).sort((a, b) => b.count - a.count);
  root.ocr            = Object.values(root.ocr).sort((a, b) => b.count - a.count);
  root.ocrPotential   = Object.values(root.ocrPotential).sort((a, b) => b.count - a.count);
  root.categories     = Object.values(root.categories).filter(c => c.count > 0).sort((a, b) => b.count - a.count);

  return root;
}

// ── NDC Sizing engine ─────────────────────────────────────────────────────────

function computeNDCSizing(totalBytes, totalFiles, ndcBytes, ndcFiles, ocrCount, ocrPotentialCount) {
  if (!ocrCount) ocrCount = 0;
  if (!ocrPotentialCount) ocrPotentialCount = 0;
  const totalGB = totalBytes / (1024 ** 3);
  const ndcGB   = ndcBytes  / (1024 ** 3);
  const dbSizeGB    = (ndcFiles * 11 * 1024) / (1024 ** 3);
  const indexSizeGB = ndcGB * 0.35;

  // Effective OCR load = definite (images) + 30% of potential (docs with embedded images)
  const ocrEffective = ocrCount + Math.round(ocrPotentialCount * OCR_POTENTIAL_FACTOR);
  const ocrPct = ndcFiles > 0 ? (ocrEffective / ndcFiles) * 100 : 0;
  let ocrAdj = 0, ocrNote = '';
  if (ocrPct < 5) {
    ocrAdj = 0;
    ocrNote = 'OCR workload is minimal (< 5% of NDC files). No additional CPU resources needed.';
  } else if (ocrPct < 20) {
    ocrAdj = 2;
    ocrNote = 'Moderate OCR workload (5-20% of NDC files). 2 additional CPU cores recommended per NDC server.';
  } else if (ocrPct < 50) {
    ocrAdj = 4;
    ocrNote = 'High OCR workload (20-50% of NDC files). 4 additional CPU cores recommended per NDC server.';
  } else {
    ocrAdj = 6;
    ocrNote = 'Very high OCR workload (>= 50% of NDC files). 6 additional CPU cores added. Consider a dedicated OCR server for optimal performance.';
  }

  let tier, ndcServers, baseCores, ndcRAM, sqlRAM, sqlCores, notes;

  if (ndcFiles <= 1000000) {
    tier = 'Proof-of-Concept / Small'; ndcServers = 1; baseCores = 8; ndcRAM = 32; sqlCores = 8; sqlRAM = 32;
    notes = 'SQL Server Express acceptable for evaluation. Single server deployment.';
  } else if (ndcFiles <= 16000000) {
    tier = 'Mid-Size'; ndcServers = 2; baseCores = 8; ndcRAM = 32; sqlCores = 8; sqlRAM = 64;
    notes = 'SQL Server 2016 SP2+ Standard Edition recommended. Consider clustering NDC servers.';
  } else if (ndcFiles <= 32000000) {
    tier = 'Large'; ndcServers = 2; baseCores = 8; ndcRAM = 32; sqlCores = 8; sqlRAM = 64;
    notes = 'Cluster of NDC Servers with DQS mode required. SSD storage mandatory.';
  } else if (ndcFiles <= 64000000) {
    tier = 'Large (Clustered)'; ndcServers = 4; baseCores = 8; ndcRAM = 32; sqlCores = 16; sqlRAM = 128;
    notes = 'Maximum 4 NDC servers in cluster (64M objects). SQL Enterprise edition advised. SSD mandatory.';
  } else {
    tier = 'Extra-Large'; ndcServers = 4; baseCores = 16; ndcRAM = 64; sqlCores = 16; sqlRAM = 256;
    notes = 'Exceeds 64M objects — system architect consultation required. Multiple NDC installations may be needed.';
  }

  const ndcCores = baseCores + ocrAdj;

  return {
    tier,
    totalFiles, totalGB: totalGB.toFixed(2), totalTB: (totalGB / 1024).toFixed(3),
    ndcFiles, ndcGB: ndcGB.toFixed(2), ndcTB: (ndcGB / 1024).toFixed(3),
    ndcPct: totalBytes > 0 ? ((ndcBytes / totalBytes) * 100).toFixed(1) : '0',
    ocrCount, ocrPotentialCount, ocrEffective,
    ocrPct: ocrPct.toFixed(1),
    ocrPotentialPct: ndcFiles > 0 ? (ocrPotentialCount / ndcFiles * 100).toFixed(1) : '0',
    ndcServers,
    ndcPerServer: { cores: ndcCores, baseCores, ocrAdj, ramGB: ndcRAM },
    sql: { cores: sqlCores, ramGB: sqlRAM, dbSizeGB: dbSizeGB.toFixed(1), sqlAutogrowth: ndcFiles >= 16000000 ? '512 MB' : '128 MB' },
    index: { storageGB: indexSizeGB.toFixed(1) },
    notes, ocrNote,
    storageNote: 'SSD strongly recommended for both SQL and NDC index storage.'
  };
}

// ── Local drives ──────────────────────────────────────────────────────────────

function getLocalDrives() {
  if (process.platform === 'win32') {
    try {
      const out = execSync('wmic logicaldisk get DeviceID,Size,FreeSpace,VolumeName /format:csv', { encoding: 'utf8' });
      return out.trim().split('\n').slice(2).filter(Boolean).map(line => {
        const p = line.split(',');
        return { letter: p[1], label: p[3] || p[1], free: parseInt(p[2]) || 0, total: parseInt(p[4]) || 0 };
      }).filter(d => d.letter && d.letter.trim());
    } catch {
      return [{ letter: 'C:\\', label: 'C:', free: 0, total: 0 }];
    }
  }
  return [{ letter: '/', label: 'Root', free: 0, total: 0 }];
}

// ── Serve UI ──────────────────────────────────────────────────────────────────

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

const _LEGACY_HTML_START = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<title>NDC Sizer — Netwrix Data Classification Sizing Tool</title>
<style>
  :root {
    --blue: #1B3A6B; --blue-light: #2A5298; --accent: #E8702A; --accent2: #4CAF87;
    --bg: #F4F6FA; --card: #FFFFFF; --border: #DDE3EE; --text: #1A2340;
    --muted: #6B7A99; --warn: #E67E22; --success: #27AE60; --danger: #E74C3C;
    --ocr-bg: #FFF7ED; --ocr-border: #FDBA74;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
  .header { background: linear-gradient(135deg, var(--blue) 0%, var(--blue-light) 100%); color: #fff; padding: 20px 32px; display: flex; align-items: center; gap: 16px; box-shadow: 0 2px 12px rgba(0,0,0,.2); }
  .header-logo { width: 44px; height: 44px; background: rgba(255,255,255,.15); border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 22px; }
  .header h1 { font-size: 22px; font-weight: 700; letter-spacing: -.3px; }
  .header p { font-size: 13px; opacity: .75; margin-top: 2px; }
  .container { max-width: 1400px; margin: 0 auto; padding: 28px 24px; }
  .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
  .grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  .grid-kpi { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; }
  @media (max-width: 900px) { .grid-2, .grid-3, .grid-kpi { grid-template-columns: 1fr; } }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 22px 24px; box-shadow: 0 1px 4px rgba(0,0,0,.06); }
  .card-title { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .6px; color: var(--muted); margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .scan-row { display: flex; gap: 10px; margin-bottom: 14px; align-items: center; }
  .scan-row input, .scan-row select { flex: 1; border: 1.5px solid var(--border); border-radius: 8px; padding: 10px 14px; font-size: 14px; outline: none; transition: border .2s; background: #F9FAFB; color: var(--text); }
  .scan-row input:focus { border-color: var(--blue-light); background: #fff; }
  .btn { border: none; border-radius: 8px; padding: 10px 20px; font-size: 14px; font-weight: 600; cursor: pointer; transition: .2s; display: inline-flex; align-items: center; gap: 7px; white-space: nowrap; }
  .btn-primary { background: var(--blue); color: #fff; }
  .btn-primary:hover { background: var(--blue-light); }
  .btn-success { background: var(--accent2); color: #fff; }
  .btn-success:hover { filter: brightness(1.1); }
  .btn-orange { background: var(--accent); color: #fff; }
  .btn-orange:hover { filter: brightness(1.1); }
  .btn-secondary { background: #EEF2FB; color: var(--blue); border: 1.5px solid var(--border); }
  .btn-secondary:hover { background: var(--blue); color: #fff; }
  .btn-scan { background: linear-gradient(135deg, var(--blue), var(--blue-light)); color: #fff; font-size: 16px; padding: 13px 36px; border-radius: 10px; width: 100%; justify-content: center; margin-top: 10px; }
  .btn-scan:hover { filter: brightness(1.1); }
  /* Mode tabs */
  .mode-tabs { display: flex; gap: 6px; margin-bottom: 18px; border-bottom: 2px solid var(--border); padding-bottom: 0; }
  .mode-tab { border: none; background: none; padding: 10px 18px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -2px; transition: .15s; border-radius: 6px 6px 0 0; }
  .mode-tab.active { color: var(--blue); border-bottom-color: var(--blue); background: #EEF2FB; }
  .mode-tab:hover:not(.active) { color: var(--text); background: #F4F6FA; }
  /* Progress */
  .progress-wrap { display: none; margin-top: 10px; }
  .progress-wrap.visible { display: block; }
  .progress-bar-bg { background: #E8EDFB; border-radius: 99px; height: 8px; overflow: hidden; }
  .progress-bar { background: linear-gradient(90deg, var(--blue), var(--accent)); height: 100%; border-radius: 99px; width: 0%; transition: width .3s; animation: pulse 1.5s infinite; }
  @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:.7; } }
  /* KPI cards */
  .stat-card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 18px 20px; }
  .stat-value { font-size: 26px; font-weight: 800; color: var(--blue); line-height: 1.1; }
  .stat-label { font-size: 12px; color: var(--muted); margin-top: 4px; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
  .stat-sub { font-size: 12px; color: var(--muted); margin-top: 2px; }
  /* Tier badge */
  .tier-badge { display: inline-block; padding: 5px 14px; border-radius: 99px; font-size: 13px; font-weight: 700; letter-spacing: .3px; }
  .tier-poc { background: #E8F5E9; color: var(--success); }
  .tier-mid { background: #FFF3E0; color: var(--warn); }
  .tier-large { background: #FDECEA; color: var(--danger); }
  .tier-xl { background: #3B1F1F; color: #F5B7B1; }
  /* Tables */
  .rec-table { width: 100%; border-collapse: collapse; font-size: 14px; margin-top: 8px; }
  .rec-table th { background: var(--blue); color: #fff; padding: 10px 14px; text-align: left; font-size: 12px; text-transform: uppercase; letter-spacing: .5px; cursor: pointer; user-select: none; }
  .rec-table th:first-child { border-radius: 8px 0 0 0; }
  .rec-table th:last-child { border-radius: 0 8px 0 0; }
  .rec-table td { padding: 10px 14px; border-bottom: 1px solid var(--border); }
  .rec-table tr:last-child td { border-bottom: none; }
  .rec-table tr:hover td { background: #F4F6FA; }
  .rec-table .val { font-weight: 700; color: var(--blue-light); }
  /* Tree */
  .tree-wrap { max-height: 420px; overflow-y: auto; font-size: 13px; }
  .tree-node { padding: 5px 8px; border-radius: 6px; cursor: default; transition: background .1s; display: flex; align-items: center; gap: 6px; }
  .tree-node:hover { background: #EFF3FB; }
  .tree-node .node-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tree-node .node-size { color: var(--muted); font-size: 12px; min-width: 70px; text-align: right; }
  .tree-node .node-files { color: var(--muted); font-size: 11px; min-width: 60px; text-align: right; }
  .tree-toggle { cursor: pointer; color: var(--blue-light); font-size: 11px; width: 16px; }
  /* Bar charts */
  .bar-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; font-size: 13px; }
  .bar-label { width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text); font-size: 12px; }
  .bar-bg { flex: 1; background: #EEF0F8; border-radius: 99px; height: 12px; overflow: hidden; }
  .bar-fill { height: 100%; border-radius: 99px; min-width: 2px; transition: width .5s; }
  .bar-val { width: 70px; text-align: right; font-size: 12px; color: var(--muted); font-weight: 600; }
  /* Export row */
  .export-row { display: flex; gap: 10px; margin-top: 20px; flex-wrap: wrap; }
  /* Empty state */
  .empty { text-align: center; padding: 48px 24px; color: var(--muted); }
  .empty .empty-icon { font-size: 52px; margin-bottom: 12px; opacity: .4; }
  .empty p { font-size: 14px; }
  /* Notes box */
  .notes-box { background: #FFFBF0; border: 1px solid #FFE082; border-radius: 8px; padding: 12px 16px; font-size: 13px; color: #795548; margin-top: 14px; line-height: 1.6; }
  /* OCR impact box */
  .ocr-box { background: var(--ocr-bg); border: 1px solid var(--ocr-border); border-radius: 8px; padding: 14px 18px; margin-top: 14px; }
  .ocr-box-title { font-size: 13px; font-weight: 700; color: #C2410C; margin-bottom: 8px; display: flex; align-items: center; gap: 6px; }
  .ocr-box p { font-size: 13px; color: #7C2D12; line-height: 1.6; }
  .ocr-box .ocr-stats { display: flex; gap: 20px; margin-top: 10px; flex-wrap: wrap; }
  .ocr-stat { text-align: center; }
  .ocr-stat .v { font-size: 20px; font-weight: 800; color: #C2410C; }
  .ocr-stat .l { font-size: 11px; color: #9A3412; text-transform: uppercase; letter-spacing: .5px; margin-top: 2px; }
  /* Extension tab buttons */
  .tab-bar { display: flex; gap: 6px; margin-bottom: 16px; border-bottom: 2px solid var(--border); padding-bottom: 0; }
  .tab-btn { border: none; background: none; padding: 9px 16px; font-size: 13px; font-weight: 600; cursor: pointer; color: var(--muted); border-bottom: 2px solid transparent; margin-bottom: -2px; transition: .15s; border-radius: 6px 6px 0 0; }
  .tab-btn.active { color: var(--blue); border-bottom-color: var(--blue); background: #EEF2FB; }
  .tab-btn:hover:not(.active) { color: var(--text); background: #F4F6FA; }
  .tab-panel { display: none; }
  .tab-panel.active { display: block; }
  /* Category badge */
  .cat-badge { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; color: #fff; }
  /* Paths list */
  .paths-list { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 12px; min-height: 36px; padding: 8px; background: #F9FAFB; border: 1.5px dashed var(--border); border-radius: 8px; }
  .paths-list.empty-list { align-items: center; justify-content: center; }
  .path-tag { display: flex; align-items: center; gap: 6px; background: #EEF2FB; border: 1px solid #C5D2F0; border-radius: 6px; padding: 5px 10px; font-size: 12px; color: var(--blue); max-width: 340px; }
  .path-tag span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex: 1; }
  .path-tag .remove { cursor: pointer; color: #9CA3AF; font-size: 15px; line-height: 1; flex-shrink: 0; transition: color .15s; }
  .path-tag .remove:hover { color: var(--danger); }
  .paths-empty { color: var(--muted); font-size: 13px; }
  /* Shares list */
  .shares-list { margin-top: 10px; max-height: 160px; overflow-y: auto; border: 1px solid var(--border); border-radius: 8px; padding: 8px; background: #FAFBFD; }
  .shares-list label { display: flex; align-items: center; gap: 8px; padding: 5px 6px; font-size: 13px; cursor: pointer; border-radius: 4px; }
  .shares-list label:hover { background: #EEF2FB; }
  .shares-list input[type=checkbox] { accent-color: var(--blue); width: 14px; height: 14px; }
  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: #C5CDE0; border-radius: 99px; }
  /* Context menu */
  #ctx-menu { position: fixed; background: #fff; border: 1px solid var(--border); border-radius: 8px; box-shadow: 0 4px 20px rgba(0,0,0,.15); padding: 6px 0; z-index: 9999; display: none; min-width: 190px; }
  #ctx-menu.visible { display: block; }
  .ctx-item { padding: 9px 16px; font-size: 13px; cursor: pointer; display: flex; align-items: center; gap: 9px; color: var(--text); transition: background .1s; }
  .ctx-item:hover { background: #EFF3FB; color: var(--blue); }
  .ctx-item .ctx-icon { font-size: 15px; }
  /* Pie chart */
  .pie-wrap { display: flex; align-items: flex-start; gap: 20px; flex-wrap: wrap; }
  .pie-legend { flex: 1; min-width: 140px; }
  .legend-item { display: flex; align-items: center; gap: 8px; margin-bottom: 6px; font-size: 12px; }
  .legend-dot { width: 12px; height: 12px; border-radius: 3px; flex-shrink: 0; }
</style>
</head>
<body>
<div class="header">
  <div class="header-logo">&#x1F4CA;</div>
  <div>
    <h1>NDC Sizer</h1>
    <p>Netwrix Data Classification &mdash; Storage Sizing &amp; Hardware Recommendations</p>
  </div>
</div>
<div class="container">

  <!-- Scan Configuration -->
  <div class="card" style="margin-bottom:20px">
    <div class="card-title"><span>&#x1F50D;</span> Scan Configuration</div>

    <div class="mode-tabs">
      <button class="mode-tab active" id="tab-local"   onclick="setMode('local')">&#x1F4BB; Local Drive</button>
      <button class="mode-tab"        id="tab-network" onclick="setMode('network')">&#x1F310; Network Share</button>
      <button class="mode-tab"        id="tab-server"  onclick="setMode('server')">&#x1F5A5; File Server</button>
    </div>

    <!-- Local Drive panel -->
    <div id="panel-local">
      <div class="scan-row">
        <select id="drive-select"><option value="">Loading drives...</option></select>
        <input type="text" id="local-path" placeholder="Or type a custom path, e.g. C:\\Users\\Data" />
        <button class="btn btn-secondary" onclick="addLocalPath()">+ Add</button>
      </div>
    </div>

    <!-- Network Share panel -->
    <div id="panel-network" style="display:none">
      <div class="scan-row">
        <input type="text" id="network-path" placeholder="\\\\server\\share  (separate multiple with ;)" style="flex:1"/>
        <button class="btn btn-secondary" onclick="addNetworkPath()">+ Add</button>
      </div>
    </div>

    <!-- File Server panel -->
    <div id="panel-server" style="display:none">
      <div class="scan-row">
        <input type="text" id="server-host" placeholder="Hostname or IP, e.g. fileserver01" style="flex:1"/>
        <button class="btn btn-secondary" onclick="listShares()">&#x1F4CB; List Shares</button>
      </div>
      <div id="shares-area" style="display:none">
        <div class="shares-list" id="shares-list"></div>
        <button class="btn btn-secondary" style="margin-top:8px" onclick="addSelectedShares()">+ Add Selected</button>
      </div>
    </div>

    <!-- Paths to scan -->
    <div style="margin-top:14px">
      <div style="font-size:12px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Paths to Scan</div>
      <div class="paths-list empty-list" id="paths-list">
        <span class="paths-empty">No paths added yet.</span>
      </div>
    </div>

    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <button class="btn btn-scan" onclick="startScan()">&#x25B6; Scan All</button>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text);user-select:none;padding:8px 14px;background:#FFFBF0;border:1.5px solid #FFE082;border-radius:8px">
        <input type="checkbox" id="deep-ocr-chk" style="width:15px;height:15px;cursor:pointer;accent-color:#E67E22"/>
        <span><strong>&#x1F50D; Deep OCR Analysis</strong> &mdash; inspect file content for 100% accurate OCR detection</span>
        <span style="background:#FEF3C7;color:#92400E;border-radius:99px;padding:2px 8px;font-size:11px;font-weight:700;margin-left:4px">SLOWER</span>
      </label>
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--text);user-select:none;padding:8px 14px;background:#F0F4FF;border:1.5px solid #BFDBFE;border-radius:8px">
        <input type="checkbox" id="hidden-files-chk" style="width:15px;height:15px;cursor:pointer;accent-color:#3B82F6"/>
        <span><strong>&#x1F441; Include Hidden Files</strong> &mdash; scan files and folders starting with a dot (.)</span>
      </label>
    </div>

    <div class="progress-wrap" id="progress-wrap">
      <div class="progress-bar-bg"><div class="progress-bar" id="progress-bar"></div></div>
      <div style="font-size:12px;color:var(--muted);margin-top:6px" id="progress-label">Scanning filesystem, please wait...</div>
    </div>
  </div>

  <!-- Results (hidden until scan) -->
  <div id="results" style="display:none">

    <!-- KPI row: 3+3 grid -->
    <div class="grid-kpi" style="margin-bottom:20px" id="kpi-row"></div>

    <!-- Charts row -->
    <div class="grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-title"><span>&#x1F967;</span> File Categories</div>
        <div id="pie-container"></div>
      </div>
      <div class="card">
        <div class="card-title"><span>&#x1F4CA;</span> Top Extensions by Count</div>
        <div id="bar-ext-container"></div>
      </div>
    </div>

    <!-- Tree + Top Folders row -->
    <div class="grid-2" style="margin-bottom:20px">
      <div class="card">
        <div class="card-title"><span>&#x1F4C1;</span> Directory Tree</div>
        <div class="tree-wrap" id="tree-container"></div>
      </div>
      <div class="card">
        <div class="card-title"><span>&#x1F4CA;</span> Top Folders by Size</div>
        <div id="chart-container"></div>
      </div>
    </div>

    <!-- NDC Hardware Recommendations -->
    <div class="card" style="margin-bottom:20px">
      <div class="card-title"><span>&#x1F5A5;&#xFE0F;</span> NDC Hardware Recommendations</div>
      <div id="rec-container"></div>
    </div>

    <!-- Extension Analysis -->
    <div class="card" style="margin-bottom:20px">
      <div class="card-title"><span>&#x1F4DD;</span> Extension Analysis</div>
      <div class="tab-bar">
        <button class="tab-btn active" id="etab-supported"   onclick="switchExtTab('supported')">&#x2705; Supported (<span id="sup-count">0</span>)</button>
        <button class="tab-btn"        id="etab-unsupported" onclick="switchExtTab('unsupported')">&#x26A0;&#xFE0F; Unsupported (<span id="unsup-count">0</span>)</button>
        <button class="tab-btn"        id="etab-ocr"         onclick="switchExtTab('ocr')">&#x1F50D; OCR Required (<span id="ocr-count">0</span>)</button>
      </div>

      <div class="tab-panel active" id="epanel-supported">
        <div id="supported-container"></div>
      </div>
      <div class="tab-panel" id="epanel-unsupported">
        <div id="unsupported-container"></div>
      </div>
      <div class="tab-panel" id="epanel-ocr">
        <div id="ocr-container"></div>
      </div>
    </div>

    <!-- Export -->
    <div class="export-row">
      <button class="btn btn-success" onclick="exportExcel()">&#x2B07; Export Excel (.xlsx)</button>
      <button class="btn btn-orange"  onclick="exportPDF()">&#x2B07; Export PDF</button>
    </div>
  </div>

  <!-- Empty state -->
  <div class="empty" id="empty-state">
    <div class="empty-icon">&#x1F5C2;&#xFE0F;</div>
    <p>Add paths to scan and click <strong>&#x25B6; Scan All</strong> to begin.</p>
  </div>
</div>

<!-- Right-click context menu -->
<div id="ctx-menu">
  <div class="ctx-item" onclick="ctxOpenFolder()"><span class="ctx-icon">&#x1F4C2;</span> Open in Explorer</div>
  <div class="ctx-item" onclick="ctxCopyPath()"><span class="ctx-icon">&#x1F4CB;</span> Copy Path</div>
</div>

<script>
var scanMode = 'local';
var lastResult = null;
var ctxPath = null;
var scanPaths = [];

// ── Mode switching ──────────────────────────────────────────────────────────

function setMode(m) {
  scanMode = m;
  document.getElementById('panel-local').style.display   = m === 'local'   ? '' : 'none';
  document.getElementById('panel-network').style.display = m === 'network' ? '' : 'none';
  document.getElementById('panel-server').style.display  = m === 'server'  ? '' : 'none';
  document.getElementById('tab-local').classList.toggle('active', m === 'local');
  document.getElementById('tab-network').classList.toggle('active', m === 'network');
  document.getElementById('tab-server').classList.toggle('active', m === 'server');
}

// ── Path management ─────────────────────────────────────────────────────────

function addPath(p) {
  p = p.trim();
  if (!p) return;
  if (scanPaths.indexOf(p) !== -1) return;
  scanPaths.push(p);
  renderPathList();
}

function removePath(i) {
  scanPaths.splice(i, 1);
  renderPathList();
}

function renderPathList() {
  var el = document.getElementById('paths-list');
  if (scanPaths.length === 0) {
    el.className = 'paths-list empty-list';
    el.innerHTML = '<span class="paths-empty">No paths added yet.</span>';
    return;
  }
  el.className = 'paths-list';
  el.innerHTML = scanPaths.map(function(p, i) {
    return '<div class="path-tag"><span title="' + escAttr(p) + '">' + escHtml(p) + '</span>' +
           '<span class="remove" onclick="removePath(' + i + ')" title="Remove">&times;</span></div>';
  }).join('');
}

function addLocalPath() {
  var custom = document.getElementById('local-path').value.trim();
  var drive  = document.getElementById('drive-select').value;
  var p = custom || drive;
  if (!p) { alert('Please select a drive or enter a path.'); return; }
  addPath(p);
  document.getElementById('local-path').value = '';
}

function addNetworkPath() {
  var raw = document.getElementById('network-path').value.trim();
  if (!raw) { alert('Please enter a network share path.'); return; }
  var parts = raw.split(';');
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (p) addPath(p);
  }
  document.getElementById('network-path').value = '';
}

// ── List shares ─────────────────────────────────────────────────────────────

async function listShares() {
  var host = document.getElementById('server-host').value.trim();
  if (!host) { alert('Please enter a server hostname.'); return; }
  try {
    var r = await fetch('/api/list-shares?server=' + encodeURIComponent(host));
    if (!r.ok) { var e = await r.json(); throw new Error(e.error || 'Failed'); }
    var shares = await r.json();
    var area = document.getElementById('shares-area');
    var list = document.getElementById('shares-list');
    if (shares.length === 0) {
      list.innerHTML = '<div style="padding:8px;color:var(--muted);font-size:13px">No shares found on ' + escHtml(host) + '</div>';
    } else {
      list.innerHTML = shares.map(function(s) {
        return '<label><input type="checkbox" value="' + escAttr(s.unc) + '"> ' + escHtml(s.name) + ' <span style="color:var(--muted);font-size:11px">(' + escHtml(s.unc) + ')</span></label>';
      }).join('');
    }
    area.style.display = '';
  } catch(e) { alert('Could not list shares: ' + e.message); }
}

function addSelectedShares() {
  var checks = document.querySelectorAll('#shares-list input[type=checkbox]:checked');
  if (checks.length === 0) { alert('Select at least one share.'); return; }
  checks.forEach(function(cb) { addPath(cb.value); cb.checked = false; });
}

// ── Scan ────────────────────────────────────────────────────────────────────

async function startScan() {
  if (scanPaths.length === 0) { alert('Please add at least one path to scan.'); return; }
  var deepScan = document.getElementById('deep-ocr-chk').checked;
  var includeHidden = document.getElementById('hidden-files-chk').checked;
  document.getElementById('results').style.display = 'none';
  document.getElementById('empty-state').style.display = 'none';
  document.getElementById('progress-label').textContent = deepScan
    ? 'Deep OCR Analysis — opening files to inspect content, this may take a while...'
    : 'Scanning filesystem, please wait...';
  showProgress(true);
  try {
    var r = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scanPaths: scanPaths, deepScan: deepScan, includeHidden: includeHidden })
    });
    if (!r.ok) { var e = await r.json(); throw new Error(e.error || 'Scan failed'); }
    lastResult = await r.json();
    renderResults(lastResult);
  } catch(e) { alert('Scan failed: ' + e.message); document.getElementById('empty-state').style.display = ''; }
  finally { showProgress(false); }
}

var pi;
function showProgress(on) {
  document.getElementById('progress-wrap').classList.toggle('visible', on);
  if (on) {
    document.getElementById('progress-bar').style.width = '0%';
    pi = setInterval(function() {
      var b = document.getElementById('progress-bar');
      var c = parseFloat(b.style.width) || 0;
      if (c < 90) b.style.width = (c + Math.random() * 4) + '%';
    }, 200);
  } else {
    clearInterval(pi);
    document.getElementById('progress-bar').style.width = '100%';
    setTimeout(function() { document.getElementById('progress-bar').style.width = '0%'; }, 400);
  }
}

// ── Utilities ───────────────────────────────────────────────────────────────

function fmtBytes(b) {
  if (!b) return '0 B';
  var k = 1024, s = ['B','KB','MB','GB','TB'];
  var i = Math.floor(Math.log(Math.max(b,1)) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(2) + ' ' + s[i];
}

function tierClass(t) {
  if (t.indexOf('Extra') !== -1) return 'tier-xl';
  if (t.indexOf('Large') !== -1) return 'tier-large';
  if (t.indexOf('Mid')   !== -1) return 'tier-mid';
  return 'tier-poc';
}

function fmtSize(s) {
  return parseFloat(s) >= 1024 ? (parseFloat(s)/1024).toFixed(2) + ' TB' : s + ' GB';
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/"/g,'&quot;');
}

// ── Render results ──────────────────────────────────────────────────────────

function renderResults(data) {
  var tree = data.tree, sizing = data.sizing;
  document.getElementById('results').style.display = '';
  document.getElementById('empty-state').style.display = 'none';

  // KPI row (3 cols x 2 rows = 6 cards)
  document.getElementById('kpi-row').innerHTML =
    '<div class="stat-card"><div class="stat-value">' + fmtSize(sizing.totalGB) + '</div><div class="stat-label">Total Scanned Size</div></div>' +
    '<div class="stat-card"><div class="stat-value">' + Number(sizing.totalFiles).toLocaleString() + '</div><div class="stat-label">Total Files</div></div>' +
    '<div class="stat-card" style="border-color:#4CAF87"><div class="stat-value" style="color:#27AE60">' + fmtSize(sizing.ndcGB) + '</div><div class="stat-label">NDC Classifiable Size</div></div>' +
    '<div class="stat-card" style="border-color:#4CAF87"><div class="stat-value" style="color:#27AE60">' + Number(sizing.ndcFiles).toLocaleString() + '</div><div class="stat-label">NDC Classifiable Files</div><div class="stat-sub">' + sizing.ndcPct + '% of total</div></div>' +
    '<div class="stat-card" style="border-color:#FDBA74"><div class="stat-value" style="color:#C2410C">' + Number(sizing.ocrCount).toLocaleString() + '</div><div class="stat-label">OCR Candidates</div><div class="stat-sub">' + sizing.ocrPct + '% of NDC files</div></div>' +
    '<div class="stat-card"><div class="stat-value"><span class="tier-badge ' + tierClass(sizing.tier) + '">' + escHtml(sizing.tier) + '</span></div><div class="stat-label">Deployment Tier</div></div>';

  // Pie chart (categories)
  renderPieChart('pie-container', (tree.categories || []).map(function(c) {
    return { label: c.name, value: c.count, color: c.color };
  }));

  // Bar chart (top 15 extensions by count)
  var supExts = (tree.supported || []).slice(0, 15);
  renderBarChart('bar-ext-container', supExts.map(function(s) {
    var catColor = '#3B82F6';
    // look up color from global CATEGORIES info via category name
    var catMap = {"Documents":"#3B82F6","Spreadsheets":"#10B981","Presentations":"#F59E0B","Images":"#EC4899","Email":"#8B5CF6","Archives":"#64748B","Media":"#EF4444","Web/Markup":"#F97316","CAD/Design":"#14B8A6","Office Other":"#A78BFA","Code/Text":"#0EA5E9"};
    if (s.category && catMap[s.category]) catColor = catMap[s.category];
    return { label: s.ext, value: s.count, color: catColor };
  }));

  // Tree
  document.getElementById('tree-container').innerHTML = renderTree(tree, 0);

  // Top folders by size
  var top = (tree.children || []).slice(0, 10);
  var max = top.length > 0 ? (top[0].size || 1) : 1;
  document.getElementById('chart-container').innerHTML = top.map(function(n) {
    return '<div class="bar-row">' +
      '<div class="bar-label" title="' + escAttr(n.path) + '">&#x1F4C1; ' + escHtml(n.name) + '</div>' +
      '<div class="bar-bg"><div class="bar-fill" style="width:' + (n.size/max*100).toFixed(1) + '%;background:linear-gradient(90deg,var(--blue),var(--blue-light))"></div></div>' +
      '<div class="bar-val">' + fmtBytes(n.size) + '</div></div>';
  }).join('');

  // Recommendations
  var s = sizing;
  var ocrAdjStr = s.ndcPerServer.ocrAdj > 0 ? ' (' + s.ndcPerServer.baseCores + ' base + ' + s.ndcPerServer.ocrAdj + ' OCR)' : '';
  document.getElementById('rec-container').innerHTML =
    '<table class="rec-table"><tr><th>Component</th><th>Specification</th><th>Value</th><th>Notes</th></tr>' +
    '<tr><td><strong>NDC Server(s)</strong></td><td class="val">Count</td><td class="val">' + s.ndcServers + ' server' + (s.ndcServers > 1 ? 's' : '') + '</td><td>' + (s.ndcServers > 1 ? 'Clustered with DQS mode' : 'Single server deployment') + '</td></tr>' +
    '<tr><td></td><td class="val">CPU per server</td><td class="val">' + s.ndcPerServer.cores + ' cores' + ocrAdjStr + '</td><td></td></tr>' +
    '<tr><td></td><td class="val">RAM per server</td><td class="val">' + s.ndcPerServer.ramGB + ' GB</td><td></td></tr>' +
    '<tr><td></td><td class="val">Index storage</td><td class="val">' + s.index.storageGB + ' GB</td><td>35% of total data &mdash; SSD required</td></tr>' +
    '<tr><td><strong>SQL Server</strong></td><td class="val">CPU</td><td class="val">' + s.sql.cores + ' cores</td><td></td></tr>' +
    '<tr><td></td><td class="val">RAM</td><td class="val">' + s.sql.ramGB + ' GB</td><td></td></tr>' +
    '<tr><td></td><td class="val">Database size</td><td class="val">' + s.sql.dbSizeGB + ' GB</td><td>~11 KB per indexed object &mdash; SSD recommended</td></tr>' +
    '<tr><td></td><td class="val">Autogrowth</td><td class="val">' + s.sql.sqlAutogrowth + '</td><td>Recovery: Simple | Max size: Unlimited</td></tr>' +
    '</table>' +
    (s.ndcPerServer.ocrAdj > 0 ? '<div class="ocr-box">' +
      '<div class="ocr-box-title">&#x1F4F8; OCR Impact on Hardware Sizing</div>' +
      '<div class="ocr-stats">' +
        '<div class="ocr-stat"><div class="v">' + Number(s.ocrCount).toLocaleString() + '</div><div class="l">OCR Files</div></div>' +
        '<div class="ocr-stat"><div class="v">' + s.ocrPct + '%</div><div class="l">% of NDC Files</div></div>' +
        '<div class="ocr-stat"><div class="v">+' + s.ndcPerServer.ocrAdj + '</div><div class="l">Extra CPU Cores</div></div>' +
      '</div>' +
      '<p style="margin-top:10px">' + escHtml(s.ocrNote) + '</p>' +
    '</div>' : '') +
    '<div class="notes-box">&#x26A0;&#xFE0F; ' + escHtml(s.notes) + '<br/>&#x1F4BE; ' + escHtml(s.storageNote) + '</div>';

  // Extension analysis tabs
  var sup   = tree.supported   || [];
  var unsup = tree.unsupported || [];
  var ocr   = tree.ocr         || [];
  var ndcFiles = s.ndcFiles || 1;

  document.getElementById('sup-count').textContent   = sup.length;
  document.getElementById('unsup-count').textContent = unsup.length;
  document.getElementById('ocr-count').textContent   = ocr.length;

  // Supported table
  if (sup.length === 0) {
    document.getElementById('supported-container').innerHTML = '<p style="color:var(--muted);font-size:13px;padding:8px 0">No NDC-supported files found.</p>';
  } else {
    var supRows = sup.map(function(u, i) {
      var catMap = {"Documents":"#3B82F6","Spreadsheets":"#10B981","Presentations":"#F59E0B","Images":"#EC4899","Email":"#8B5CF6","Archives":"#64748B","Media":"#EF4444","Web/Markup":"#F97316","CAD/Design":"#14B8A6","Office Other":"#A78BFA","Code/Text":"#0EA5E9"};
      var badgeColor = catMap[u.category] || '#64748B';
      return '<tr style="' + (i%2===1?'background:#F9FAFB':'') + '">' +
        '<td><strong>' + escHtml(u.ext) + '</strong></td>' +
        '<td><span class="cat-badge" style="background:' + badgeColor + '">' + escHtml(u.category) + '</span></td>' +
        '<td style="font-weight:700;color:var(--blue-light)">' + u.count.toLocaleString() + '</td>' +
        '<td>' + fmtBytes(u.size) + '</td></tr>';
    }).join('');
    document.getElementById('supported-container').innerHTML =
      '<table class="rec-table"><tr><th>Extension</th><th>Category</th><th>File Count</th><th>Total Size</th></tr>' + supRows + '</table>';
  }

  // Unsupported table
  if (unsup.length === 0) {
    document.getElementById('unsupported-container').innerHTML = '<p style="color:var(--success);font-size:13px;padding:8px 0">All files are supported by NDC.</p>';
  } else {
    var unsupRows = unsup.map(function(u, i) {
      return '<tr style="' + (i%2===1?'background:#F9FAFB':'') + '">' +
        '<td><strong>' + escHtml(u.ext) + '</strong></td>' +
        '<td style="color:var(--danger);font-weight:700">' + u.count.toLocaleString() + '</td>' +
        '<td>' + fmtBytes(u.size) + '</td>' +
        '<td style="color:var(--muted);font-size:12px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(u.sample) + '">' + escHtml(u.sample) + '</td></tr>';
    }).join('');
    document.getElementById('unsupported-container').innerHTML =
      '<table class="rec-table"><tr><th>Extension</th><th>File Count</th><th>Total Size</th><th>Example Path</th></tr>' + unsupRows + '</table>';
  }

  // OCR tab — two tiers (or confirmed-only in deep scan mode)
  var deepScanUsed = lastResult.deepScan === true;
  var ocrPotential = deepScanUsed ? [] : (tree.ocrPotential || []);
  document.getElementById('ocr-count').textContent = (ocr.length + ocrPotential.length);

  var modeBadge = deepScanUsed
    ? '<span style="background:#D1FAE5;color:#065F46;border-radius:99px;padding:2px 10px;font-size:11px;font-weight:700;margin-left:8px">&#x2705; CONTENT INSPECTED — 100% ACCURATE</span>'
    : '<span style="background:#FEF3C7;color:#92400E;border-radius:99px;padding:2px 10px;font-size:11px;font-weight:700;margin-left:8px">&#x26A0;&#xFE0F; EXTENSION-BASED — 30% ESTIMATE</span>';
  var potentialCol = deepScanUsed
    ? '<div style="background:rgba(255,255,255,.6);border-radius:8px;padding:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:#065F46">&#x2705;</div><div style="font-size:11px;color:#065F46;font-weight:600">DEEP SCAN ACTIVE</div><div style="font-size:10px;color:#065F46;margin-top:2px">All files content-inspected</div></div>'
    : '<div style="background:rgba(255,255,255,.6);border-radius:8px;padding:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:#D97706">' + Number(s.ocrPotentialCount).toLocaleString() + '</div><div style="font-size:11px;color:#7C3AED;font-weight:600">POTENTIAL OCR</div><div style="font-size:10px;color:#92400E;margin-top:2px">Docs with embedded images (30% assumed)</div></div>';
  var ocrHtml = '<div class="ocr-box" style="margin-bottom:16px">' +
    '<div class="ocr-box-title">&#x1F50D; OCR Impact Summary' + modeBadge + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:8px">' +
    '<div style="background:rgba(255,255,255,.6);border-radius:8px;padding:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:#C2410C">' + Number(s.ocrCount).toLocaleString() + '</div><div style="font-size:11px;color:#7C3AED;font-weight:600">' + (deepScanUsed ? 'CONFIRMED OCR' : 'DEFINITE OCR') + '</div><div style="font-size:10px;color:#92400E;margin-top:2px">Image files (always OCR)</div></div>' +
    potentialCol +
    '<div style="background:rgba(255,255,255,.6);border-radius:8px;padding:10px;text-align:center"><div style="font-size:18px;font-weight:800;color:#1B3A6B">' + s.ocrPct + '%</div><div style="font-size:11px;color:#7C3AED;font-weight:600">EFFECTIVE OCR LOAD</div><div style="font-size:10px;color:#92400E;margin-top:2px">Of total NDC classifiable files</div></div>' +
    '</div>' +
    '<p style="margin-top:10px;font-size:12px">' + escHtml(s.ocrNote) + '</p>' +
    '</div>';

  // Definite OCR table
  var definiteSection = '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#C2410C;margin-bottom:8px;padding:6px 10px;background:#FEF2F2;border-radius:6px;border-left:4px solid #EF4444">&#x1F5BC;&#xFE0F; Definite OCR — Pure Image Files (always processed by OCR engine)</div>';
  if (ocr.length > 0) {
    definiteSection += '<table class="rec-table" style="margin-bottom:20px"><tr><th>Extension</th><th>File Count</th><th>Size</th><th>% of NDC Files</th><th>Type</th></tr>' +
      ocr.map(function(u, i) {
        var pct = ndcFiles > 0 ? (u.count / ndcFiles * 100).toFixed(1) : '0.0';
        return '<tr style="' + (i%2===1?'background:#FFF5F5':'') + '">' +
          '<td><strong>' + escHtml(u.ext) + '</strong></td>' +
          '<td style="font-weight:700;color:#C2410C">' + u.count.toLocaleString() + '</td>' +
          '<td>' + fmtBytes(u.size) + '</td><td>' + pct + '%</td>' +
          '<td style="color:#C2410C;font-size:12px">&#x2705; Definite OCR</td></tr>';
      }).join('') + '</table>';
  } else {
    definiteSection += '<p style="color:var(--muted);font-size:13px;padding:6px 0 14px">No pure image files found.</p>';
  }

  // Potential OCR table
  var potentialSection = '<div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#D97706;margin-bottom:8px;padding:6px 10px;background:#FFFBEB;border-radius:6px;border-left:4px solid #F59E0B">&#x1F4C4; Potential OCR — Documents &amp; PDFs with Embedded Images (30% assumed to require OCR)</div>';
  if (ocrPotential.length > 0) {
    potentialSection += '<table class="rec-table"><tr><th>Extension</th><th>File Count</th><th>Estimated OCR Files (30%)</th><th>Size</th><th>% of NDC Files</th></tr>' +
      ocrPotential.map(function(u, i) {
        var estimated = Math.round(u.count * 0.30);
        var pct = ndcFiles > 0 ? (u.count / ndcFiles * 100).toFixed(1) : '0.0';
        return '<tr style="' + (i%2===1?'background:#FEFCE8':'') + '">' +
          '<td><strong>' + escHtml(u.ext) + '</strong></td>' +
          '<td>' + u.count.toLocaleString() + '</td>' +
          '<td style="font-weight:700;color:#D97706">~' + estimated.toLocaleString() + '</td>' +
          '<td>' + fmtBytes(u.size) + '</td><td>' + pct + '%</td></tr>';
      }).join('') + '</table>';
  } else {
    potentialSection += '<p style="color:var(--muted);font-size:13px;padding:6px 0">No potential OCR documents found.</p>';
  }

  document.getElementById('ocr-container').innerHTML = ocrHtml + definiteSection + potentialSection;
}

// ── SVG Pie Chart ───────────────────────────────────────────────────────────

function renderPieChart(containerId, slices) {
  var el = document.getElementById(containerId);
  if (!slices || slices.length === 0) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">No data.</p>'; return; }
  var total = slices.reduce(function(a, s) { return a + s.value; }, 0);
  if (total === 0) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">No data.</p>'; return; }

  var cx = 80, cy = 80, r = 72;
  var paths = '';
  var angle = -Math.PI / 2;

  slices.forEach(function(s) {
    var sweep = (s.value / total) * 2 * Math.PI;
    var x1 = cx + r * Math.cos(angle);
    var y1 = cy + r * Math.sin(angle);
    var x2 = cx + r * Math.cos(angle + sweep);
    var y2 = cy + r * Math.sin(angle + sweep);
    var large = sweep > Math.PI ? 1 : 0;
    var d = 'M ' + cx + ' ' + cy + ' L ' + x1.toFixed(2) + ' ' + y1.toFixed(2) +
            ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' + x2.toFixed(2) + ' ' + y2.toFixed(2) + ' Z';
    paths += '<path d="' + d + '" fill="' + s.color + '" stroke="#fff" stroke-width="1.5">' +
             '<title>' + escHtml(s.label) + ': ' + s.value.toLocaleString() + ' files (' + (s.value/total*100).toFixed(1) + '%)</title></path>';
    angle += sweep;
  });

  var svg = '<svg width="160" height="160" viewBox="0 0 160 160" xmlns="http://www.w3.org/2000/svg">' + paths + '</svg>';

  var legend = slices.map(function(s) {
    return '<div class="legend-item">' +
      '<div class="legend-dot" style="background:' + s.color + '"></div>' +
      '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(s.label) + '">' + escHtml(s.label) + '</span>' +
      '<span style="font-weight:700;color:var(--blue-light);min-width:40px;text-align:right">' + (s.value/total*100).toFixed(1) + '%</span>' +
    '</div>';
  }).join('');

  el.innerHTML = '<div class="pie-wrap">' + svg + '<div class="pie-legend">' + legend + '</div></div>';
}

// ── Horizontal Bar Chart ────────────────────────────────────────────────────

function renderBarChart(containerId, items) {
  var el = document.getElementById(containerId);
  if (!items || items.length === 0) { el.innerHTML = '<p style="color:var(--muted);font-size:13px">No data.</p>'; return; }
  var max = items.reduce(function(a, x) { return Math.max(a, x.value); }, 1);
  el.innerHTML = items.map(function(item) {
    return '<div class="bar-row">' +
      '<div class="bar-label" title="' + escAttr(item.label) + '">' + escHtml(item.label) + '</div>' +
      '<div class="bar-bg"><div class="bar-fill" style="width:' + (item.value/max*100).toFixed(1) + '%;background:' + item.color + '"></div></div>' +
      '<div class="bar-val">' + item.value.toLocaleString() + '</div>' +
    '</div>';
  }).join('');
}

// ── Tree rendering ──────────────────────────────────────────────────────────

function renderTree(node, depth) {
  var has = node.children && node.children.length > 0;
  var id = 'n' + Math.random().toString(36).slice(2);
  var safePath = escAttr(node.path);
  return '<div class="tree-node" style="padding-left:' + (depth * 18 + 8) + 'px"' +
    ' data-path="' + safePath + '"' +
    ' onclick="' + (has ? 'toggleNode(\\'' + id + '\\')' : '') + '"' +
    ' oncontextmenu="showCtxMenu(event,this)">' +
    '<span class="tree-toggle">' + (has ? '&#x25B6;' : '&middot;') + '</span>' +
    '<span class="node-name" title="' + safePath + '">&#x1F4C1; ' + escHtml(node.name) + '</span>' +
    '<span class="node-size">' + fmtBytes(node.size) + '</span>' +
    '<span class="node-files">' + (node.fileCount || 0).toLocaleString() + ' files</span></div>' +
    (has ? '<div id="' + id + '" style="display:none">' + node.children.map(function(c) { return renderTree(c, depth + 1); }).join('') + '</div>' : '');
}

function toggleNode(id) {
  var el = document.getElementById(id);
  if (!el) return;
  var v = el.style.display !== 'none';
  el.style.display = v ? 'none' : '';
  var btn = el.previousElementSibling && el.previousElementSibling.querySelector('.tree-toggle');
  if (btn) btn.innerHTML = v ? '&#x25B6;' : '&#x25BC;';
}

// ── Extension tabs ──────────────────────────────────────────────────────────

function switchExtTab(tab) {
  ['supported','unsupported','ocr'].forEach(function(t) {
    document.getElementById('etab-' + t).classList.toggle('active', t === tab);
    document.getElementById('epanel-' + t).classList.toggle('active', t === tab);
  });
}

// ── Context menu ────────────────────────────────────────────────────────────

function showCtxMenu(e, el) {
  e.preventDefault(); e.stopPropagation();
  var target = el;
  while (target && !target.dataset.path) target = target.parentElement;
  ctxPath = target ? target.dataset.path : null;
  if (!ctxPath) return;
  var m = document.getElementById('ctx-menu');
  m.classList.add('visible');
  var vw = window.innerWidth, vh = window.innerHeight;
  var x = e.clientX, my = e.clientY;
  if (x + 200 > vw) x = vw - 205;
  if (my + 90 > vh) my = vh - 95;
  m.style.left = x + 'px'; m.style.top = my + 'px';
}

function hideCtxMenu() { document.getElementById('ctx-menu').classList.remove('visible'); ctxPath = null; }

async function ctxOpenFolder() {
  if (!ctxPath) return;
  var p = ctxPath; hideCtxMenu();
  try {
    await fetch('/api/open-folder', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ folderPath: p }) });
  } catch(e) { alert('Could not open folder: ' + e.message); }
}

function ctxCopyPath() {
  if (!ctxPath) return;
  var p = ctxPath; hideCtxMenu();
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(p);
  } else {
    var t = document.createElement('textarea');
    t.value = p; t.style.position = 'fixed'; t.style.opacity = '0';
    document.body.appendChild(t); t.focus(); t.select();
    document.execCommand('copy'); document.body.removeChild(t);
  }
}

document.addEventListener('click', hideCtxMenu);
document.addEventListener('keydown', function(e) { if (e.key === 'Escape') hideCtxMenu(); });

// ── Export ──────────────────────────────────────────────────────────────────

async function exportExcel() {
  if (!lastResult) return;
  var r = await fetch('/api/export/excel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lastResult) });
  var blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'NDC_Sizing_Report.xlsx'; a.click(); URL.revokeObjectURL(url);
}

async function exportPDF() {
  if (!lastResult) return;
  var r = await fetch('/api/export/pdf', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(lastResult) });
  var blob = await r.blob(), url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = 'NDC_Sizing_Report.pdf'; a.click(); URL.revokeObjectURL(url);
}

// ── Drives ──────────────────────────────────────────────────────────────────

async function loadDrives() {
  try {
    var r = await fetch('/api/drives');
    var drives = await r.json();
    var sel = document.getElementById('drive-select');
    sel.innerHTML = drives.map(function(d) {
      return '<option value="' + escAttr(d.letter) + '">' + escHtml(d.letter) + (d.label ? ' — ' + escHtml(d.label) : '') + '</option>';
    }).join('');
    if (!drives.length) sel.innerHTML = '<option value="/">/ (root)</option>';
  } catch(e) {}
}

loadDrives();
</script>
<footer style="text-align:center;padding:18px 0 12px;font-size:11px;color:#9ca3af;border-top:1px solid #e5e7eb;margin-top:32px;">
  &copy; 2025 Netwrix Corporation. All rights reserved. &nbsp;&bull;&nbsp; Developed by Karim Azzouzi &amp; Russell McDermott
</footer>
</body>
</html>`;

// ── API routes ────────────────────────────────────────────────────────────────

app.get('/api/drives', (req, res) => res.json(getLocalDrives()));

app.get('/api/list-shares', (req, res) => {
  const server = (req.query.server || '').trim();
  if (!server) return res.status(400).json({ error: 'server parameter required' });
  // Sanitize: only allow hostname-safe chars
  if (!/^[a-zA-Z0-9.\-_]+$/.test(server)) return res.status(400).json({ error: 'Invalid server name' });
  try {
    const out = execSync('net view \\\\' + server + ' /all', { encoding: 'utf8', timeout: 15000 });
    const lines = out.split('\n');
    const shares = [];
    for (const line of lines) {
      const m = line.match(/^([A-Za-z$][A-Za-z0-9$_\-]*)\s+Disk/i);
      if (m) {
        const name = m[1];
        shares.push({ name, unc: '\\\\' + server + '\\' + name });
      }
    }
    res.json(shares);
  } catch (e) {
    res.status(500).json({ error: 'Could not list shares: ' + e.message });
  }
});

app.post('/api/open-folder', (req, res) => {
  const { folderPath } = req.body;
  if (!folderPath) return res.status(400).json({ error: 'folderPath required' });
  spawn('explorer.exe', [folderPath], { detached: true, stdio: 'ignore' }).unref();
  res.json({ ok: true });
});

app.post('/api/scan', (req, res) => {
  const { scanPaths } = req.body;
  if (!scanPaths || !Array.isArray(scanPaths) || scanPaths.length === 0) {
    return res.status(400).json({ error: 'scanPaths array required' });
  }
  const deepScan = req.body.deepScan === true;
  const includeHidden = req.body.includeHidden === true;
  try {
    const results = scanPaths.map(p => scanDirectory(p, 0, 5, null, deepScan, includeHidden));
    const tree = mergeScans(results);
    const sizing = computeNDCSizing(tree.size, tree.fileCount, tree.ndcSize, tree.ndcCount, tree.ocrCount, tree.ocrPotentialCount);
    res.json({ tree, sizing, scanPaths, deepScan, includeHidden });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Excel export ──────────────────────────────────────────────────────────────

app.post('/api/export/excel', async (req, res) => {
  const { tree, sizing, scanPaths } = req.body;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'NDC Sizer'; wb.created = new Date();

  const pathsLabel = Array.isArray(scanPaths) ? scanPaths.join('; ') : (scanPaths || '');

  // ── Sheet 1: Summary ──
  const ws1 = wb.addWorksheet('Summary');
  ws1.columns = [{ width: 38 }, { width: 32 }];
  const addRow1 = (label, value, bold, fill) => {
    const r = ws1.addRow([label, value]);
    if (bold) r.font = { bold: true };
    if (fill) r.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    r.border = { bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
  };
  ws1.addRow(['NDC SIZING REPORT']).font = { bold: true, size: 16, color: { argb: 'FF1B3A6B' } };
  ws1.addRow(['Generated', new Date().toLocaleString()]);
  ws1.addRow(['Scanned Path(s)', pathsLabel]);
  ws1.addRow([]);
  addRow1('SCAN RESULTS', '', true, 'FFD6E4F7');
  addRow1('Total Data Size', sizing.totalGB + ' GB (' + sizing.totalTB + ' TB)');
  addRow1('Total File Count', Number(sizing.totalFiles).toLocaleString());
  addRow1('NDC Classifiable Size', sizing.ndcGB + ' GB');
  addRow1('NDC Classifiable Files', Number(sizing.ndcFiles).toLocaleString() + ' (' + sizing.ndcPct + '%)');
  addRow1('OCR Candidate Files', Number(sizing.ocrCount).toLocaleString() + ' (' + sizing.ocrPct + '% of NDC files)');
  addRow1('Deployment Tier', sizing.tier, true);
  ws1.addRow([]);
  addRow1('NDC SERVER REQUIREMENTS', '', true, 'FFD6E4F7');
  addRow1('Number of NDC Servers', sizing.ndcServers);
  addRow1('CPU per NDC Server', sizing.ndcPerServer.cores + ' cores (' + sizing.ndcPerServer.baseCores + ' base + ' + sizing.ndcPerServer.ocrAdj + ' OCR adj)');
  addRow1('RAM per NDC Server', sizing.ndcPerServer.ramGB + ' GB');
  addRow1('Index Storage Required', sizing.index.storageGB + ' GB (35% of NDC data)');
  ws1.addRow([]);
  addRow1('SQL SERVER REQUIREMENTS', '', true, 'FFD6E4F7');
  addRow1('SQL CPU', sizing.sql.cores + ' cores');
  addRow1('SQL RAM', sizing.sql.ramGB + ' GB');
  addRow1('SQL Database Size', sizing.sql.dbSizeGB + ' GB (~11 KB/object)');
  addRow1('SQL Autogrowth', sizing.sql.sqlAutogrowth);
  ws1.addRow([]);
  addRow1('NOTES', '', true, 'FFFFF3CD');
  ws1.addRow([sizing.notes]).font = { italic: true };
  ws1.addRow([sizing.ocrNote]).font = { italic: true };
  ws1.addRow([sizing.storageNote]).font = { italic: true };

  // ── Sheet 2: NDC Recommendations ──
  const ws2 = wb.addWorksheet('NDC Recommendations');
  ws2.columns = [{ width: 28 }, { width: 22 }, { width: 28 }, { width: 40 }];
  const hdr2 = ws2.addRow(['Component', 'Specification', 'Value', 'Notes']);
  hdr2.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
  hdr2.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  const ocrAdjStr = sizing.ndcPerServer.ocrAdj > 0 ? ' (' + sizing.ndcPerServer.baseCores + ' base + ' + sizing.ndcPerServer.ocrAdj + ' OCR)' : '';
  const recRows = [
    ['NDC Server(s)', 'Count', sizing.ndcServers + ' server(s)', sizing.ndcServers > 1 ? 'Clustered with DQS mode' : 'Single server'],
    ['', 'CPU per server', sizing.ndcPerServer.cores + ' cores' + ocrAdjStr, ''],
    ['', 'RAM per server', sizing.ndcPerServer.ramGB + ' GB', ''],
    ['', 'Index storage', sizing.index.storageGB + ' GB', '35% of total data — SSD required'],
    ['SQL Server', 'CPU', sizing.sql.cores + ' cores', ''],
    ['', 'RAM', sizing.sql.ramGB + ' GB', ''],
    ['', 'Database size', sizing.sql.dbSizeGB + ' GB', '~11 KB per indexed object'],
    ['', 'Autogrowth', sizing.sql.sqlAutogrowth, 'Recovery: Simple | Max size: Unlimited'],
  ];
  for (const row of recRows) {
    const r = ws2.addRow(row);
    r.border = { bottom: { style: 'thin', color: { argb: 'FFE0E0E0' } } };
  }

  // ── Sheet 3: Directory Tree ──
  const ws3 = wb.addWorksheet('Directory Tree');
  ws3.columns = [{ header: 'Path', key: 'path', width: 60 }, { header: 'Size', key: 'size', width: 18 }, { header: 'File Count', key: 'count', width: 16 }, { header: 'NDC Files', key: 'ndc', width: 14 }];
  ws3.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
  ws3.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  const flattenTree = (node, indent) => {
    if (indent === undefined) indent = 0;
    ws3.addRow({ path: '  '.repeat(indent) + node.name, size: formatBytes(node.size), count: (node.fileCount || 0).toLocaleString(), ndc: (node.ndcCount || 0).toLocaleString() });
    if (node.children) node.children.forEach(c => flattenTree(c, indent + 1));
  };
  flattenTree(tree);

  // ── Sheet 4: Supported Extensions ──
  const ws4 = wb.addWorksheet('Supported Extensions');
  ws4.columns = [{ header: 'Extension', key: 'ext', width: 14 }, { header: 'Category', key: 'cat', width: 20 }, { header: 'File Count', key: 'count', width: 14 }, { header: 'Total Size', key: 'size', width: 18 }];
  ws4.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
  ws4.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  for (const s of (tree.supported || [])) {
    ws4.addRow({ ext: s.ext, cat: s.category, count: s.count, size: formatBytes(s.size) });
  }

  // ── Sheet 5: Unsupported Extensions ──
  const ws5 = wb.addWorksheet('Unsupported Extensions');
  ws5.columns = [{ header: 'Extension', key: 'ext', width: 14 }, { header: 'File Count', key: 'count', width: 14 }, { header: 'Total Size', key: 'size', width: 18 }, { header: 'Example Path', key: 'sample', width: 60 }];
  ws5.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
  ws5.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  for (const u of (tree.unsupported || [])) {
    ws5.addRow({ ext: u.ext, count: u.count, size: formatBytes(u.size), sample: u.sample });
  }

  // ── Sheet 6: OCR Analysis ──
  const ws6 = wb.addWorksheet('OCR Analysis');
  ws6.columns = [{ header: 'Extension', key: 'ext', width: 14 }, { header: 'File Count', key: 'count', width: 14 }, { header: 'Total Size', key: 'size', width: 18 }, { header: '% of NDC Files', key: 'pct', width: 16 }, { header: 'Note', key: 'note', width: 36 }];
  ws6.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1B3A6B' } };
  ws6.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  const ndcFilesTotal = sizing.ndcFiles || 1;
  for (const o of (tree.ocr || [])) {
    ws6.addRow({ ext: o.ext, count: o.count, size: formatBytes(o.size), pct: (o.count / ndcFilesTotal * 100).toFixed(1) + '%', note: 'Requires OCR engine' });
  }
  ws6.addRow([]);
  ws6.addRow(['OCR Summary']);
  ws6.addRow(['Total OCR files', sizing.ocrCount]);
  ws6.addRow(['OCR % of NDC', sizing.ocrPct + '%']);
  ws6.addRow(['CPU adjustment', '+' + sizing.ndcPerServer.ocrAdj + ' cores per NDC server']);
  ws6.addRow(['Note', sizing.ocrNote]);

  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', 'attachment; filename="NDC_Sizing_Report.xlsx"');
  await wb.xlsx.write(res);
  res.end();
});

// ── PDF export ────────────────────────────────────────────────────────────────

app.post('/api/export/pdf', async (req, res) => {
  const { sizing, tree, scanPaths } = req.body;
  const pathsLabel = Array.isArray(scanPaths) ? scanPaths.join('; ') : (scanPaths || '');

  const pdfDoc = await PDFDocument.create();
  const bold    = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regular = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const hex = h => { const n = parseInt(h.slice(1), 16); return rgb(((n>>16)&255)/255, ((n>>8)&255)/255, (n&255)/255); };
  const BLUE   = hex('#1B3A6B'), BLUE2  = hex('#2A5298'), MUTED  = hex('#8899BB');
  const WARN   = hex('#E67E22'), DARK   = hex('#1A2340'), WHITE  = rgb(1,1,1);
  const LGREY  = hex('#F4F6FA'), LLGREY = hex('#EEF2FB'), YELLOW = hex('#FFFBF0');
  const ORANGE = hex('#FFF7ED');

  const PAGE_W = 595, PAGE_H = 842, ML = 50, MR = 50, CW = PAGE_W - ML - MR;

  let page = pdfDoc.addPage([PAGE_W, PAGE_H]);
  let y = PAGE_H;

  const newPage = () => { page = pdfDoc.addPage([PAGE_W, PAGE_H]); y = PAGE_H; };
  const checkY  = (needed) => { if (y - needed < 40) newPage(); };

  const rect = (rx, ry, rw, rh, color) => {
    page.drawRectangle({ x: rx, y: PAGE_H - ry - rh, width: rw, height: rh, color });
  };

  const text = (t, tx, ty, opts) => {
    if (!opts) opts = {};
    const o = { x: tx, y: PAGE_H - ty - (opts.size || 10), font: opts.font || regular, size: opts.size || 10, color: opts.color || DARK };
    if (opts.maxWidth) o.maxWidth = opts.maxWidth;
    try { page.drawText(String(t).replace(/[^\x00-\x7F]/g, ''), o); } catch (e) {}
  };

  // Header banner
  rect(0, 0, PAGE_W, 78, BLUE);
  text('NDC Sizing Report', ML, 16, { font: bold, size: 20, color: WHITE });
  text('Netwrix Data Classification - Hardware Recommendations', ML, 44, { size: 10, color: rgb(0.8,0.88,1) });
  text('Generated: ' + new Date().toLocaleString(), ML, 58, { size: 9, color: rgb(0.7,0.78,0.9) });
  text('Path(s): ' + pathsLabel, ML, 70, { size: 8, color: rgb(0.6,0.7,0.85), maxWidth: CW });
  y = 78 + 16;

  const sectionTitle = (title) => {
    checkY(30);
    rect(ML, y, CW, 20, LLGREY);
    text(title.toUpperCase(), ML + 6, y + 4, { font: bold, size: 9, color: BLUE });
    y += 26;
  };

  const tableRow = (label, value, note, alt) => {
    checkY(22);
    if (alt) rect(ML, y, CW, 20, LGREY);
    text(label,  ML + 6,   y + 5, { size: 9,  color: DARK,  maxWidth: 175 });
    text(value,  ML + 190, y + 5, { font: bold, size: 9, color: BLUE2, maxWidth: 120 });
    if (note) text(note, ML + 315, y + 5, { size: 8, color: MUTED, maxWidth: 175 });
    y += 22;
  };

  // KPI boxes
  sectionTitle('Scan Summary');
  const kpis = [
    { label: 'Total Data Size', value: parseFloat(sizing.totalTB) >= 1 ? sizing.totalTB + ' TB' : sizing.totalGB + ' GB' },
    { label: 'Total Files',     value: Number(sizing.totalFiles).toLocaleString() },
    { label: 'Deployment Tier', value: sizing.tier }
  ];
  kpis.forEach((k, i) => {
    const kx = ML + i * 168;
    rect(kx, y, 158, 52, LGREY);
    text(k.value, kx + 8, y + 10, { font: bold, size: 12, color: BLUE, maxWidth: 142 });
    text(k.label, kx + 8, y + 36, { size: 8,   color: MUTED, maxWidth: 142 });
  });
  y += 66;

  // NDC data
  sectionTitle('NDC Data Overview');
  tableRow('NDC Classifiable Size',  sizing.ndcGB + ' GB',               '', false);
  tableRow('NDC Classifiable Files', Number(sizing.ndcFiles).toLocaleString() + ' (' + sizing.ndcPct + '%)', '', true);
  tableRow('OCR Candidate Files',    Number(sizing.ocrCount).toLocaleString() + ' (' + sizing.ocrPct + '%)', 'of NDC files', false);
  y += 6;

  // NDC servers
  sectionTitle('NDC Server Requirements');
  const ocrAdjStr2 = sizing.ndcPerServer.ocrAdj > 0 ? ' (' + sizing.ndcPerServer.baseCores + '+' + sizing.ndcPerServer.ocrAdj + ' OCR)' : '';
  tableRow('NDC Servers (count)',    sizing.ndcServers + ' server(s)',  sizing.ndcServers > 1 ? 'Clustered with DQS mode' : 'Single server', false);
  tableRow('CPU per server',         sizing.ndcPerServer.cores + ' cores' + ocrAdjStr2, '', true);
  tableRow('RAM per server',         sizing.ndcPerServer.ramGB + ' GB', '', false);
  tableRow('Index storage required', sizing.index.storageGB + ' GB',   '35% of data - SSD required', true);
  y += 6;

  // SQL server
  sectionTitle('SQL Server Requirements');
  tableRow('CPU',           sizing.sql.cores + ' cores',    '', false);
  tableRow('RAM',           sizing.sql.ramGB + ' GB',       '', true);
  tableRow('Database size', sizing.sql.dbSizeGB + ' GB',    '~11 KB per indexed object', false);
  tableRow('Autogrowth',    sizing.sql.sqlAutogrowth,       'Recovery: Simple | Max size: Unlimited', true);
  y += 6;

  // OCR section (if relevant)
  if (sizing.ndcPerServer.ocrAdj > 0) {
    checkY(60);
    sectionTitle('OCR Impact');
    rect(ML, y, CW, 52, ORANGE);
    text('OCR Workload: ' + sizing.ocrPct + '% of NDC files require OCR processing.', ML + 6, y + 8,  { font: bold, size: 9, color: hex('#C2410C'), maxWidth: CW - 12 });
    text(sizing.ocrNote, ML + 6, y + 24, { size: 8, color: hex('#7C2D12'), maxWidth: CW - 12 });
    text('+' + sizing.ndcPerServer.ocrAdj + ' CPU cores added per NDC server due to OCR workload.', ML + 6, y + 40, { size: 8, color: hex('#9A3412'), maxWidth: CW - 12 });
    y += 62;
  }

  // Notes
  checkY(52);
  rect(ML, y, CW, 48, YELLOW);
  text('Notes:', ML + 6, y + 5, { font: bold, size: 9, color: WARN });
  text(sizing.notes,       ML + 6, y + 18, { size: 8, color: hex('#795548'), maxWidth: CW - 12 });
  text(sizing.storageNote, ML + 6, y + 34, { size: 8, color: hex('#795548'), maxWidth: CW - 12 });
  y += 58;

  // Top Directories
  if (tree.children && tree.children.length > 0) {
    checkY(30);
    sectionTitle('Top Directories by Size');
    rect(ML, y, CW, 18, BLUE);
    text('Directory', ML + 6,   y + 4, { font: bold, size: 8, color: WHITE });
    text('Size',      ML + 310, y + 4, { font: bold, size: 8, color: WHITE });
    text('Files',     ML + 400, y + 4, { font: bold, size: 8, color: WHITE });
    y += 20;
    tree.children.slice(0, 18).forEach((n, i) => {
      checkY(18);
      if (i % 2 === 1) rect(ML, y, CW, 17, LGREY);
      text(n.name,                               ML + 6,   y + 4, { size: 8, color: DARK, maxWidth: 295 });
      text(formatBytes(n.size),                  ML + 310, y + 4, { size: 8, color: BLUE2 });
      text((n.fileCount || 0).toLocaleString(),  ML + 400, y + 4, { size: 8, color: DARK });
      y += 17;
    });
  }

  // Supported extensions summary
  if (tree.supported && tree.supported.length > 0) {
    checkY(30);
    sectionTitle('Top Supported Extensions');
    rect(ML, y, CW, 18, BLUE);
    text('Extension', ML + 6,   y + 4, { font: bold, size: 8, color: WHITE });
    text('Category',  ML + 90,  y + 4, { font: bold, size: 8, color: WHITE });
    text('Count',     ML + 230, y + 4, { font: bold, size: 8, color: WHITE });
    text('Size',      ML + 320, y + 4, { font: bold, size: 8, color: WHITE });
    y += 20;
    tree.supported.slice(0, 20).forEach((s, i) => {
      checkY(17);
      if (i % 2 === 1) rect(ML, y, CW, 16, LGREY);
      text(s.ext,              ML + 6,   y + 3, { size: 8, color: DARK });
      text(s.category,         ML + 90,  y + 3, { size: 8, color: MUTED, maxWidth: 130 });
      text(s.count.toLocaleString(), ML + 230, y + 3, { size: 8, color: BLUE2 });
      text(formatBytes(s.size),ML + 320, y + 3, { size: 8, color: DARK });
      y += 16;
    });
  }

  // Footer on all pages
  const pages = pdfDoc.getPages();
  for (const pg of pages) {
    pg.drawRectangle({ x: 0, y: 0, width: PAGE_W, height: 24, color: LGREY });
    pg.drawText('NDC Sizer - Netwrix Data Classification Sizing Tool - ' + new Date().getFullYear(),
      { x: ML, y: 8, font: regular, size: 7, color: MUTED });
  }

  const pdfBytes = await pdfDoc.save();
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'attachment; filename="NDC_Sizing_Report.pdf"');
  res.send(Buffer.from(pdfBytes));
});

// ── Merge results endpoint ────────────────────────────────────────────────────

app.post('/api/merge-results', (req, res) => {
  const { results } = req.body;
  if (!results || !Array.isArray(results) || results.length === 0) {
    return res.status(400).json({ error: 'results array required' });
  }
  const trees = results.map(r => r.tree).filter(Boolean);
  const merged = mergeScans(trees);
  const sizing = computeNDCSizing(merged.size, merged.fileCount, merged.ndcSize, merged.ndcCount, merged.ocrCount, merged.ocrPotentialCount);
  const allPaths = results.flatMap(r => r.scanPaths || []);
  res.json({ tree: merged, sizing, scanPaths: allPaths, deepScan: false, includeHidden: false });
});

// ── SharePoint / Microsoft Graph API ─────────────────────────────────────────

async function getGraphToken(tenantId, clientId, clientSecret) {
  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials'
  });
  const resp = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString()
  });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error_description || 'Authentication failed. Check your Tenant ID, Application ID, and Client Secret.');
  }
  const data = await resp.json();
  return data.access_token;
}

async function graphGet(token, url) {
  const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' } });
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}));
    throw new Error(err.error?.message || `Graph API error: ${resp.status} ${resp.statusText}`);
  }
  return resp.json();
}

async function scanDriveWithGraph(token, driveId) {
  const maps = { supported: {}, unsupported: {}, ocr: {}, ocrPotential: {}, categories: {} };
  for (const cat of CATEGORIES) maps.categories[cat.name] = { name: cat.name, color: cat.color, count: 0, size: 0 };

  let totalSize = 0, totalFiles = 0, ndcSize = 0, ndcCount = 0;
  let ocrSize = 0, ocrCount = 0, ocrPotentialSize = 0, ocrPotentialCount = 0;

  let url = `https://graph.microsoft.com/v1.0/drives/${driveId}/root/delta?$select=name,size,file&$top=1000`;

  while (url) {
    const page = await graphGet(token, url);
    const items = page.value || [];

    for (const item of items) {
      if (!item.file) continue;
      const sz = item.size || 0;
      const ext = path.extname(item.name || '').toLowerCase();
      totalSize += sz;
      totalFiles++;

      if (NDC_EXTENSIONS.has(ext)) {
        ndcSize += sz; ndcCount++;
        if (!maps.supported[ext]) {
          const cat = EXT_TO_CATEGORY[ext] || null;
          maps.supported[ext] = { ext, count: 0, size: 0, category: cat ? cat.name : 'Other' };
        }
        maps.supported[ext].count++; maps.supported[ext].size += sz;
        const cat = EXT_TO_CATEGORY[ext];
        if (cat && maps.categories[cat.name]) { maps.categories[cat.name].count++; maps.categories[cat.name].size += sz; }
        if (OCR_EXTENSIONS.has(ext)) {
          ocrSize += sz; ocrCount++;
          if (!maps.ocr[ext]) maps.ocr[ext] = { ext, count: 0, size: 0, tier: 'definite' };
          maps.ocr[ext].count++; maps.ocr[ext].size += sz;
        }
        if (OCR_POTENTIAL_EXTENSIONS.has(ext)) {
          ocrPotentialSize += sz; ocrPotentialCount++;
          if (!maps.ocrPotential[ext]) maps.ocrPotential[ext] = { ext, count: 0, size: 0, tier: 'potential' };
          maps.ocrPotential[ext].count++; maps.ocrPotential[ext].size += sz;
        }
      } else {
        const key = ext || '(no extension)';
        if (!maps.unsupported[key]) maps.unsupported[key] = { ext: key, count: 0, size: 0, sample: item.name || '' };
        maps.unsupported[key].count++; maps.unsupported[key].size += sz;
      }
    }
    url = page['@odata.nextLink'] || null;
  }

  return {
    size: totalSize, fileCount: totalFiles, ndcSize, ndcCount,
    ocrSize, ocrCount, ocrPotentialSize, ocrPotentialCount,
    supported: Object.values(maps.supported).sort((a, b) => b.count - a.count),
    unsupported: Object.values(maps.unsupported).sort((a, b) => b.count - a.count),
    ocr: Object.values(maps.ocr).sort((a, b) => b.count - a.count),
    ocrPotential: Object.values(maps.ocrPotential).sort((a, b) => b.count - a.count),
    categories: Object.values(maps.categories).filter(c => c.count > 0).sort((a, b) => b.count - a.count),
    children: []
  };
}

app.post('/api/sharepoint/connect', async (req, res) => {
  const { tenantId, clientId, clientSecret } = req.body;
  if (!tenantId || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'tenantId, clientId, clientSecret required' });
  }
  try {
    const token = await getGraphToken(tenantId, clientId, clientSecret);
    const org = await graphGet(token, 'https://graph.microsoft.com/v1.0/organization?$select=displayName');
    const orgName = (org.value && org.value[0] && org.value[0].displayName) || tenantId;
    res.json({ ok: true, orgName });
  } catch (e) {
    res.status(401).json({ error: e.message });
  }
});

app.post('/api/sharepoint/sites', async (req, res) => {
  const { tenantId, clientId, clientSecret } = req.body;
  try {
    const token = await getGraphToken(tenantId, clientId, clientSecret);
    const sitesData = await graphGet(token, 'https://graph.microsoft.com/v1.0/sites?search=*&$top=100&$select=id,displayName,webUrl,name');
    const sites = (sitesData.value || []).map(s => ({ id: s.id, name: s.displayName || s.name, url: s.webUrl, type: 'sharepoint' }));
    let users = [];
    try {
      const usersData = await graphGet(token, 'https://graph.microsoft.com/v1.0/users?$top=100&$select=id,displayName,userPrincipalName&$filter=accountEnabled eq true');
      users = (usersData.value || []).map(u => ({ id: u.id, name: u.displayName, upn: u.userPrincipalName, type: 'onedrive' }));
    } catch {}
    res.json({ sites, users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sharepoint/scan', async (req, res) => {
  const { tenantId, clientId, clientSecret, targets } = req.body;
  if (!targets || targets.length === 0) return res.status(400).json({ error: 'No targets selected' });
  try {
    const token = await getGraphToken(tenantId, clientId, clientSecret);
    const results = [];
    for (const target of targets) {
      try {
        let driveId, label;
        if (target.type === 'sharepoint') {
          const drive = await graphGet(token, `https://graph.microsoft.com/v1.0/sites/${encodeURIComponent(target.id)}/drive`);
          driveId = drive.id; label = target.name;
        } else if (target.type === 'onedrive') {
          const drive = await graphGet(token, `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(target.id)}/drive`);
          driveId = drive.id; label = `OneDrive — ${target.name}`;
        }
        if (!driveId) continue;
        const scanResult = await scanDriveWithGraph(token, driveId);
        scanResult.name = label;
        scanResult.path = target.url || target.upn || label;
        results.push(scanResult);
      } catch (err) {
        console.error(`Failed to scan ${target.name}: ${err.message}`);
      }
    }
    if (results.length === 0) return res.status(500).json({ error: 'No targets could be scanned. Check permissions.' });
    const tree = mergeScans(results);
    const sizing = computeNDCSizing(tree.size, tree.fileCount, tree.ndcSize, tree.ndcCount, tree.ocrCount, tree.ocrPotentialCount);
    res.json({ tree, sizing, scanPaths: targets.map(t => t.name), deepScan: false, includeHidden: false });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = 3737;
app.listen(PORT, '127.0.0.1', () => {
  console.log('NDC Sizer running at http://localhost:' + PORT);
  const url = 'http://localhost:' + PORT;
  if (process.platform === 'win32') exec('start ' + url);
  else if (process.platform === 'darwin') exec('open ' + url);
  else exec('xdg-open ' + url);
});

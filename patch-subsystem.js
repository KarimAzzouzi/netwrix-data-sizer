#!/usr/bin/env node
// Patches dist/NDC-Sizer.exe PE header: CONSOLE subsystem (3) → WINDOWS subsystem (2)
// This hides the console window on double-click without affecting functionality.

const fs   = require('fs');
const path = require('path');

const exePath = path.join(__dirname, 'dist', 'NDC-Sizer.exe');
const buf = fs.readFileSync(exePath);

// IMAGE_DOS_HEADER.e_lfanew is at offset 0x3C — points to PE signature
const e_lfanew = buf.readUInt32LE(0x3C);
// IMAGE_OPTIONAL_HEADER.Subsystem is at PE_sig(4) + IMAGE_FILE_HEADER(20) + offset 68
const subsystemOffset = e_lfanew + 4 + 20 + 68;
const current = buf.readUInt16LE(subsystemOffset);

if (current === 3) {
  buf.writeUInt16LE(2, subsystemOffset);
  fs.writeFileSync(exePath, buf);
  console.log('patch-subsystem: CONSOLE → WINDOWS (console hidden)');
} else if (current === 2) {
  console.log('patch-subsystem: already WINDOWS subsystem');
} else {
  console.warn('patch-subsystem: unexpected subsystem value', current, '— skipping');
}

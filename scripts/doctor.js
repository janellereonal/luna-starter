#!/usr/bin/env node
// safety check-up from the terminal:   node scripts/doctor.js
// (luna also runs it from the 🦎 menu > safety check-up, with live info from the running app)
const fs = require('fs');
const path = require('path');
const doctor = require('../lib/doctor');
const root = path.join(__dirname, '..');
let prefs = {}; try { prefs = JSON.parse(fs.readFileSync(path.join(root, '.luna-prefs.json'), 'utf8')); } catch (_) {}
const fixed = doctor.fix(root);
console.log(doctor.report(doctor.audit(root, prefs)) + (fixed.length ? `\n✓ tightened permissions on: ${fixed.join(', ')}` : ''));

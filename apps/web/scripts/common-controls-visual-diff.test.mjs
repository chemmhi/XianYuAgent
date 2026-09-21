import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PNG } from 'pngjs';

import { comparePngFiles } from './common-controls-visual-diff.mjs';

function writePng(filePath, width, height, pixel) {
  const png = new PNG({ width, height });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = pixel[0];
    png.data[index + 1] = pixel[1];
    png.data[index + 2] = pixel[2];
    png.data[index + 3] = pixel[3] ?? 255;
  }
  writeFileSync(filePath, PNG.sync.write(png));
}

test('comparePngFiles reports exact match without changed pixels', () => {
  const directory = mkdtempSync(join(tmpdir(), 'common-controls-visual-diff-'));
  try {
    const baseline = join(directory, 'baseline.png');
    const implementation = join(directory, 'implementation.png');
    const diff = join(directory, 'diff.png');
    writePng(baseline, 2, 2, [245, 246, 247, 255]);
    writePng(implementation, 2, 2, [245, 246, 247, 255]);
    const result = comparePngFiles(baseline, implementation, diff, 16);
    assert.equal(result.dimensionsMatch, true);
    assert.equal(result.changedPixels, 0);
    assert.equal(result.exactChangedPixels, 0);
    assert.equal(result.diffBoundingBox, null);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('comparePngFiles applies the per-channel threshold and records a diff bbox', () => {
  const directory = mkdtempSync(join(tmpdir(), 'common-controls-visual-diff-'));
  try {
    const baseline = join(directory, 'baseline.png');
    const implementation = join(directory, 'implementation.png');
    const diff = join(directory, 'diff.png');
    const base = new PNG({ width: 2, height: 2 });
    const next = new PNG({ width: 2, height: 2 });
    for (let index = 0; index < base.data.length; index += 4) {
      base.data[index] = 245;
      base.data[index + 1] = 246;
      base.data[index + 2] = 247;
      base.data[index + 3] = 255;
      next.data[index] = 245;
      next.data[index + 1] = 246;
      next.data[index + 2] = 247;
      next.data[index + 3] = 255;
    }
    next.data[0] = 255;
    next.data[1] = 0;
    next.data[2] = 0;
    writeFileSync(baseline, PNG.sync.write(base));
    writeFileSync(implementation, PNG.sync.write(next));
    const result = comparePngFiles(baseline, implementation, diff, 16);
    assert.equal(result.changedPixels, 1);
    assert.equal(result.exactChangedPixels, 1);
    assert.deepEqual(result.diffBoundingBox, { x: 0, y: 0, width: 1, height: 1 });
    assert.equal(result.maxChannelDiff, 247);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('comparePngFiles flags dimension mismatches and counts extra pixels', () => {
  const directory = mkdtempSync(join(tmpdir(), 'common-controls-visual-diff-'));
  try {
    const baseline = join(directory, 'baseline.png');
    const implementation = join(directory, 'implementation.png');
    const diff = join(directory, 'diff.png');
    writePng(baseline, 1, 1, [245, 246, 247, 255]);
    writePng(implementation, 2, 1, [245, 246, 247, 255]);
    const result = comparePngFiles(baseline, implementation, diff, 16);
    assert.equal(result.dimensionsMatch, false);
    assert.equal(result.changedPixels, 1);
    assert.deepEqual(result.diffBoundingBox, { x: 1, y: 0, width: 1, height: 1 });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});


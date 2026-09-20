import { describe, expect, it } from 'vitest';
import { appendImageAttachments, clipboardImageFiles, fileIdentityKey, isImageFile } from './attachments';

function image(name: string, lastModified = 1): File {
  return new File([new Uint8Array([137, 80, 78, 71])], name, { type: 'image/png', lastModified });
}

describe('message image attachments', () => {
  it('accepts images and ignores non-image files', () => {
    const file = image('one.png');
    expect(isImageFile(file)).toBe(true);
    expect(isImageFile(new File(['text'], 'note.txt', { type: 'text/plain' }))).toBe(false);
    expect(isImageFile(null)).toBe(false);
  });

  it('appends multiple unique images without duplicating an existing file', () => {
    const first = image('one.png');
    const second = image('two.png');
    const urls: string[] = [];
    const attachments = appendImageAttachments([], [first, second, first], (file) => { const url = `blob:${file.name}`; urls.push(url); return url; }, (() => { let index = 0; return () => `attachment-${++index}`; })());
    const next = appendImageAttachments(attachments, [first, new File(['text'], 'note.txt', { type: 'text/plain' })], (file) => `blob:${file.name}`, () => 'unused');
    expect(attachments.map((item) => item.file.name)).toEqual(['one.png', 'two.png']);
    expect(attachments.map((item) => item.id)).toEqual(['attachment-1', 'attachment-2']);
    expect(urls).toEqual(['blob:one.png', 'blob:two.png']);
    expect(next).toEqual(attachments);
    expect(fileIdentityKey(first)).toBe(fileIdentityKey(image('one.png')));
  });

  it('prefers clipboard item files over the mirrored files list', () => {
    const file = image('paste.png');
    const data = {
      items: [{ kind: 'file', getAsFile: () => file }],
      files: [file],
    };
    expect(clipboardImageFiles(data)).toEqual([file]);
  });

  it('falls back to clipboard files when no file item is available', () => {
    const file = image('paste.png');
    expect(clipboardImageFiles({ items: [{ kind: 'string', getAsFile: () => null }], files: [file] })).toEqual([file]);
  });

  it('does not enqueue the same File object twice in one append', () => {
    const file = image('paste.png');
    const next = appendImageAttachments([], [file, file], (candidate) => `blob:${candidate.name}`, () => 'one');
    expect(next).toHaveLength(1);
  });

});

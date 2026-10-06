import { describe, expect, it, vi } from 'vitest';
import { appendWorkspaceAttachments, buildWorkspaceInstruction, clipboardImageFiles, workspaceAttachmentKind } from './attachments';

function file(name: string, type: string, content = '内容'): File {
  return new File([content], name, { type, lastModified: 1 });
}

describe('workspace attachments', () => {
  it('recognizes images and supported documents', () => {
    expect(workspaceAttachmentKind(file('截图.png', 'image/png'))).toBe('image');
    expect(workspaceAttachmentKind(file('说明.md', 'text/markdown'))).toBe('document');
    expect(workspaceAttachmentKind(file('未知.bin', 'application/octet-stream'))).toBeUndefined();
  });

  it('reads pasted clipboard images and de-duplicates uploaded files', () => {
    const image = file('截图.png', 'image/png');
    expect(clipboardImageFiles({ items: [{ kind: 'file', getAsFile: () => image }] })).toEqual([image]);
    const createUrl = vi.fn(() => 'blob:test');
    const createId = vi.fn(() => 'attachment-1');
    const first = appendWorkspaceAttachments([], [image, image], createUrl, createId);
    const second = appendWorkspaceAttachments(first, [image], createUrl, createId);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });

  it('includes text document content in the instruction context', async () => {
    const document = file('需求.txt', 'text/plain', '请保留这段内容');
    const attachments = appendWorkspaceAttachments([], [document], () => 'blob:doc', () => 'doc-1');
    await expect(buildWorkspaceInstruction('执行任务', attachments)).resolves.toContain('请保留这段内容');
  });
});

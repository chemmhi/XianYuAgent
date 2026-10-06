export type WorkspaceAttachmentKind = 'image' | 'document';

export interface WorkspaceAttachment {
  id: string;
  file: File;
  url: string;
  kind: WorkspaceAttachmentKind;
}

export interface WorkspaceAttachmentPayload {
  kind: WorkspaceAttachmentKind;
  name: string;
  mimeType: string;
  size: number;
  dataUrl?: string;
  textContent?: string;
}

const MAX_PI_ATTACHMENT_BYTES = 8 * 1024 * 1024;

const DOCUMENT_EXTENSIONS = new Set([
  'csv', 'doc', 'docx', 'json', 'log', 'md', 'pdf', 'ppt', 'pptx', 'rtf', 'txt', 'xls', 'xlsx', 'xml', 'yaml', 'yml',
]);

type ClipboardItemLike = { kind?: string; getAsFile?: () => File | null };
type ClipboardDataLike = { items?: ArrayLike<ClipboardItemLike>; files?: ArrayLike<File> };

function extensionOf(file: File): string {
  return file.name.split('.').pop()?.toLowerCase() ?? '';
}

export function workspaceAttachmentKind(file: File | null | undefined): WorkspaceAttachmentKind | undefined {
  if (!file) return undefined;
  if (file.type.startsWith('image/')) return 'image';
  if (DOCUMENT_EXTENSIONS.has(extensionOf(file)) || file.type.startsWith('text/') || file.type === 'application/pdf') return 'document';
  return undefined;
}

export function isWorkspaceAttachment(file: File | null | undefined): file is File {
  return Boolean(workspaceAttachmentKind(file));
}

export function clipboardImageFiles(data: ClipboardDataLike | null | undefined): File[] {
  const itemFiles = Array.from(data?.items ?? [], (item) => item?.kind === 'file' ? item.getAsFile?.() ?? null : null)
    .filter((file): file is File => Boolean(file?.type.startsWith('image/')));
  if (itemFiles.length > 0) return itemFiles;
  return Array.from(data?.files ?? []).filter((file) => file.type.startsWith('image/'));
}

export function fileIdentityKey(file: File): string {
  return [file.name, file.size, file.lastModified, file.type].join('\u0000');
}

export function appendWorkspaceAttachments(
  existing: WorkspaceAttachment[],
  files: readonly (File | null | undefined)[],
  createUrl: (file: File) => string = (file) => URL.createObjectURL(file),
  createId: () => string = () => globalThis.crypto?.randomUUID?.() ?? `workspace-file-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): WorkspaceAttachment[] {
  const knownFiles = new Set(existing.map((item) => fileIdentityKey(item.file)));
  const seenFiles = new Set<File>();
  const next = [...existing];
  for (const file of files) {
    const kind = workspaceAttachmentKind(file);
    if (!file || !kind || seenFiles.has(file)) continue;
    seenFiles.add(file);
    const key = fileIdentityKey(file);
    if (knownFiles.has(key)) continue;
    knownFiles.add(key);
    next.push({ id: createId(), file, url: createUrl(file), kind });
  }
  return next;
}

export function formatWorkspaceFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isTextDocument(file: File): boolean {
  return file.type.startsWith('text/') || ['csv', 'json', 'log', 'md', 'rtf', 'txt', 'xml', 'yaml', 'yml'].includes(extensionOf(file));
}

async function readFileAsDataUrl(file: File): Promise<string | undefined> {
  if (file.size > MAX_PI_ATTACHMENT_BYTES) return undefined;
  try {
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error ?? new Error('FILE_READ_FAILED'));
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('FILE_READ_FAILED'));
      reader.readAsDataURL(file);
    });
  } catch {
    return undefined;
  }
}

export async function buildWorkspaceAttachmentPayloads(attachments: WorkspaceAttachment[]): Promise<WorkspaceAttachmentPayload[]> {
  return Promise.all(attachments.map(async (attachment) => {
    const payload: WorkspaceAttachmentPayload = {
      kind: attachment.kind,
      name: attachment.file.name,
      mimeType: attachment.file.type || 'application/octet-stream',
      size: attachment.file.size,
    };
    if (attachment.kind === 'document' && isTextDocument(attachment.file)) {
      try { payload.textContent = (await attachment.file.text()).slice(0, 12_000); } catch { /* metadata remains usable */ }
    }
    const dataUrl = await readFileAsDataUrl(attachment.file);
    if (dataUrl) payload.dataUrl = dataUrl;
    return payload;
  }));
}

export async function buildWorkspaceInstruction(instruction: string, attachments: WorkspaceAttachment[]): Promise<string> {
  const text = instruction.trim();
  if (attachments.length === 0) return text;
  const details = await Promise.all(attachments.map(async (attachment) => {
    const label = `${attachment.file.name}（${attachment.file.type || '文件'}，${formatWorkspaceFileSize(attachment.file.size)}）`;
    if (attachment.kind === 'image') return `- 图片附件：${label}`;
    if (!isTextDocument(attachment.file)) return `- 文档附件：${label}`;
    try {
      const content = (await attachment.file.text()).slice(0, 12_000);
      return content ? `- 文档附件：${label}\n  内容：\n${content}` : `- 文档附件：${label}`;
    } catch {
      return `- 文档附件：${label}`;
    }
  }));
  return [text, '附件：', ...details].filter(Boolean).join('\n\n');
}

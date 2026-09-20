export interface PendingImageAttachment {
  id: string;
  file: File;
  url: string;
}

export function isImageFile(file: File | null | undefined): file is File {
  return Boolean(file && file.type.startsWith('image/'));
}

type ClipboardItemLike = { kind?: string; getAsFile?: () => File | null };
type ClipboardDataLike = { items?: ArrayLike<ClipboardItemLike>; files?: ArrayLike<File> };

/**
 * Browsers commonly expose the same pasted image through both `items` and
 * `files`. Prefer the item representation when it contains files, and only
 * fall back to `files` when items has no file payload, so one paste cannot
 * enqueue the same image twice.
 */
export function clipboardImageFiles(data: ClipboardDataLike | null | undefined): File[] {
  const itemFiles = Array.from(data?.items ?? [], (item) => item?.kind === 'file' ? item.getAsFile?.() ?? null : null).filter(isImageFile);
  if (itemFiles.length > 0) return itemFiles;
  return Array.from(data?.files ?? []).filter(isImageFile);
}

export function fileIdentityKey(file: File): string {
  return [file.name, file.size, file.lastModified, file.type].join('\u0000');
}

export function appendImageAttachments(
  existing: PendingImageAttachment[],
  files: readonly (File | null | undefined)[],
  createUrl: (file: File) => string = (file) => URL.createObjectURL(file),
  createId: () => string = () => globalThis.crypto?.randomUUID?.() ?? `image-${Date.now()}-${Math.random().toString(36).slice(2)}`,
): PendingImageAttachment[] {
  const knownFiles = new Set(existing.map((item) => fileIdentityKey(item.file)));
  const seenFiles = new Set<File>();
  const next = [...existing];
  for (const file of files) {
    if (!isImageFile(file)) continue;
    if (seenFiles.has(file)) continue;
    seenFiles.add(file);
    const key = fileIdentityKey(file);
    if (knownFiles.has(key)) continue;
    knownFiles.add(key);
    next.push({ id: createId(), file, url: createUrl(file) });
  }
  return next;
}

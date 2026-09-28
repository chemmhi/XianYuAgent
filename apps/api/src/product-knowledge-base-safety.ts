const MARKDOWN_LINK_PATTERN = /\[[^\]\r\n]{0,200}\]\(\s*(?:https?|ftp):\/\/[^)\s]+[^)]*\)/giu;
const URL_PATTERN = /(?:https?|ftp):\/\/[^\s<>"'`，。！？；：）)】\]]+/giu;
const HOST_PATTERN = /\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+){1,}(?:\/[^\s<>"'`，。！？；：）)】\]]*)?/giu;
const TORRENT_PATTERN = /\b(?:magnet:\?|ed2k:\/\/|thunder:\/\/)[^\s<>"'`，。！？；：）)】\]]+/giu;
const CREDENTIAL_PATTERN = /(?:提取码|提取密码|访问码|访问密码|分享密码|网盘密码|解压密码|验证码|口令|密码|pass(?:word|code)|access\s*code|extraction\s*code|share\s*code|verification\s*code)\s*(?:是|为|[:：=])?\s*[a-z0-9][a-z0-9._-]{1,63}/giu;
const PROVIDER_TOKEN_PATTERN = /(?:夸克(?:网盘)?|百度(?:网盘)?|阿里云盘|阿里盘|天翼云盘|115(?:网盘)?|迅雷云盘|google\s*drive|one\s*drive|onedrive|mega)\s*(?:分享|资源|链接|地址|口令|代码)?\s*[:：=]\s*[a-z0-9][a-z0-9._/-]{3,}/giu;
const EMPTY_DELIVERY_LABEL_PATTERN = /(?:提取码|提取密码|访问码|访问密码|分享密码|网盘密码|解压密码|验证码|口令|密码|分享链接|下载地址|网盘链接|资源链接|链接|地址)\s*[:：=]?\s*$/giu;
const EMPTY_PROVIDER_LABEL_PATTERN = /(?:夸克(?:网盘)?|百度(?:网盘)?|阿里云盘|阿里盘|天翼云盘|115(?:网盘)?|迅雷云盘|google\s*drive|one\s*drive|onedrive|mega)\s*(?:分享|资源|链接|地址)?\s*[:：=]?\s*$/giu;

/**
 * Removes delivery assets and credentials while preserving safe policy text.
 * This is intentionally used before model calls and again before persistence.
 */
export function sanitizeKnowledgeText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => sanitizeKnowledgeLine(line))
    .filter(Boolean)
    .join('\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function sanitizeKnowledgeLine(value: string): string {
  return value
    .replace(MARKDOWN_LINK_PATTERN, ' ')
    .replace(TORRENT_PATTERN, ' ')
    .replace(URL_PATTERN, ' ')
    .replace(HOST_PATTERN, ' ')
    .replace(CREDENTIAL_PATTERN, ' ')
    .replace(PROVIDER_TOKEN_PATTERN, ' ')
    .replace(EMPTY_DELIVERY_LABEL_PATTERN, ' ')
    .replace(EMPTY_PROVIDER_LABEL_PATTERN, ' ')
    .replace(/\s+([，。！？；：,.;!?])/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

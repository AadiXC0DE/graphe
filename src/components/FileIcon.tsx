import {
  TbBrandSass,
  TbFileCode2,
  TbFileTypeCss,
  TbFileTypeHtml,
  TbFileTypeJs,
  TbFileTypeJsx,
  TbFileTypePng,
  TbFileTypeSql,
  TbFileTypeSvg,
  TbFileTypeTs,
  TbFileTypeTsx,
  TbFileTypeVue,
  TbFileTypeXml,
  TbFileTypeZip,
  TbJson,
  TbLockAccess,
  TbMarkdown,
  TbPackage,
  TbSettings,
  TbSourceCode,
  TbTestPipe2,
} from 'react-icons/tb';
import type { IconType } from 'react-icons';

/** The small glyph beside a file name that says what kind of file it is, the
 *  way an editor's file tree does — a brace for JSON, a test flask for a spec,
 *  a pair of brackets for code. Tabler's stroke-weight and quiet line work
 *  with the app's own; each is drawn at currentColor so a tree reads as names
 *  with a faint marker, not icons. */
function extensionOf(name: string): string {
  const at = name.lastIndexOf('.');
  if (at <= 0) return '';
  return name.slice(at + 1).toLowerCase();
}

function iconFor(name: string): IconType {
  const ext = extensionOf(name);
  switch (ext) {
    case 'json':
    case 'jsonc':
    case 'json5':
      return TbJson;
    case 'html':
    case 'htm':
      return TbFileTypeHtml;
    case 'xml':
      return TbFileTypeXml;
    case 'svg':
      return TbFileTypeSvg;
    case 'md':
    case 'mdx':
    case 'markdown':
    case 'rst':
    case 'txt':
      return TbMarkdown;
    case 'ts':
    case 'mts':
    case 'cts':
      return TbFileTypeTs;
    case 'tsx':
      return TbFileTypeTsx;
    case 'js':
      return TbFileTypeJs;
    case 'jsx':
      return TbFileTypeJsx;
    case 'mjs':
    case 'cjs':
      return TbFileCode2;
    case 'vue':
    case 'svelte':
      return TbFileTypeVue;
    case 'css':
      return TbFileTypeCss;
    case 'scss':
    case 'sass':
    case 'less':
      return TbBrandSass;
    case 'png':
    case 'jpg':
    case 'jpeg':
    case 'gif':
    case 'webp':
    case 'avif':
      return TbFileTypePng;
    case 'sql':
      return TbFileTypeSql;
    case 'zip':
    case 'tar':
    case 'gz':
    case 'rar':
    case '7z':
      return TbFileTypeZip;
    case 'lock':
    case 'key':
    case 'pem':
    case 'cert':
      return TbLockAccess;
    case 'env':
    case 'toml':
    case 'yaml':
    case 'yml':
    case 'ini':
    case 'conf':
    case 'config':
      return TbSettings;
    case 'module':
    case 'map':
    case 'wasm':
      return TbPackage;
    default:
      /* Tests and specs earn their own flask before the catch-all code. */
      if (/(^|[-_.])(test|spec)s?\./.test(name)) return TbTestPipe2;
      return TbSourceCode;
  }
}

/** One 14px marker, kept to the size of a row's own text so it annotates the
 *  name rather than competing with it. */
export default function FileIcon({ name }: { name: string }) {
  const Icon = iconFor(name);
  return <Icon className="fileicon" size={14} strokeWidth={1.6} aria-hidden="true" />;
}

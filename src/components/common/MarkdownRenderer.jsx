import { useMemo } from 'react';
import { marked } from 'marked';

// Configure marked with GFM, line breaks, and smart typography
marked.setOptions({
  gfm: true,
  breaks: true,
  pedantic: false,
});

function openExternalLink(url) {
  if (!url) return;
  try {
    if (typeof window !== 'undefined' && window.launcher?.openExternal) {
      window.launcher.openExternal(url);
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}

const ALLOWED_TAGS = new Set([
  'A', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DETAILS', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'HR', 'IFRAME', 'IMG', 'LI', 'OL', 'P', 'PRE', 'SPAN', 'STRONG', 'SUMMARY', 'TABLE', 'TBODY', 'TD',
  'TH', 'THEAD', 'TR', 'UL',
]);
const DROP_WITH_CONTENT_TAGS = new Set(['SCRIPT', 'STYLE', 'OBJECT', 'EMBED', 'FORM', 'INPUT', 'BUTTON', 'META', 'LINK']);

function safeWebUrl(value, { allowMailto = false, allowDataImage = false } = {}) {
  const raw = String(value || '').trim();
  if (allowDataImage && /^data:image\/(?:png|jpeg|jpg|webp|gif);base64,/i.test(raw)) return raw;
  try {
    const parsed = new URL(raw, 'https://modrinth.com');
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return parsed.href;
    if (allowMailto && parsed.protocol === 'mailto:') return parsed.href;
  } catch { }
  return '';
}

export function sanitizeRichHtml(rawHtml) {
  if (typeof DOMParser === 'undefined') return '';
  const documentNode = new DOMParser().parseFromString(String(rawHtml || ''), 'text/html');
  const elements = [...documentNode.body.querySelectorAll('*')];

  for (const element of elements) {
    if (DROP_WITH_CONTENT_TAGS.has(element.tagName)) {
      element.remove();
      continue;
    }
    if (!ALLOWED_TAGS.has(element.tagName)) {
      element.replaceWith(...element.childNodes);
      continue;
    }

    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || !['href', 'src', 'alt', 'title', 'class', 'colspan', 'rowspan', 'allow', 'allowfullscreen'].includes(name)) {
        element.removeAttribute(attribute.name);
      }
    }

    if (element.tagName === 'A') {
      const safeHref = safeWebUrl(element.getAttribute('href'), { allowMailto: true });
      if (safeHref) element.setAttribute('href', safeHref);
      else element.removeAttribute('href');
    }
    if (element.tagName === 'IMG') {
      const safeSrc = safeWebUrl(element.getAttribute('src'), { allowDataImage: true });
      if (safeSrc) element.setAttribute('src', safeSrc);
      else element.remove();
    }
    if (element.tagName === 'IFRAME') {
      const safeSrc = safeWebUrl(element.getAttribute('src'));
      let allowed = false;
      try {
        const host = new URL(safeSrc).hostname.toLowerCase();
        allowed = host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com');
      } catch { }
      if (!allowed) element.remove();
      else element.setAttribute('src', safeSrc);
    }
  }

  return documentNode.body.innerHTML;
}

export function parseModrinthUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const cleanUrl = url.trim();

  // Match absolute and relative Modrinth URLs:
  // e.g. https://modrinth.com/mod/creativecore
  // /mod/creativecore
  // https://modrinth.com/mod/creativecore/versions
  // https://www.modrinth.com/shader/complementary-unbound
  const match = cleanUrl.match(/(?:(?:https?:\/\/)?(?:www\.)?modrinth\.com)?\/?(mod|shader|resourcepack|datapack|plugin|project)\/([a-zA-Z0-9_-]+)/i);
  if (match) {
    const rawType = match[1].toLowerCase();
    const slug = match[2].toLowerCase();
    let projectType = 'mod';
    if (rawType === 'shader') projectType = 'shader';
    else if (rawType === 'resourcepack') projectType = 'resourcepack';
    return {
      slug,
      projectType,
      url: cleanUrl,
    };
  }
  return null;
}

export function MarkdownRenderer({ content, className = '', onNavigateModrinth = null }) {
  const html = useMemo(() => {
    if (!content || typeof content !== 'string') return '';

    try {
      // 1. Preprocess comments and common Modrinth formatting quirks
      let processed = content
        .replace(/<!--[\s\S]*?-->/g, '') // remove comments
        .replace(/<iframe\s+([^>]*?)src=["']([^"']+)["']([^>]*?)><\/iframe>/gi, (match, before, src, after) => {
          const embedSrc = src.replace('watch?v=', 'embed/');
          return `<div class="md-video-container"><iframe ${before}src="${embedSrc}"${after} frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe></div>`;
        });

      // 2. Parse using marked
      const parsed = marked.parse(processed);
      return sanitizeRichHtml(parsed);
    } catch (e) {
      console.warn('Failed to parse markdown:', e);
      return '';
    }
  }, [content]);

  if (!html) return null;

  const handleClick = (e) => {
    const link = e.target.closest('a');
    if (link) {
      const href = link.getAttribute('href') || link.href;
      if (!href) return;

      const modrinthInfo = parseModrinthUrl(href);
      if (modrinthInfo && typeof onNavigateModrinth === 'function') {
        e.preventDefault();
        e.stopPropagation();
        onNavigateModrinth(modrinthInfo);
        return;
      }

      if (href.startsWith('http://') || href.startsWith('https://') || href.startsWith('mailto:')) {
        e.preventDefault();
        e.stopPropagation();
        openExternalLink(href);
      }
    }
  };

  return (
    <div
      className={`markdown-renderer-root ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}

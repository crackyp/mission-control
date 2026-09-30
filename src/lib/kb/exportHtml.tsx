import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// Self-contained stylesheet so the downloaded file looks like the UI's
// rendered wiki view without depending on Tailwind or any external CSS.
const STYLES = `
  :root { color-scheme: light; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    line-height: 1.7;
    color: #1e293b;
    background: #ffffff;
    max-width: 820px;
    margin: 0 auto;
    padding: 48px 24px 96px;
  }
  h1, h2, h3, h4 { color: #0f172a; font-weight: 600; line-height: 1.3; margin-top: 1.8em; margin-bottom: 0.6em; }
  h1 { font-size: 2em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
  h2 { font-size: 1.5em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
  h3 { font-size: 1.25em; }
  p, ul, ol, blockquote, table { margin: 0.8em 0; }
  a { color: #2563eb; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code {
    background: #f1f5f9;
    padding: 0.15em 0.4em;
    border-radius: 4px;
    font-size: 0.9em;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  }
  pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
  }
  pre code { background: none; padding: 0; }
  blockquote {
    border-left: 4px solid #cbd5e1;
    margin-left: 0;
    padding-left: 1em;
    color: #475569;
  }
  table { border-collapse: collapse; width: 100%; }
  th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
  th { background: #f8fafc; }
  img { max-width: 100%; }
  hr { border: none; border-top: 1px solid #e2e8f0; margin: 2em 0; }
`;

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Render markdown to a self-contained, styled HTML document and trigger a
 * browser download. Uses the same react-markdown + remark-gfm pipeline as the
 * Explorer preview so the output matches what the user sees on screen.
 */
export function downloadWikiHtml(title: string, baseName: string, markdown: string): void {
  const body = renderToStaticMarkup(
    <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
  );

  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLES}</style>
</head>
<body>
${body}
</body>
</html>`;

  const blob = new Blob([doc], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = baseName.replace(/\.md$/i, "") + ".html";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

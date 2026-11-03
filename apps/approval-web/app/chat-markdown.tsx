import Markdown, { defaultUrlTransform, type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

function safeChatLink(value: string): string {
  const url = defaultUrlTransform(value);
  if (!url || /[\u0000-\u0020\\]/.test(url)) return "";
  if (url.startsWith("#") || /^\/(?!\/)/.test(url)) return url;
  try {
    const parsed = new URL(url);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : "";
  } catch { return ""; }
}

const components: Components = {
  h1: ({ children }) => <h3>{children}</h3>,
  h2: ({ children }) => <h3>{children}</h3>,
  h3: ({ children }) => <h4>{children}</h4>,
  h4: ({ children }) => <h4>{children}</h4>,
  h5: ({ children }) => <h4>{children}</h4>,
  h6: ({ children }) => <h4>{children}</h4>,
  a: ({ href, children }) => {
    if (!href) return <span>{children}</span>;
    const external = /^https?:\/\//.test(href);
    return <a href={href} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>{children}</a>;
  },
  table: ({ children }) => <div className="chat-table-wrap" role="region" aria-label="Table in this reply" tabIndex={0}><table>{children}</table></div>,
  th: ({ children, style }) => <th scope="col" style={style}>{children}</th>,
};

export default function ChatMarkdown({ content }: { content: string }) {
  return <div className="chat-markdown"><Markdown remarkPlugins={[remarkGfm]} components={components} skipHtml disallowedElements={["img"]} urlTransform={safeChatLink}>{content}</Markdown></div>;
}

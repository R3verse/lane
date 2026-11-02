(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.LaneFormat = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // Deliberately small Markdown dialect. User HTML, links and images are always text.
  function inline(text, html) {
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
    let out = '', offset = 0;
    for (const match of text.matchAll(pattern)) {
      out += html ? escape(text.slice(offset, match.index)) : text.slice(offset, match.index);
      const raw = match[0], n = raw.startsWith('**') ? 2 : 1;
      const value = raw.slice(n, -n), tag = raw[0] === '`' ? 'code' : n === 2 ? 'strong' : 'em';
      out += html ? `<${tag}>${escape(value)}</${tag}>` : value;
      offset = match.index + raw.length;
    }
    return out + (html ? escape(text.slice(offset)) : text.slice(offset));
  }
  function format(text, mode, html) {
    if (mode !== 'markdown') return html ? `<div class="message-plain">${escape(text)}</div>` : text;
    let fenced = false;
    const lines = text.replace(/\r\n/g, '\n').split('\n'), output = [];
    for (const line of lines) {
      if (/^```/.test(line)) { fenced = !fenced; if (html) output.push(fenced ? '<pre><code>' : '</code></pre>'); continue; }
      if (fenced) { output.push(html ? escape(line) + '\n' : line); continue; }
      const heading = line.match(/^(#{1,3}) (.*)$/), quote = line.match(/^> (.*)$/), bullet = line.match(/^[-*] (.*)$/);
      const content = inline(heading ? heading[2] : quote ? quote[1] : bullet ? bullet[1] : line, html);
      if (!html) { output.push((bullet ? '• ' : '') + content); continue; }
      output.push(heading ? `<h${heading[1].length + 2}>${content}</h${heading[1].length + 2}>` : quote ? `<blockquote>${content}</blockquote>` : bullet ? `<div class="message-bullet">• ${content}</div>` : `<div>${content || '<br>'}</div>`);
    }
    if (fenced && html) output.push('</code></pre>');
    return output.join(html ? '' : '\n');
  }
  return { escape, html: (text, mode) => format(text, mode, true), plain: (text, mode) => format(text, mode, false) };
});

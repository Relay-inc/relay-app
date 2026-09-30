// A mail as the UI shows it: the HTML sanitized into a srcdoc document for a sandboxed iframe (no scripts, and
// the CSP blocks every remote load, so no tracking pixels), and the text Claude reads.

use mail_parser::{Message, MimeHeaders};
use std::collections::HashMap;

pub const TEXT_MAX: usize = 100_000;
const CID_MAX: usize = 5 * 1024 * 1024;
const HEAD: &str = concat!(
    r#"<!doctype html><html><head><meta charset="utf-8">"#,
    r#"<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">"#,
    r#"<meta name="referrer" content="no-referrer">"#,
    "<style>body{font:14px -apple-system,system-ui,sans-serif;margin:0;padding:12px;color:#1d1d1f;background:#fff;overflow-wrap:anywhere}img{max-width:100%;height:auto}</style></head><body>",
);

pub fn cap(s: &str, n: usize) -> String { s.chars().take(n).collect() }

/// The text bodies, mail-parser converts the HTML when there is no text part.
pub fn text(m: &Message) -> String {
    let t: Vec<_> = (0..m.text_body_count()).filter_map(|i| m.body_text(i)).collect();
    cap(&t.join("\n"), TEXT_MAX)
}

/// The srcdoc document, None when the mail has no text/html part.
pub fn html(m: &Message) -> Option<String> {
    if !m.html_bodies().any(|p| p.is_text_html()) { return None; }
    let raw: String = (0..m.html_body_count()).filter_map(|i| m.body_html(i)).collect();
    let cids: HashMap<&str, String> = m.parts.iter().filter_map(|p| {
        let ct = p.content_type()?;
        let sub = ct.subtype()?;
        let ok = ct.ctype().eq_ignore_ascii_case("image") && p.len() <= CID_MAX
            && sub.chars().all(|c| c.is_ascii_alphanumeric() || "+-.".contains(c));
        if !ok { return None; }
        Some((p.content_id()?, format!("data:image/{};base64,{}", sub.to_ascii_lowercase(), b64(p.contents()))))
    }).collect();
    Some(format!("{HEAD}{}</body></html>", inline_cids(&sanitize(&raw), &cids)))
}

pub fn sanitize(html: &str) -> String {
    let mut b = ammonia::Builder::default();
    b.add_tags(["style", "font", "center"]).rm_clean_content_tags(["style"])
        .add_generic_attributes(["style", "class", "align", "valign", "bgcolor", "width", "height", "border", "cellpadding", "cellspacing", "color", "dir"])
        .url_schemes(["http", "https", "mailto", "cid", "data"].into())
        .link_rel(Some("noopener noreferrer"))
        // data: and cid: are for images, a link to a data: document would open mail-made HTML in the frame
        .attribute_filter(|_, attr, v| {
            let lv = v.trim_start().to_ascii_lowercase();
            (!(attr == "href" && (lv.starts_with("data:") || lv.starts_with("cid:")))).then(|| v.into())
        });
    b.clean(html).to_string()
}

/// `src="cid:X"` to the data URI of the part with Content-ID X. Runs on ammonia's output, which always
/// double-quotes attributes, and only inserts base64 plus a checked mime type.
// ponytail: exact Content-ID match only, percent-encoded or HTML-escaped cid references stay broken images
fn inline_cids(html: &str, cids: &HashMap<&str, String>) -> String {
    let mut out = String::with_capacity(html.len());
    let mut rest = html;
    while let Some(i) = rest.find(r#"src="cid:"#) {
        let (head, tail) = rest.split_at(i + 9);
        let Some(end) = tail.find('"') else { break };
        match cids.get(&tail[..end]) {
            Some(uri) => { out.push_str(&head[..i]); out.push_str(r#"src=""#); out.push_str(uri); }
            None => { out.push_str(head); out.push_str(&tail[..end]); }
        }
        rest = &tail[end..];
    }
    out.push_str(rest);
    out
}

fn b64(data: &[u8]) -> String {
    const A: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(data.len().div_ceil(3) * 4);
    for c in data.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        for k in 0..4 { s.push(if k <= c.len() { A[(n >> (18 - 6 * k) & 63) as usize] as char } else { '=' }); }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hostile_html_is_neutered() {
        let evil = r#"<script>alert(1)</script><img src=x onerror="alert(2)">
            <a href="javascript:alert(3)">a</a><a href="java&#115;cript:alert(4)">b</a>
            <svg><a xlink:href="javascript:alert(5)"><text>c</text></a></svg>
            <meta http-equiv="refresh" content="0;url=https://evil"><base href="https://evil/">
            <form action="https://evil"><input name=p></form><iframe src="https://evil"></iframe>
            <object data="https://evil"></object><link rel=stylesheet href="https://evil/x.css">
            <img src="https://track.example/p.gif"><a href="https://ok.example" target="_blank">ok</a>
            <style>p{color:red}</style><font color="red">f</font><a href="data:text/html,<b>x</b>">d</a>"#;
        let s = sanitize(evil).to_ascii_lowercase();
        for bad in ["data:text", "<script", "onerror", "javascript", "<svg", "xlink", "<meta", "<base", "<form", "<input", "<iframe", "<object", "<link", "target=", "alert(1)"] {
            assert!(!s.contains(bad), "{bad} survived: {s}");
        }
        assert!(s.contains(r#"<img src="https://track.example/p.gif">"#)); // allowed in markup, the CSP blocks it
        assert!(s.contains(r#"rel="noopener noreferrer""#));
        assert!(s.contains("<style>p{color:red}</style>") && s.contains(r#"<font color="red">"#));
    }

    #[test]
    fn csp_comes_before_the_mail() {
        let raw = "Content-Type: text/html\r\n\r\n<head><meta http-equiv=\"Content-Security-Policy\" content=\"default-src *\"></head><p>hi</p>";
        let m = mail_parser::MessageParser::default().parse(raw.as_bytes()).unwrap();
        let doc = html(&m).unwrap();
        let head = &doc[..doc.find("</head>").unwrap()];
        assert!(doc.starts_with(r#"<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:;"#));
        assert_eq!(head.matches("<meta").count(), 3);
        assert_eq!(doc.matches("Content-Security-Policy").count(), 1);
        assert!(doc.ends_with("<p>hi</p></body></html>"));
    }

    #[test]
    fn cid_images_inline() {
        let raw = "Content-Type: multipart/related; boundary=b\r\n\r\n--b\r\nContent-Type: text/html\r\n\r\n<img src=\"cid:logo@x\"><img src=\"cid:none\">\r\n--b\r\nContent-Type: image/png\r\nContent-ID: <logo@x>\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n--b--\r\n";
        let m = mail_parser::MessageParser::default().parse(raw.as_bytes()).unwrap();
        let doc = html(&m).unwrap();
        assert!(doc.contains(r#"<img src="data:image/png;base64,aGVsbG8=">"#), "{doc}");
        assert!(doc.contains(r#"<img src="cid:none">"#));
        assert!(text(&m).is_empty() || !text(&m).contains("<img"));
        assert_eq!(b64(b"a"), "YQ==");
        assert_eq!(b64(b"ab"), "YWI=");
    }

    #[test]
    fn plain_mail_has_no_html() {
        let m = mail_parser::MessageParser::default().parse(b"Subject: x\r\n\r\nhello").unwrap();
        assert!(html(&m).is_none());
        assert_eq!(text(&m), "hello");
    }
}

//! Native HTTP transport for AI requests (AI-01).
//!
//! The webview's `fetch` runs from origin `https://tauri.localhost`, so every
//! call to an AI endpoint is cross-origin and most OpenAI-compatible servers
//! fail the CORS preflight the browser requires (curl has no CORS, hence
//! "works in curl but not in the app"); plain-http LAN endpoints are
//! additionally blocked by the CSP. Routing the request through reqwest here
//! gives curl parity: anything curl can reach, the AI panel can reach.
//!
//! Responses are streamed back to the frontend over a `Channel` as whole
//! lines, so the existing SSE parsing there keeps working unchanged.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use futures_util::StreamExt;
use tauri::ipc::Channel;

#[derive(Clone, serde::Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum AiEvent {
    Status { status: u16 },
    Chunk { data: String },
    Done,
}

/// In-flight request cancellation handles, keyed by the frontend-chosen
/// request id. Firing (or dropping) a sender aborts that request's
/// `tokio::select!` below.
#[derive(Default)]
pub struct AiCancel(Mutex<HashMap<u32, tokio::sync::oneshot::Sender<()>>>);

/// One shared client so connection pools / TLS sessions are reused across
/// requests instead of being rebuilt per call.
fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(reqwest::Client::new)
}

/// Split off every complete line in `buf` (up to and including the last
/// `\n`), leaving any trailing partial line buffered. Forwarding only whole
/// lines means the frontend's line-oriented SSE parser never sees a JSON
/// payload cut mid-way. `from_utf8_lossy` is safe here: `\n` is ASCII, so a
/// multi-byte UTF-8 character can never straddle the split point.
fn take_complete_lines(buf: &mut Vec<u8>) -> Option<String> {
    let cut = buf.iter().rposition(|&b| b == b'\n')? + 1;
    let complete: Vec<u8> = buf.drain(..cut).collect();
    Some(String::from_utf8_lossy(&complete).into_owned())
}

/// Drain whatever is left after the stream ends (a body with no trailing
/// newline, e.g. a non-streamed JSON response).
fn flush_remainder(buf: &mut Vec<u8>) -> Option<String> {
    if buf.is_empty() {
        return None;
    }
    let rest = std::mem::take(buf);
    Some(String::from_utf8_lossy(&rest).into_owned())
}

/// The request proper: send, report the status, stream the body line-wise.
/// Non-2xx statuses are NOT errors here — the body still streams so the
/// frontend can map the status + body snippet to its existing messages.
async fn run_request(
    endpoint: &str,
    api_key: Option<String>,
    body: String,
    connect_timeout_ms: u64,
    total_timeout_ms: Option<u64>,
    channel: &Channel<AiEvent>,
) -> Result<(), String> {
    let fut = async {
        let mut req = client()
            .post(endpoint)
            .header("Content-Type", "application/json")
            .body(body);
        if let Some(key) = api_key.filter(|k| !k.is_empty()) {
            req = req.header("Authorization", format!("Bearer {key}"));
        }

        // The connect timeout guards until the response HEADERS arrive; a slow
        // generation after that is legitimate and must not be cut off.
        let resp = tokio::time::timeout(Duration::from_millis(connect_timeout_ms), req.send())
            .await
            .map_err(|_| "timed out".to_string())?
            .map_err(|e| format!("Could not reach the AI endpoint: {e}"))?;

        let _ = channel.send(AiEvent::Status {
            status: resp.status().as_u16(),
        });

        let mut stream = resp.bytes_stream();
        let mut buf: Vec<u8> = Vec::new();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| format!("AI response stream failed: {e}"))?;
            buf.extend_from_slice(&chunk);
            if let Some(lines) = take_complete_lines(&mut buf) {
                let _ = channel.send(AiEvent::Chunk { data: lines });
            }
        }
        if let Some(rest) = flush_remainder(&mut buf) {
            let _ = channel.send(AiEvent::Chunk { data: rest });
        }
        let _ = channel.send(AiEvent::Done);
        Ok(())
    };

    match total_timeout_ms {
        Some(total) => tokio::time::timeout(Duration::from_millis(total), fut)
            .await
            .map_err(|_| "timed out".to_string())?,
        None => fut.await,
    }
}

/// True when this URL may carry an API key: either it is https, or its host is
/// loopback so nothing reaches a network. `IpAddr::is_loopback` covers all of
/// 127.0.0.0/8 and `::1`; `*.localhost` is reserved as loopback by RFC 6761.
fn endpoint_is_key_safe(url: &reqwest::Url) -> bool {
    if url.scheme() == "https" {
        return true;
    }
    let Some(host) = url.host_str() else {
        return false;
    };
    let host = host.trim_start_matches('[').trim_end_matches(']').to_ascii_lowercase();
    if host == "localhost" || host.ends_with(".localhost") {
        return true;
    }
    host.parse::<std::net::IpAddr>().is_ok_and(|ip| ip.is_loopback())
}

// The parameter list mirrors the IPC contract with aiTransport.ts one-to-one;
// bundling them into a struct would only move the same eight fields around.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
pub async fn ai_request(
    state: tauri::State<'_, AiCancel>,
    id: u32,
    endpoint: String,
    api_key: Option<String>,
    body: String,
    connect_timeout_ms: u64,
    total_timeout_ms: Option<u64>,
    channel: Channel<AiEvent>,
) -> Result<(), String> {
    // The frontend validates too, but the endpoint is user-configured input
    // crossing a trust boundary — re-check here (defense in depth).
    let parsed = reqwest::Url::parse(&endpoint).ok();
    let valid = parsed
        .as_ref()
        .is_some_and(|u| matches!(u.scheme(), "http" | "https"));
    if !valid {
        return Err("AI endpoint must be a valid http:// or https:// URL.".to_string());
    }

    // A credential must never cross a network unencrypted. Keyless plain-http
    // stays allowed so a local model server on the LAN keeps working (AI-01
    // exists precisely to support those); it is the key that needs TLS.
    // This is the real enforcement point — the frontend check is only UX.
    // SECURITY, issue #91 item 3.
    let has_key = api_key.as_deref().is_some_and(|k| !k.is_empty());
    if has_key && parsed.as_ref().is_some_and(|u| !endpoint_is_key_safe(u)) {
        return Err(
            "Refusing to send your API key unencrypted to a remote host. Use an https:// \
             endpoint, or clear the API key if this server does not need one."
                .to_string(),
        );
    }

    let (cancel_tx, cancel_rx) = tokio::sync::oneshot::channel::<()>();
    state.0.lock().unwrap().insert(id, cancel_tx);

    // "cancelled" is a contract with the frontend transport: it maps exactly
    // that string to an AbortError so a user cancel isn't shown as a failure.
    let result = tokio::select! {
        _ = cancel_rx => Err("cancelled".to_string()),
        r = run_request(&endpoint, api_key, body, connect_timeout_ms, total_timeout_ms, &channel) => r,
    };

    // Single removal point: the select above is the only way out of the
    // request, so this covers success, error, timeout, and cancellation.
    state.0.lock().unwrap().remove(&id);
    result
}

#[tauri::command]
pub async fn ai_cancel(state: tauri::State<'_, AiCancel>, id: u32) -> Result<(), String> {
    // A missing id just means the request already finished — races are fine.
    if let Some(tx) = state.0.lock().unwrap().remove(&id) {
        let _ = tx.send(());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{endpoint_is_key_safe, flush_remainder, take_complete_lines};

    fn key_safe(url: &str) -> bool {
        endpoint_is_key_safe(&reqwest::Url::parse(url).expect("test url must parse"))
    }

    #[test]
    fn https_may_always_carry_a_key() {
        assert!(key_safe("https://api.openai.com/v1/chat/completions"));
        assert!(key_safe("https://192.168.1.50/v1/chat/completions"));
    }

    #[test]
    fn plain_http_to_loopback_may_carry_a_key() {
        assert!(key_safe("http://localhost:1234/v1/chat/completions"));
        assert!(key_safe("http://127.0.0.1:11434/v1/chat/completions"));
        // All of 127.0.0.0/8 is loopback, not just .0.1.
        assert!(key_safe("http://127.1.2.3:11434/v1"));
        assert!(key_safe("http://[::1]:11434/v1"));
        // RFC 6761 reserves *.localhost as loopback.
        assert!(key_safe("http://ollama.localhost:11434/v1"));
    }

    #[test]
    fn plain_http_off_box_must_not_carry_a_key() {
        assert!(!key_safe("http://192.168.1.50:11434/v1/chat/completions"));
        assert!(!key_safe("http://api.openai.com/v1/chat/completions"));
        assert!(!key_safe("http://10.0.0.7/v1"));
        // Not loopback despite looking local-ish.
        assert!(!key_safe("http://0.0.0.0:11434/v1"));
        assert!(!key_safe("http://localhost.evil.com/v1"));
    }

    #[test]
    fn no_newline_returns_none_and_keeps_buffer() {
        let mut buf = b"partial line".to_vec();
        assert_eq!(take_complete_lines(&mut buf), None);
        assert_eq!(buf, b"partial line");
    }

    #[test]
    fn splits_complete_lines_from_trailing_partial() {
        let mut buf = b"data: one\ndata: two\ndata: thr".to_vec();
        assert_eq!(
            take_complete_lines(&mut buf),
            Some("data: one\ndata: two\n".to_string())
        );
        assert_eq!(buf, b"data: thr");
    }

    #[test]
    fn multibyte_char_split_across_chunks_survives() {
        // "é" is 0xC3 0xA9; a network chunk boundary can fall between the two
        // bytes. The partial byte must stay buffered (no lossy replacement)
        // until its line completes.
        let mut buf = b"line one\n\xC3".to_vec();
        assert_eq!(take_complete_lines(&mut buf), Some("line one\n".to_string()));
        assert_eq!(buf, b"\xC3");

        buf.extend_from_slice(b"\xA9 end\n");
        assert_eq!(take_complete_lines(&mut buf), Some("é end\n".to_string()));
        assert!(buf.is_empty());
    }

    #[test]
    fn flush_returns_remainder_once() {
        let mut buf = b"{\"no\":\"newline\"}".to_vec();
        assert_eq!(
            flush_remainder(&mut buf),
            Some("{\"no\":\"newline\"}".to_string())
        );
        assert!(buf.is_empty());
        assert_eq!(flush_remainder(&mut buf), None);
    }
}

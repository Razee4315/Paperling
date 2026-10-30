//! Decoding and re-encoding of document bytes.
//!
//! `read_to_string` refused anything that wasn't UTF-8, so PowerShell 5 `>`
//! output, Notepad's "Unicode" and old Windows-1252 notes failed with an error
//! instead of opening. Documents are now read as bytes and decoded here, and
//! the encoding travels with the document so a save writes the same bytes
//! back. ENC-02.
//!
//! Every path here refuses rather than guesses when text could be lost:
//! decoding is strict (U+FFFD in the editor would be saved over the original
//! bytes), and an unmappable character is an error for the caller to resolve,
//! never a substitution.

use encoding_rs::{Encoding, UTF_16BE, UTF_16LE, WINDOWS_1252};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;

const UTF_8_BOM: [u8; 3] = [0xEF, 0xBB, 0xBF];
const UTF_16LE_BOM: [u8; 2] = [0xFF, 0xFE];
const UTF_16BE_BOM: [u8; 2] = [0xFE, 0xFF];
/// Starts with the UTF-16 LE BOM, so it has to be ruled out first.
const UTF_32LE_BOM: [u8; 4] = [0xFF, 0xFE, 0x00, 0x00];

/// How a document is stored on disk. Keep the names in step with FileEncoding
/// in src/utils/fileIO.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TextEncoding {
    #[serde(rename = "utf-8")]
    Utf8,
    #[serde(rename = "utf-8-bom")]
    Utf8Bom,
    #[serde(rename = "utf-16le")]
    Utf16Le,
    #[serde(rename = "utf-16be")]
    Utf16Be,
    #[serde(rename = "windows-1252")]
    Windows1252,
}

impl TextEncoding {
    /// The wire name, for error messages the frontend parses.
    pub fn name(self) -> &'static str {
        match self {
            TextEncoding::Utf8 => "utf-8",
            TextEncoding::Utf8Bom => "utf-8-bom",
            TextEncoding::Utf16Le => "utf-16le",
            TextEncoding::Utf16Be => "utf-16be",
            TextEncoding::Windows1252 => "windows-1252",
        }
    }
}

/// Decode a document, returning its text and how it was stored. A UTF-8 BOM
/// stays in the text (fileIO.ts strips and restores it, ENC-01); a UTF-16 BOM
/// does not, so `encode_text` always writes one back.
///
/// Windows-1252 is the fallback because it maps every byte: it can show the
/// wrong letters for another legacy encoding, but it cannot lose one, and
/// saving writes the same bytes back. That is also why it needs the NUL check:
/// without it every binary file would "open" as text.
pub fn decode_text(bytes: Vec<u8>) -> Result<(String, TextEncoding), String> {
    if bytes.starts_with(&UTF_32LE_BOM) {
        return Err("it is UTF-32, which Paperling cannot open".to_string());
    }
    if let Some(body) = bytes.strip_prefix(&UTF_16LE_BOM) {
        return decode_utf16(UTF_16LE, body).map(|text| (text, TextEncoding::Utf16Le));
    }
    if let Some(body) = bytes.strip_prefix(&UTF_16BE_BOM) {
        return decode_utf16(UTF_16BE, body).map(|text| (text, TextEncoding::Utf16Be));
    }

    let has_bom = bytes.starts_with(&UTF_8_BOM);
    let bytes = match String::from_utf8(bytes) {
        Ok(text) => {
            let encoding = if has_bom {
                TextEncoding::Utf8Bom
            } else {
                TextEncoding::Utf8
            };
            return Ok((text, encoding));
        }
        Err(invalid) => invalid.into_bytes(),
    };
    if has_bom {
        return Err("it is marked as UTF-8 but its contents are damaged".to_string());
    }
    if bytes.contains(&0) {
        return Err("it looks like a binary file, not text".to_string());
    }
    let (text, _) = WINDOWS_1252.decode_without_bom_handling(&bytes);
    Ok((text.into_owned(), TextEncoding::Windows1252))
}

/// Strict on purpose: a lone surrogate or a stray trailing byte has no text
/// form, so opening the file would change it on the next save.
fn decode_utf16(encoding: &'static Encoding, body: &[u8]) -> Result<String, String> {
    encoding
        .decode_without_bom_handling_and_without_replacement(body)
        .map(Cow::into_owned)
        .ok_or_else(|| "it is marked as UTF-16 but its contents are damaged".to_string())
}

/// Encode text for disk. Err carries the first character `encoding` cannot
/// store: nothing has been written, and the caller decides what happens next.
/// ENC-03 / ENC-04.
pub fn encode_text(text: String, encoding: TextEncoding) -> Result<Vec<u8>, char> {
    match encoding {
        TextEncoding::Utf8 => Ok(text.into_bytes()),
        TextEncoding::Utf8Bom if text.starts_with('\u{FEFF}') => Ok(text.into_bytes()),
        TextEncoding::Utf8Bom => {
            let mut out = Vec::with_capacity(UTF_8_BOM.len() + text.len());
            out.extend_from_slice(&UTF_8_BOM);
            out.extend_from_slice(text.as_bytes());
            Ok(out)
        }
        TextEncoding::Utf16Le => Ok(encode_utf16(&text, UTF_16LE_BOM, u16::to_le_bytes)),
        TextEncoding::Utf16Be => Ok(encode_utf16(&text, UTF_16BE_BOM, u16::to_be_bytes)),
        TextEncoding::Windows1252 => encode_windows_1252(&text),
    }
}

/// Hand-written because encoding_rs has no UTF-16 encoder: `UTF_16LE.encode`
/// quietly produces UTF-8.
fn encode_utf16(text: &str, bom: [u8; 2], unit_bytes: fn(u16) -> [u8; 2]) -> Vec<u8> {
    let mut out = Vec::with_capacity(bom.len() + text.len() * 2);
    out.extend_from_slice(&bom);
    for unit in text.encode_utf16() {
        out.extend_from_slice(&unit_bytes(unit));
    }
    out
}

/// `encode` swaps unmappable characters for `&#20013;`-style text, which would
/// silently rewrite the document, so its flag is treated as a refusal.
fn encode_windows_1252(text: &str) -> Result<Vec<u8>, char> {
    let (bytes, _, unmappable) = WINDOWS_1252.encode(text);
    if !unmappable {
        return Ok(bytes.into_owned());
    }
    let first = text
        .chars()
        .find(|c| WINDOWS_1252.encode(c.encode_utf8(&mut [0; 4])).2);
    Err(first.unwrap_or('\u{FFFD}'))
}

/// Does the first line break in a file's opening bytes use CRLF? UTF-16 is
/// scanned by code unit: its `\n` is preceded by a zero byte, and a 0x0A byte
/// can be half of an unrelated character, so a byte scan got both wrong and a
/// save turned a CRLF file into an LF one. ENC-03.
pub fn first_newline_is_crlf(head: &[u8]) -> bool {
    if let Some(body) = head.strip_prefix(&UTF_16LE_BOM) {
        return crlf_at_first_newline(utf16_units(body, u16::from_le_bytes));
    }
    if let Some(body) = head.strip_prefix(&UTF_16BE_BOM) {
        return crlf_at_first_newline(utf16_units(body, u16::from_be_bytes));
    }
    crlf_at_first_newline(head.iter().map(|&b| u16::from(b)))
}

/// Whole code units only: the opening chunk can end halfway through one.
fn utf16_units(body: &[u8], unit: fn([u8; 2]) -> u16) -> impl Iterator<Item = u16> + '_ {
    (0..body.len() / 2).map(move |i| unit([body[i * 2], body[i * 2 + 1]]))
}

fn crlf_at_first_newline(units: impl Iterator<Item = u16>) -> bool {
    let mut previous = 0;
    for unit in units {
        if unit == 0x0A {
            return previous == 0x0D;
        }
        previous = unit;
    }
    false
}

#[cfg(test)]
mod tests {
    use super::{decode_text, encode_text, first_newline_is_crlf, TextEncoding};

    /// "Hi\r\n" exactly as PowerShell 5 `>` writes it. Fixtures are literal
    /// bytes so they can't agree with a broken encoder.
    const PS5_OUTPUT: &[u8] = &[0xFF, 0xFE, b'H', 0, b'i', 0, 0x0D, 0, 0x0A, 0];

    fn decoded(bytes: &[u8]) -> (String, TextEncoding) {
        decode_text(bytes.to_vec()).unwrap()
    }

    #[test]
    fn decodes_plain_utf8_and_keeps_the_bom_for_the_frontend() {
        assert_eq!(
            decoded("héllo".as_bytes()),
            ("héllo".to_string(), TextEncoding::Utf8)
        );
        assert_eq!(decoded(b""), (String::new(), TextEncoding::Utf8));
        assert_eq!(
            decoded(b"\xEF\xBB\xBF# Hi"),
            ("\u{FEFF}# Hi".to_string(), TextEncoding::Utf8Bom),
        );
    }

    #[test]
    fn decodes_utf16_by_bom_and_drops_the_bom() {
        assert_eq!(
            decoded(PS5_OUTPUT),
            ("Hi\r\n".to_string(), TextEncoding::Utf16Le)
        );
        assert_eq!(
            decoded(&[0xFE, 0xFF, 0, b'H', 0x4E, 0x2D]),
            ("H中".to_string(), TextEncoding::Utf16Be),
        );
        // Outside the BMP: a surrogate pair must come through as one character.
        assert_eq!(
            decoded(&[0xFF, 0xFE, 0x3D, 0xD8, 0x00, 0xDE]),
            ("😀".to_string(), TextEncoding::Utf16Le),
        );
        // A file holding only a BOM is an empty document.
        assert_eq!(
            decoded(&[0xFF, 0xFE]),
            (String::new(), TextEncoding::Utf16Le)
        );
    }

    #[test]
    fn falls_back_to_windows_1252() {
        assert_eq!(
            decoded(b"caf\xE9 \x93hi\x94 \x80"),
            ("café “hi” €".to_string(), TextEncoding::Windows1252),
        );
    }

    #[test]
    fn refuses_what_it_cannot_open_without_loss() {
        // UTF-16 with a stray trailing byte, then with a lone surrogate.
        assert!(decode_text(vec![0xFF, 0xFE, b'H', 0, b'i'])
            .unwrap_err()
            .contains("damaged"));
        assert!(decode_text(vec![0xFF, 0xFE, 0x3D, 0xD8, b'x', 0])
            .unwrap_err()
            .contains("damaged"));
        // A BOM promises UTF-8, so bad bytes after it are damage, not a legacy file.
        assert!(decode_text(b"\xEF\xBB\xBFcaf\xE9".to_vec())
            .unwrap_err()
            .contains("damaged"));
        // UTF-32 LE must not be read as UTF-16 LE plus a NUL.
        assert!(decode_text(vec![0xFF, 0xFE, 0, 0, b'H', 0, 0, 0])
            .unwrap_err()
            .contains("UTF-32"));
        // Binary: invalid UTF-8 with a NUL (PNG signature).
        assert!(decode_text(b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec())
            .unwrap_err()
            .contains("binary"));
    }

    #[test]
    fn valid_utf8_with_a_nul_still_opens_as_before() {
        assert_eq!(decoded(b"a\0b"), ("a\0b".to_string(), TextEncoding::Utf8));
    }

    #[test]
    fn every_windows_1252_byte_round_trips() {
        // One invalid-UTF-8 lead byte forces the fallback; the rest is every
        // non-NUL byte, including the five with no assigned character (0x81…).
        let bytes: Vec<u8> = (1..=255u8).collect();
        let (text, encoding) = decoded(&bytes);
        assert_eq!(encoding, TextEncoding::Windows1252);
        assert_eq!(text.chars().count(), 255);
        assert!(!text.contains('\u{FFFD}'));
        assert_eq!(encode_text(text, TextEncoding::Windows1252).unwrap(), bytes);
    }

    #[test]
    fn encodes_utf16_with_a_bom_in_both_byte_orders() {
        assert_eq!(
            encode_text("Hi\r\n".into(), TextEncoding::Utf16Le).unwrap(),
            PS5_OUTPUT
        );
        assert_eq!(
            encode_text("H😀".into(), TextEncoding::Utf16Be).unwrap(),
            [0xFE, 0xFF, 0, b'H', 0xD8, 0x3D, 0xDE, 0x00],
        );
        assert_eq!(
            encode_text(String::new(), TextEncoding::Utf16Le).unwrap(),
            [0xFF, 0xFE]
        );
    }

    #[test]
    fn utf8_bom_is_written_exactly_once() {
        assert_eq!(
            encode_text("a".into(), TextEncoding::Utf8Bom).unwrap(),
            b"\xEF\xBB\xBFa"
        );
        assert_eq!(
            encode_text("\u{FEFF}a".into(), TextEncoding::Utf8Bom).unwrap(),
            b"\xEF\xBB\xBFa"
        );
        assert_eq!(encode_text("a".into(), TextEncoding::Utf8).unwrap(), b"a");
    }

    #[test]
    fn windows_1252_refuses_unmappable_text_instead_of_substituting() {
        assert_eq!(
            encode_text("café €".into(), TextEncoding::Windows1252).unwrap(),
            b"caf\xE9 \x80"
        );
        assert_eq!(
            encode_text("ok 中 文".into(), TextEncoding::Windows1252),
            Err('中')
        );
        assert_eq!(
            encode_text("😀".into(), TextEncoding::Windows1252),
            Err('😀')
        );
    }

    #[test]
    fn crlf_detection_reads_utf16_by_code_unit() {
        assert!(first_newline_is_crlf(b"one\r\ntwo\n"));
        assert!(!first_newline_is_crlf(b"one\ntwo\r\n"));
        assert!(!first_newline_is_crlf(b"no newline"));
        assert!(first_newline_is_crlf(PS5_OUTPUT));
        assert!(first_newline_is_crlf(&[
            0xFE, 0xFF, 0, b'H', 0, 0x0D, 0, 0x0A
        ]));
        assert!(!first_newline_is_crlf(&[0xFF, 0xFE, b'H', 0, 0x0A, 0]));
        // U+010A and U+0D0A hold 0x0A bytes but are not line breaks; the real
        // CRLF comes after them.
        assert!(first_newline_is_crlf(&[
            0xFF, 0xFE, 0x0A, 0x01, 0x0A, 0x0D, 0x0D, 0, 0x0A, 0
        ]));
        // U+0A0D is a 0D 0A byte pair in LE, and still not a line break.
        assert!(!first_newline_is_crlf(&[0xFF, 0xFE, 0x0D, 0x0A, 0x0A, 0]));
        // A chunk cut mid-unit must not panic or invent a newline.
        assert!(!first_newline_is_crlf(&[0xFF, 0xFE, b'H', 0, 0x0A]));
    }

    #[test]
    fn wire_names_match_the_frontend() {
        for (encoding, wire) in [
            (TextEncoding::Utf8, "utf-8"),
            (TextEncoding::Utf8Bom, "utf-8-bom"),
            (TextEncoding::Utf16Le, "utf-16le"),
            (TextEncoding::Utf16Be, "utf-16be"),
            (TextEncoding::Windows1252, "windows-1252"),
        ] {
            assert_eq!(encoding.name(), wire);
            assert_eq!(serde_json::to_value(encoding).unwrap(), wire);
            assert_eq!(
                serde_json::from_value::<TextEncoding>(wire.into()).unwrap(),
                encoding
            );
        }
        // An unknown name fails the save at the IPC boundary, before any write.
        assert!(serde_json::from_value::<TextEncoding>("koi8-r".into()).is_err());
    }
}

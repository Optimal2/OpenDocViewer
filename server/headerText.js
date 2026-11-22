// File: server/headerText.js
/** Text of an HTTP header value as the sender wrote it. */

const strictUtf8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Node hands header values over decoded as latin1, one character per byte. A value that was
 * sent as UTF-8 (a user name with a non-ASCII letter, for example) therefore arrives as
 * mojibake, and its second bytes can be C1 control characters that the log sanitising removes,
 * which would damage the name for good. When the bytes of the value are valid UTF-8 they are
 * decoded as UTF-8; otherwise the latin1 text is kept. Decode before sanitising.
 *
 * Trade-off: a value that really is latin1 and whose bytes also happen to be valid UTF-8 (a
 * lead byte C2-F4 followed by the right number of bytes 80-BF) is read as UTF-8. Ordinary
 * latin1 text does not have that shape, since an accented letter there is followed by an ASCII
 * letter or a space.
 * @param {*} value
 * @returns {*} The decoded string, or the value unchanged when it is not a string.
 */
export function decodeHeaderValue(value) {
  if (typeof value !== 'string') return value;
  let highBytes = false;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0xff) return value; // Not latin1-decoded bytes; leave it alone.
    if (code > 0x7f) highBytes = true;
  }
  if (!highBytes) return value;
  try {
    return strictUtf8.decode(Buffer.from(value, 'latin1'));
  } catch {
    return value;
  }
}

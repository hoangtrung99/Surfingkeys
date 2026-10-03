const { TextEncoder, TextDecoder } = require('util');

// jsdom does not expose TextEncoder/TextDecoder, which the background's request()
// (src/background/start.js) and hashString() (src/content_scripts/common/utils.js)
// use, and the tests that feed them bytes.
if (typeof global.TextEncoder === 'undefined') {
    global.TextEncoder = TextEncoder;
}
if (typeof global.TextDecoder === 'undefined') {
    global.TextDecoder = TextDecoder;
}

// The frontend frame left open across an extension reload is cut off like the
// page's content script (see orphan.test.js): it must stop answering the page
// (ui/frontend.js message listener) instead of throwing on every message.
import { bootFrontend } from '../helpers/bootFrontend.js';
import { BOOT_TIMEOUT } from '../helpers/jsdomEnv.js';

let f, toPage;
beforeAll(async () => {
    f = await bootFrontend();
    toPage = jest.spyOn(window, 'postMessage').mockImplementation(() => {});
}, BOOT_TIMEOUT);

const INIT = { action: 'initFrontend', ack: true, origin: 'http://localhost', winSize: [1280, 800] };
const ACK = { surfingkeys_uihost_data: expect.objectContaining({ action: 'initFrontendAck', toContent: true }) };

test('while the extension is there it acknowledges the page', () => {
    f.post(INIT);
    expect(toPage).toHaveBeenCalledWith(ACK, 'http://localhost');
});

test('once chrome.runtime.id is gone it answers nothing', () => {
    const id = f.chrome.runtime.id;
    delete f.chrome.runtime.id;
    try {
        f.post(INIT);
        expect(toPage).not.toHaveBeenCalled();
    } finally {
        f.chrome.runtime.id = id;
    }
});

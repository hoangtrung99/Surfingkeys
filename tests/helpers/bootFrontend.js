// The frontend (pages/frontend.html + ui/frontend.js) booted in jsdom, the frame
// every omnibar, palette, switcher, banner and popup is drawn in.
//
// ONE BOOT PER TEST FILE (in beforeAll): frontend.js sets itself up at import
// and owns the whole document. It cannot share a file with bootContent(): in a
// tab the two live in separate documents.
//
// The page talks to it with window messages ({surfingkeys_frontend_data}), which
// `post` plays. What it sends back goes to top.postMessage -- in jsdom `top` is
// this window, so a spy on window.postMessage sees it.
import fs from 'fs';
import path from 'path';
import { installChromeMock, installJsdomShims, press, settle } from './jsdomEnv.js';

const SRC = path.resolve(__dirname, '../../src');

/**
 * @param {object} [opts]
 * @param {object} [opts.answers] background answers by action (see installChromeMock).
 * @returns the chrome mock (chrome, sent, held, answers, deliver), the clipboard
 *   board, Front (the frontend's own object), and post, press and settle.
 */
export async function bootFrontend({ answers = {} } = {}) {
    const board = installJsdomShims();
    const ext = installChromeMock({ answers });
    const html = fs.readFileSync(path.join(SRC, 'content_scripts/ui/frontend.html'), 'utf8');
    document.documentElement.innerHTML = html.replace(/<!DOCTYPE html>/i, '');
    // the frontend focuses its own frame before it takes keys; jsdom has nowhere to move it
    window.focus = jest.fn();
    const Front = require(path.join(SRC, 'content_scripts/ui/frontend.js')).default;
    await settle();
    return Object.assign(ext, {
        Front,
        board,
        press,
        settle,
        // a message from the page's UI host, as frontend.js receives it
        post: (data) => {
            const event = new MessageEvent('message', { data: { surfingkeys_frontend_data: data } });
            window.dispatchEvent(event);
            return event;
        },
    });
}

/*
  Tip Tab
  A Firefox extension to manage and navigate the browser tabs.
  Copyright (C) 2018  William Wong (williamw520@gmail.com)

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU General Public License as published by
  the Free Software Foundation, either version 3 of the License, or
  (at your option) any later version.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU General Public License for more details.

  You should have received a copy of the GNU General Public License
  along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

// module tiptab_daemon, background script.
(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import appcfg
    // import app
    let RingBuf = ringbuf.RingBuf;

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    let module = function() { };        // Module object to be returned.
    if (modulename)
        scope[modulename] = module;     // set module name in scope, otherwise caller sets the name with the returned module object.

    const MAX_ACTIVATED_HISTORY = 10;
    const TIPTAB_URL = browser.extension.getURL("tiptab.html");

    let activatedHistory = {};          // Keyed by windowId.  Value is a RingBuf listing the tabId of the last activated tabs.

    function is_tiptaburl(url) { return url.startsWith(TIPTAB_URL) };   // sometimes # is added to the end of the url.

    function init() {
        Promise.resolve()
            .then(() => log.info("tiptab_daemon init ===================================================== ") )
            .then(() => browser.browserAction.onClicked.addListener(browserAction_onClicked) )
            .then(() => browser.tabs.onActivated.addListener(tabs_onActivated) )
            .then(() => setupMessageHandlers() )
            .then(() => log.info("tiptab_daemon init done ----------------------------------------------- ") )
            .catch( e => console.warn(dump(e)) )
    }

    function browserAction_onClicked() {
        browser.tabs.query({}).then( tabs => {
            let uiUrl = browser.extension.getURL("tiptab.html");
            let uiTab = tabs.find( t => is_tiptaburl(t.url) );
            if (uiTab) {
                browser.windows.update(uiTab.windowId, {focused: true}).then( () => browser.tabs.update(uiTab.id, {active: true}) );
            } else {
                browser.tabs.create({ url: uiUrl });
            }
        });
    }

    function tabs_onActivated(activeInfo) {
        // log.info("tabs_onActivated tabId " + activeInfo.tabId + " winId " + activeInfo.windowId);

        let tabHistory = activatedHistory[activeInfo.windowId];
        if (!tabHistory) {
            tabHistory = activatedHistory[activeInfo.windowId] = new RingBuf(MAX_ACTIVATED_HISTORY);
        }
        tabHistory.push(activeInfo.tabId);
    }

    function setupMessageHandlers() {
        log.info("setupMessageHandlers");
        return browser.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
            // log.info("onMessage() ", msg);
            switch (msg.cmd) {
            case "dbg-test":
                log.info(msg);
                break;
            case "last-active-tab":
                if (sendResponse) {
                    if (msg.wid && activatedHistory[msg.wid]) {
                        let history = activatedHistory[msg.wid];
                        for (let i = history.newestIndex - 1; i >= 0; i--) {
                            let tid = history.get(i);
                            if (tid != msg.currentTid) {
                                sendResponse({ lastActiveTabId: tid });
                                return;
                            }
                        }
                    }
                    sendResponse({ lastActiveTabId: -1 });
                }
                return;
            default:
                log.info("onMessage() unknown cmd: " + msg.cmd);
                break;
            }
        });
    }

    init();

    log.info("module loaded");
    return module;

}(this, "tiptab_daemon"));    // Pass in the global scope as 'this' scope.


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

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    var module = function() { };       // Module object to be returned.
    if (modulename)
        scope[modulename] = module;    // set module name in scope, otherwise caller sets the name with the returned module object.

    function init() {
        Promise.resolve()
            .then(() => log.info("tiptab_daemon init ===================================================== ") )
            .then(() => browser.browserAction.onClicked.addListener(browserAction_onClicked) )
            .then(() => setupMessageHandlers() )
            .then(() => log.info("tiptab_daemon init done ----------------------------------------------- ") )
            .catch( e => console.warn(dump(e)) )
    }

    function browserAction_onClicked() {
        browser.tabs.query({}).then( tabs => {
            let uiUrl = browser.extension.getURL("tiptab.html");
            let uiTab = tabs.find( t => t.url == uiUrl );
            if (uiTab) {
                browser.windows.update(uiTab.windowId, {focused: true}).then( () => browser.tabs.update(uiTab.id, {active: true}) );
            } else {
                browser.tabs.create({ url: uiUrl });
            }
        });
    }

    function setupMessageHandlers() {
        log.info("setupMessageHandlers");
        return browser.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
            log.info("onMessage() ", msg);
            switch (msg.cmd) {
            case "dbg-test":
                break;
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


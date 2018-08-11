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
    // import ringbuf
    // import wwhotkey
    // import settings
    let RingBuf = ringbuf.RingBuf;
    let TipTabSettings = settings.TipTabSettings;

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    let module = function() { };        // Module object to be returned.
    if (modulename)
        scope[modulename] = module;     // set module name in scope, otherwise caller sets the name with the returned module object.

    const MAX_ACTIVATED_HISTORY = 10;
    const TIPTAB_URL = browser.extension.getURL("tiptab.html");

    // Module variables.
    let ttSettings = TipTabSettings.ofLatest();
    let activatedHistory = {};          // Keyed by windowId.  Value is a RingBuf listing the tabId of the last activated tabs.
    let lastAppCommand = "";

    function init() {
        Promise.resolve()
            //.then(() => log.info("tiptab_daemon init ===================================================== ") )
            .then(() => browser.runtime.getPlatformInfo().then( info => wwhotkey.setOS(info.os) ) )
            .then(() => settings.pLoad().then(tts => ttSettings = tts) )
            .then(() => browser.browserAction.onClicked.addListener(browserAction_onClicked) )
            .then(() => browser.commands.onCommand.addListener(commands_onCommand) )
            .then(() => browser.tabs.onActivated.addListener(tabs_onActivated) )
            .then(() => browser.storage.onChanged.addListener(storage_onChanged) )
            .then(() => setupMessageHandlers() )
            .then(() => updateCustomHotKeys() )
            //.then(() => log.info("tiptab_daemon init done ----------------------------------------------- ") )
            .catch( e => console.warn(dump(e)) )
    }

    function browserAction_onClicked() {
        // log.info("browserAction_onClicked, command as: launch");
        pActivateTipTabUI("launch");
    }

    function commands_onCommand(command) {
        // log.info("commands_onCommand, command: " + command);
        pActivateTipTabUI(command);
    }

    function tabs_onActivated(activeInfo) {
        // log.info("tabs_onActivated tabId " + activeInfo.tabId + " winId " + activeInfo.windowId);
        let tabHistory = activatedHistory[activeInfo.windowId];
        if (!tabHistory) {
            tabHistory = activatedHistory[activeInfo.windowId] = new RingBuf(MAX_ACTIVATED_HISTORY);
        }
        tabHistory.push(activeInfo.tabId);
    }

    function storage_onChanged(storageChange) {
        // Monitor settings storage change.
        if (app.has(storageChange, "tipTabSettings")) {
            // log.info("storage_onChanged", ttSettingsNew);
            ttSettings = storageChange.tipTabSettings.newValue;
            updateCustomHotKeys();
        }
    }

    function setupMessageHandlers() {
        return browser.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
            // log.info("onMessage() ", msg);
            switch (msg.cmd) {
            case "dbg-test":
                log.info(msg);
                break;
            case "hotkey":
                // deprecated
                log.info("from content_inject hotkey, command: " + msg.arg);
                pActivateTipTabUI(msg.arg);
                break;
            case "last-active-tab":
                if (sendResponse) {
                    // log.info("from tiptap_ui, last-active-tab");
                    sendResponse({ lastActiveTabId: getLastActiveTab(msg.wid, msg.tiptapTid) });
                }
                return;
            case "last-app-command":
                if (sendResponse) {
                    // log.info("from tiptap_ui, last-app-command, lastAppCommand: " + lastAppCommand);
                    sendResponse({ appCommand: lastAppCommand });
                }
                lastAppCommand = "";   // Clear after returning the last command.
                return;
            default:
                log.info("onMessage() unknown cmd: " + msg.cmd);
                break;
            }
        });
    }

    function getLastActiveTab(wid, tiptapTid) {
        if (wid && activatedHistory[wid]) {
            let history = activatedHistory[wid];
            if (history) {
                for (let i = history.newestIndex - 1; i >= 0; i--) {
                    let tid = history.get(i);
                    if (tid != tiptapTid) {
                        return tid;
                    }
                }
            }
        }
        return -1;
    }

    function pActivateTipTabUI(appCmd) {
        // log.info("pActivateTipTabUI appCmd: " + appCmd);
        return browser.tabs.query({url: TIPTAB_URL}).then( tabs => {
            let ttTab = tabs.length > 0 ? tabs[0] : null;
            if (ttTab) {
                return browser.windows.getLastFocused().then( focusedWin => {
                    let ttWinHasFocus = ttTab.windowId == focusedWin.id;
                    let ttTabIsActive = ttTab.active;
                    return browser.runtime.sendMessage({ cmd: "appCommand", arg: appCmd,
                                                         ttWinHasFocus: ttWinHasFocus, ttTabIsActive: ttTabIsActive });
                });
            } else {
                // No existing TipTab page.  Create one.
                // The newly created page is not ready to handle message yet.  Save the appCmd for later retrieval during extension's init.
                lastAppCommand = appCmd;
                return browser.tabs.create({ url: TIPTAB_URL });
            }
        });
    }

    function updateCustomHotKey(command, shortcut) {
        // log.info("updateCustomHotKey, command: " + command + ", shortcut: " + shortcut);
        if (shortcut) {
            try {
                browser.commands.update({ name: command, shortcut: wwhotkey.ofKeySeq(shortcut).toString() });
            } catch(e) {
                log.error(e);
            }
        } else {
            browser.commands.reset(command);
        }
    }

    function updateCustomHotKeys() {
        updateCustomHotKey("activate",  ttSettings.enableCustomHotKey ? ttSettings.appHotKey : "");
        updateCustomHotKey("search",    ttSettings.enableCustomHotKey ? ttSettings.searchHotKey : "");
    }

    init();

    log.info("module loaded");
    return module;

}(this, "tiptab_daemon"));    // Pass in the global scope as 'this' scope.


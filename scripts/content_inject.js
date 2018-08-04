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

// content_inject module, page injection script.
(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import appcfg
    // import wwhotkey
    // import settings
    let TipTabSettings = settings.TipTabSettings;

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    var module = function() { };    // Module object to be returned; local reference to the package object for use below.
    if (modulename)
        scope[modulename] = module; // set module name in scope, otherwise caller sets the name with the returned module object.
    
    log.info(window.location.href + " starts -------------------------");

    let ttSettings = TipTabSettings.ofLatest();
    let launchSeq = wwhotkey.ofKeySeq();
    let searchSeq = wwhotkey.ofKeySeq();
    let currentSeq = wwhotkey.ofKeySeq();

    function init() {
        Promise.resolve()
            .then(() => settings.pLoad().then(tts => ttSettings = tts ))
            .then(() => pMonitorDataChange() )
            .then(() => setupKeyboardListeners() )
            .catch( e => log.error(e) )
    }

    function pMonitorDataChange() {
        // Monitor settings storage change.
        return browser.storage.onChanged.addListener(storageChange => {
            if (storageChange.hasOwnProperty("tipTabSettings")) {
                // log.info("storage.onChanged");
                //ttSettings = new TipTabSettings(storageChange.tipTabSettings.newValue);
                ttSettings = TipTabSettings.upgradeWith(storageChange.tipTabSettings.newValue);
                setupKeyboardListeners();
            }
        });
    }

    function setupKeyboardListeners() {
        document.removeEventListener("keydown", hotKeydownHandler, false);
        document.removeEventListener("keyup", hotKeyupHandler, false);
        if (ttSettings.enableCustomHotKey && (ttSettings.appHotKey || ttSettings.searchHotKey)) {
            try {
                launchSeq = wwhotkey.ofKeySeq(ttSettings.appHotKey);
                searchSeq = wwhotkey.ofKeySeq(ttSettings.searchHotKey);
                document.addEventListener("keydown", hotKeydownHandler, false);
                document.addEventListener("keyup", hotKeyupHandler, false);
                return;
            } catch(e) {
                console.error(e);
            }
        }
        launchSeq = wwhotkey.ofKeySeq();
    }

    function hotKeydownHandler(e) {
        if (ttSettings.enableCustomHotKey) {
            currentSeq.fromEvent(e);
            if (launchSeq.hasKey() && launchSeq.equals(currentSeq)) {
                // log.info("hotKeydownHandler match launchSeq: " + launchSeq.toString() + ", currentSeq: " + currentSeq.toString());
                browser.runtime.sendMessage({ cmd: "open-ui" });
                e.preventDefault();
                return false;
            }
            if (searchSeq.hasKey() && searchSeq.equals(currentSeq)) {
                // log.info("hotKeydownHandler match searchSeq: " + searchSeq.toString() + ", currentSeq: " + currentSeq.toString());
                browser.runtime.sendMessage({ cmd: "open-ui" });
                e.preventDefault();
                return false;
            }
        }
    }

    function hotKeyupHandler(e) {
        currentSeq.clear();
    }

    init();

}(this, "tiptab_content_inject"));    // Pass in the global scope as 'this' scope.


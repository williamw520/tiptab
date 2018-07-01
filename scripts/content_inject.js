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

    let ttSettings = new TipTabSettings();
    let settingSeq = wwhotkey.ofKeySeq();
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
                ttSettings = new TipTabSettings(storageChange.tipTabSettings.newValue);
                setupKeyboardListeners();
            }
        });
    }

    function setupKeyboardListeners() {
        document.removeEventListener("keydown", keydownHandler, false);
        document.removeEventListener("keyup", keyupHandler, false);
        if (ttSettings.enableHotKey) {
            settingSeq = wwhotkey.ofKeySeq(ttSettings.appHotKey);
            document.addEventListener("keydown", keydownHandler, false);
            document.addEventListener("keyup", keyupHandler, false);
        } else {
            settingSeq = wwhotkey.ofKeySeq();
        }
    }

    function keydownHandler(e) {
        if (ttSettings.enableHotKey) {
            currentSeq.fromEvent(e);
            if (settingSeq.equals(currentSeq)) {
                browser.runtime.sendMessage({ cmd: "open-ui" });
                return stopEvent(e);
            }
        }
    }

    function keyupHandler(e) {
        currentSeq.clear();
    }

    function stopEvent(e) {
        e.preventDefault();
        return false;
    }

    init();

}(this, "tiptab_content_inject"));    // Pass in the global scope as 'this' scope.


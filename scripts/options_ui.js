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

// Options module

(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import appcfg
    // import app
    // import settings
    let TipTabSettings = settings.TipTabSettings;

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    var module = function() { };    // Module object to be returned; local reference to the package object for use below.
    if (modulename)
        scope[modulename] = module; // set module name in scope, otherwise caller sets the name with the returned module object.

    let ttSettings = new TipTabSettings();

    // Firefox's Content Security Policy for WebExtensions prohibits running any Javascript in the html page.
    // Wait for the page loaded event before doing anything.
    window.addEventListener("load", function(event){
        // Page is loaded and ready for the script to run.
        Promise.resolve()
            .then(() => log.info("Page initialization starts") )
            .then(() => settings.pLoad().then(tts => ttSettings = tts) )
            .then(() => setupDOMListeners())
            .then(() => refreshSettings())
            .then(() => log.info("Page initialization done") )
            .catch( e => log.warn(e) )
    });

    function refreshSettings() {
        $("#thumbnailPopup").prop("checked", ttSettings.thumbnailPopup);
    }

    function setupDOMListeners() {
        $("#resetToDefault").on("click", function(){
            ttSettings = new TipTabSettings();
            settings.pRemove().then( () => refreshSettings() );
        });
        
        $("#thumbnailPopup").change(function(){
            ttSettings.thumbnailPopup = this.checked;
            settings.pSave(ttSettings);
        });
    }

    log.info("module loaded");
    return module;

}(this, "options_ui"));     // Pass in the global scope as 'this' scope.


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
    // import wwhotkey
    // import settings
    let TipTabSettings = settings.TipTabSettings;

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    var module = function() { };    // Module object to be returned; local reference to the package object for use below.
    if (modulename)
        scope[modulename] = module; // set module name in scope, otherwise caller sets the name with the returned module object.

    let orgSettings = new TipTabSettings();
    let ttSettings = new TipTabSettings();
    let hasChanged = false;

    // Firefox's Content Security Policy for WebExtensions prohibits running any Javascript in the html page.
    // Wait for the page loaded event before doing anything.
    window.addEventListener("load", function(event){
        // Page is loaded and ready for the script to run.
        Promise.resolve()
            .then(() => log.info("Page initialization starts") )
            .then(() => settings.pLoad().then(tts => {
                orgSettings = tts;
                ttSettings = Object.assign({}, orgSettings);
            }))
            .then(() => setupDOMListeners())
            .then(() => refreshControls())
            .then(() => refreshSettings())
            .then(() => log.info("Page initialization done") )
            .catch( e => log.warn(e) )
    });

    function refreshControls() {
        if (hasChanged) {
            $("#saveChanges").removeClass("disabled");
            $("#undoChanges").removeClass("disabled");
        } else {
            $("#saveChanges").addClass("disabled");
            $("#undoChanges").addClass("disabled");
        }
    }

    function updateChanges() {
        hasChanged = true;
        refreshControls();
    }

    function refreshSettings() {
        $("#thumbnailPopup").prop("checked", ttSettings.thumbnailPopup);
        $("#showEmptyWindows").prop("checked", ttSettings.showEmptyWindows);
        $("#showEmptyContainers").prop("checked", ttSettings.showEmptyContainers);
        $("#realtimeUpdateThumbnail").prop("checked", ttSettings.realtimeUpdateThumbnail);

        $("#thumbnailWidth0").val(ttSettings.thumbnailWidth0);
        $("#thumbnailHeight0").val(ttSettings.thumbnailHeight0);
        $("#thumbnailWidth1").val(ttSettings.thumbnailWidth1);
        $("#thumbnailHeight1").val(ttSettings.thumbnailHeight1);
        $("#thumbnailWidth2").val(ttSettings.thumbnailWidth2);
        $("#thumbnailHeight2").val(ttSettings.thumbnailHeight2);
        
        $("#enableCustomHotKey").prop("checked", ttSettings.enableCustomHotKey);
        $("#appHotKey").val(ttSettings.appHotKey);
        $(".is-error").removeClass("is-error");
    }

    function setupDOMListeners() {
        // Input handlers
        $("#thumbnailPopup").on("change",           function(){ ttSettings.thumbnailPopup = this.checked; updateChanges() });
        $("#showEmptyWindows").on("change",         function(){ ttSettings.showEmptyWindows = this.checked; updateChanges() });
        $("#showEmptyContainers").on("change",      function(){ ttSettings.showEmptyContainers = this.checked; updateChanges() });
        $("#realtimeUpdateThumbnail").on("change",  function(){ ttSettings.realtimeUpdateThumbnail = this.checked; updateChanges() });

        $("#thumbnailWidth0").on("input",          function(){ ttSettings.thumbnailWidth0  = $(this).val(); updateChanges() });
        $("#thumbnailHeight0").on("input",         function(){ ttSettings.thumbnailHeight0 = $(this).val(); updateChanges() });
        $("#thumbnailWidth1").on("input",          function(){ ttSettings.thumbnailWidth1  = $(this).val(); updateChanges() });
        $("#thumbnailHeight1").on("input",         function(){ ttSettings.thumbnailHeight1 = $(this).val(); updateChanges() });
        $("#thumbnailWidth2").on("input",          function(){ ttSettings.thumbnailWidth2  = $(this).val(); updateChanges() });
        $("#thumbnailHeight2").on("input",         function(){ ttSettings.thumbnailHeight2 = $(this).val(); updateChanges() });

        $("#enableCustomHotKey").on("change",       function(){ ttSettings.enableCustomHotKey = this.checked; updateChanges() });
        $("#appHotKey").on("input",                 function(){ getHotKeyInput(); updateChanges() });

        // Special handling for hotkey input by keypressing.
        let keyPressingHandler = function(e) {
            let ks = wwhotkey.ofKeyboardEvent(e);
            $("#appHotKey").val(ks.toString());
            getHotKeyInput();
            updateChanges();
            return stopEvent(e);
        };
        let $keyPressingBtn = $("#keyPressing");
        $keyPressingBtn.on("click", function(e){
            $keyPressingBtn.text("Click Again to End");
            $(document).on("keydown", keyPressingHandler);
            $(".keypress-cover").removeClass("d-none").on("click", function(e){
                $(this).addClass("d-none").off();
                $keyPressingBtn.text("Enter by Key Press");
                $(document).off("keydown", keyPressingHandler);
            });
            return stopEvent(e);
        });

        // Button handlers
        $("#saveChanges").on("click", function(){
            settings.pSave(ttSettings).then(() => {
                postSaving(orgSettings, ttSettings);
            });
        });
        
        $("#undoChanges").on("click", function(){
            settings.pSave(orgSettings).then(() => {
                postSaving(ttSettings, orgSettings);
            });
        });

        $("#resetToDefault").on("click", function(){
            ttSettings = new TipTabSettings();
            //settings.pRemove().then( () => refreshSettings() );
            refreshSettings();
            updateChanges();
        });

    }

    function getHotKeyInput() {
        let $appHotKey = $("#appHotKey");
        ttSettings.appHotKey = $appHotKey.val().trim();
        if (ttSettings.appHotKey.length == 0 || wwhotkey.validKeyIdSequence(ttSettings.appHotKey)) {
            $appHotKey.removeClass("is-error");
            $appHotKey.closest(".input-group").removeClass("is-error");
        } else {
            $appHotKey.addClass("is-error");
            $appHotKey.closest(".input-group").addClass("is-error");
        }
    }

    function postSaving(oldSettings, newSettings) {
        //broadcastToTabs({ cmd: "settings-changed", settings: newSettings });
        orgSettings = Object.assign({}, newSettings);
        ttSettings  = Object.assign({}, newSettings);
        hasChanged = false;
        refreshControls();
        refreshSettings();
    }

    function broadcastToTabs(msg) {
        return browser.tabs.query({}).then( tabs => tabs.map( tab => {
            // log.info(`sendMessage to ${tab.id} ${tab.url}`);
            browser.tabs.sendMessage(tab.id, msg).catch(e => console.error(`Error on sendMessage to tab ${tab.id}, ${tab.url}: ${e}`));
        }))
    }

    function stopEvent(e) {
        e.preventDefault();
        return false;
    }

    
    log.info("module loaded");
    return module;

}(this, "options_ui"));     // Pass in the global scope as 'this' scope.


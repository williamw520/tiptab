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


// ES6 imports
import logger from "/scripts/util/logger.js";
import appcfg from "/scripts/util/appcfg.js";
import app from "/scripts/util/app.js";
import wwhotkey from "/scripts/util/wwhotkey.js";
import settings from "/scripts/settings.js";


// options module
let the_module = (function() {
    "use strict";

    const module = { NAME: "options" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);

    let TipTabSettings = settings.TipTabSettings;
    let orgSettings = TipTabSettings.ofLatest();
    let ttSettings  = TipTabSettings.ofLatest();
    let hasChanged  = false;

    // Firefox's Content Security Policy for WebExtensions prohibits running any Javascript in the html page.
    // Wait for the page loaded event before doing anything.
    window.addEventListener("load", function(event){
        // Page is loaded and ready for the script to run.
        Promise.resolve()
            .then(() => log.info("Page initialization starts") )
            .then(() => browser.runtime.getPlatformInfo().then( info => wwhotkey.setOS(info.os) ) )
            .then(() => settings.pLoad().then(tts => {
                orgSettings = tts;
                ttSettings = Object.assign({}, orgSettings);
            }))
            .then(() => setupDOMListeners())
            .then(() => refreshControls())
            .then(() => refreshSettings())
            .then(() => activateTab("tab-general"))
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
        $("#openInNewWindow").prop("checked", ttSettings.openInNewWindow);
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
        $("#searchHotKey").val(ttSettings.searchHotKey);
        $("#savedSearchKeyPrefix").val(ttSettings.savedSearchKeyPrefix);

        $(".is-error").removeClass("is-error");
    }

    function setupDOMListeners() {
        // Handle click on the tabs.
        $("ul.tab li.tab-item").click(function(){
		    let tabid = $(this).data("tabid");
		    $(this).addClass("active").siblings().removeClass("active");
            $(".tab-body#" + tabid).show().siblings().hide();
        })

        // Input handlers
        $("#thumbnailPopup").on("change",           function(){ ttSettings.thumbnailPopup = this.checked; updateChanges() });
        $("#openInNewWindow").on("change",          function(){ ttSettings.openInNewWindow = this.checked; updateChanges() });
        $("#showEmptyWindows").on("change",         function(){ ttSettings.showEmptyWindows = this.checked; updateChanges() });
        $("#showEmptyContainers").on("change",      function(){ ttSettings.showEmptyContainers = this.checked; updateChanges() });
        $("#realtimeUpdateThumbnail").on("change",  function(){ ttSettings.realtimeUpdateThumbnail = this.checked; updateChanges() });

        $("#thumbnailWidth0").on("input",           function(){ ttSettings.thumbnailWidth0  = $(this).val(); updateChanges() });
        $("#thumbnailHeight0").on("input",          function(){ ttSettings.thumbnailHeight0 = $(this).val(); updateChanges() });
        $("#thumbnailWidth1").on("input",           function(){ ttSettings.thumbnailWidth1  = $(this).val(); updateChanges() });
        $("#thumbnailHeight1").on("input",          function(){ ttSettings.thumbnailHeight1 = $(this).val(); updateChanges() });
        $("#thumbnailWidth2").on("input",           function(){ ttSettings.thumbnailWidth2  = $(this).val(); updateChanges() });
        $("#thumbnailHeight2").on("input",          function(){ ttSettings.thumbnailHeight2 = $(this).val(); updateChanges() });

        $("#enableCustomHotKey").on("change",       function(){ ttSettings.enableCustomHotKey = this.checked; updateChanges() });
        $("#appHotKey").on("input",                 function(){ getAppHotKeyInput();            updateChanges() });
        $("#searchHotKey").on("input",              function(){ getSearchHotKeyInput();         updateChanges() });
        $("#savedSearchKeyPrefix").on("input",      function(){ getSavedSearchKeyPrefixInput(); updateChanges() });

        // Special handling for hotkey input by keypressing.
        let appKeyPressingHandler = function(e) {
            let ks = wwhotkey.KeySeq.ofKeyboardEvent(e);
            $("#appHotKey").val(ks.toString());
            getAppHotKeyInput();
            updateChanges();
            return stopEvent(e);
        };
        let $appKeyPressingBtn = $("#appKeyPressing");
        $appKeyPressingBtn.on("click", function(e){
            $appKeyPressingBtn.text("Click Again to End");
            $(document).on("keydown", appKeyPressingHandler);
            $(".keypress-cover").removeClass("d-none").on("click", function(e){
                $(this).addClass("d-none").off();
                $appKeyPressingBtn.text("Input by Key Press");
                $(document).off("keydown", appKeyPressingHandler);
            });
            return stopEvent(e);
        });

        // Special handling for hotkey input by keypressing.
        let searchKeyPressingHandler = function(e) {
            let ks = wwhotkey.KeySeq.ofKeyboardEvent(e);
            $("#searchHotKey").val(ks.toString());
            getSearchHotKeyInput();
            updateChanges();
            return stopEvent(e);
        };
        let $searchKeyPressingBtn = $("#searchKeyPressing");
        $searchKeyPressingBtn.on("click", function(e){
            $searchKeyPressingBtn.text("Click Again to End");
            $(document).on("keydown", searchKeyPressingHandler);
            $(".keypress-cover").removeClass("d-none").on("click", function(e){
                $(this).addClass("d-none").off();
                $searchKeyPressingBtn.text("Input by Key Press");
                $(document).off("keydown", searchKeyPressingHandler);
            });
            return stopEvent(e);
        });

        // Special handling for hotkey input by keypressing.
        let savedSearchKeyPrefixPressingHandler = function(e) {
            let ks = wwhotkey.KeySeq.ofKeyboardEvent(e);
            $("#savedSearchKeyPrefix").val(ks.toString());
            getSavedSearchKeyPrefixInput();
            updateChanges();
            return stopEvent(e);
        };
        let $savedSearchKeyPrefixPressingBtn = $("#savedSearchKeyPrefixPressing");
        $savedSearchKeyPrefixPressingBtn.on("click", function(e){
            $savedSearchKeyPrefixPressingBtn.text("Click Again to End");
            $(document).on("keydown", savedSearchKeyPrefixPressingHandler);
            $(".keypress-cover").removeClass("d-none").on("click", function(e){
                $(this).addClass("d-none").off();
                $savedSearchKeyPrefixPressingBtn.text("Input by Key Press");
                $(document).off("keydown", savedSearchKeyPrefixPressingHandler);
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
            ttSettings = TipTabSettings.ofLatest();
            //settings.pRemove().then( () => refreshSettings() );
            refreshSettings();
            updateChanges();
        });

    }

    function activateTab(tabid) {
        $("ul.tab li.tab-item[data-tabid='" + tabid + "']").addClass("active").siblings().removeClass("active");
        $(".tab-body#" + tabid).show().siblings().hide();
    }

    function getAppHotKeyInput() {
        let $appHotKey = $("#appHotKey");
        ttSettings.appHotKey = $appHotKey.val().trim();
        if (wwhotkey.KeySeq.validKeyIdSequence(ttSettings.appHotKey, true)) {
            $appHotKey.removeClass("is-error");
            $appHotKey.closest(".input-group").removeClass("is-error");
        } else {
            $appHotKey.addClass("is-error");
            $appHotKey.closest(".input-group").addClass("is-error");
        }
    }

    function getSearchHotKeyInput() {
        let $searchHotKey = $("#searchHotKey");
        ttSettings.searchHotKey = $searchHotKey.val().trim();
        if (wwhotkey.KeySeq.validKeyIdSequence(ttSettings.searchHotKey, true)) {
            $searchHotKey.removeClass("is-error");
            $searchHotKey.closest(".input-group").removeClass("is-error");
        } else {
            $searchHotKey.addClass("is-error");
            $searchHotKey.closest(".input-group").addClass("is-error");
        }
    }

    function getSavedSearchKeyPrefixInput() {
        let $input = $("#savedSearchKeyPrefix");
        let input  = $input.val().trim();
        if (wwhotkey.KeySeq.validModifierIdSequence(input, true)) {
            $input.removeClass("is-error");
            $input.closest(".input-group").removeClass("is-error");
        } else {
            $input.addClass("is-error");
            $input.closest(".input-group").addClass("is-error");
        }
        ttSettings.savedSearchKeyPrefix = input;
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

}());

export default the_module;


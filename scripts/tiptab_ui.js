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

(function(scope, modulename) {
    "use strict";

    // Imports:
    // import logger
    // import appcfg
    // import app
    // import dlg

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    var module = function() { };    // Module object to be returned; local reference to the package object for use below.
    if (modulename)
        scope[modulename] = module; // set module name in scope, otherwise caller sets the name with the returned module object.

    // Display types
    const DT_ALL_TABS = "all-tabs";
    const DT_BY_WINDOW = "by-window";
    const DT_BY_CONTAINER = "by-container";
    const DT_ALL_WINDOWS = "all-windows"
    const displayTypes = [DT_ALL_TABS, DT_BY_WINDOW, DT_BY_CONTAINER, DT_ALL_WINDOWS];

    // Overlay animation parameters
    const NOT_MOVING_THRESHOLD = 4000;
    const FASTER_POPUP_DELAY = 400;
    const NORMAL_POPUP_DELAY = 800;
    const FASTER_ANIMATION_MS = 200;
    const NORMAL_ANIMATION_MS = 500;

    // Module variables.
    let PIXELS_PER_REM = 16;
    let uiState = {};
    let lastCmd = "";
    let allTabs = [];
    let tabsById = {};
    let tabsByWindow = {};
    let tabsByContainer = {};
    let windows = [];
    let windowsById = {};
    let containers = [];
    let thumbnailsMap = {};         // keyed by tab id
    let thumbnailsPending = {};     // keyed by tab id
    let thumbnailFocusTid = null;
    let enableOverlay = true;
    let overlayShownTid = null;
    let mouseStopped = true;
    let mouseMovedTimer;
    let popupDelayTimer;
    let enableOverlayDelayTimer;
    let tiptabWindowActive = true;  // setupDOMListeners() is called too late after the window has been in focus.  Assume window is active on startup.

    function getFontSizeRem() {
        return parseFloat(getComputedStyle(document.documentElement).fontSize);
    }

    function remToPixels(rem) {
        return rem * PIXELS_PER_REM;
    }
    
    // Firefox's Content Security Policy for WebExtensions prohibits running any Javascript in the html page.
    // Wait for the page loaded event before doing anything.
    window.addEventListener("load", function(event){
        // Page is loaded and ready for the script to run.
        Promise.resolve()
            .then(() => log.info("Page initialization starts") )
            .then(() => PIXELS_PER_REM = getFontSizeRem() )
            .then(() => generateUILayout())
            .then(() => pLoadUiState())
            .then(() => refreshStaticUI())      // for the UI that need to be set up before setting up the DOM listeners.
            .then(() => setupDOMListeners())
            .then(() => reloadTabs())
            .then(() => refreshControls())
            .then(() => log.info("Page initialization done") )
            .catch( e => log.warn(e) )
    });

    async function saveUiStateNow() {
        //log.info("saveUiStateNow");
        if (uiState) {
            await browser.storage.local.set({ "uiState": uiState }).then(() => true);
        }
    }

    let dSaveUiState = app.debounce(saveUiStateNow, 10*1000, false);

    function pLoadUiState() {
        //log.info("pLoadUiState");
        return browser.storage.local.get("uiState")
            .then( objFromJson => {
                uiState = normalizeUiState(objFromJson.uiState);
            })
            .catch(e => {
                uiState = normalizeUiState();
                log.info(dump(e));
            })
    }

    function normalizeUiState(state) {
        let uiState = {};

        state = state || {};
        uiState.displayType = state.displayType || DT_ALL_TABS;
        uiState.searchTerms = state.searchTerms || [];

        return uiState;
    }

    function setupDOMListeners() {
        log.info("setupDOMListeners");

        // Dialog setup
        dlg.setupDlg("#text-dlg", true);

        // Global menu at the top navbar
        $("#global-cmds").on("click", ".cmd-refresh",   reloadTabs);
        $("#global-cmds").on("click", ".cmd-close-ui",  function(){ pSendCmd({ cmd: "close-ui" }) });
        $(".logo").on("click", function() {
            let manifest = browser.runtime.getManifest();
            dlg.openDlg("#text-dlg",
                        {
                            ".dlg-title": "About the Extension",
                            ".text-msg": `
                                <br>
                                <center style="font-size:150%;"><b>${manifest.name}</b></center>
                                <center>version: ${manifest.version}</center>
                                <center>Copyright 2018 ${manifest.author}</center>
                                <center>This software is licensed under the GPL 3 License.</center>
                                <br>
                                <center>The following 3rd party packages are used in this software:</center>
                                <center>  jQuery, licensed under the MIT License</center>
                                <center>  Spectre.css, licensed under the MIT License</center>
                                <center>  Moment.js, licensed under the MIT License</center>
                            `
                        },
                        {},
                        ".modal-submit");
        });        

        // Commands on v-btn-bar
        $(".v-btn-bar").on("click", ".cmd-all-tabs", function(){
            uiState.displayType = DT_ALL_TABS;
            refreshVBtnBarControls();
            refreshUIContent(false);
            saveUiStateNow();
        });
        $(".v-btn-bar").on("click", ".cmd-all-windows", function(){
            uiState.displayType = DT_ALL_WINDOWS;
            refreshVBtnBarControls();
            refreshUIContent(false);
            saveUiStateNow();
        });
        $(".v-btn-bar").on("click", ".cmd-by-window", function(){
            uiState.displayType = DT_BY_WINDOW;
            refreshVBtnBarControls();
            refreshUIContent(false);
            saveUiStateNow();
        });
        $(".v-btn-bar").on("click", ".cmd-by-container", function(){
            uiState.displayType = DT_BY_CONTAINER;
            refreshVBtnBarControls();
            refreshUIContent(false);
            saveUiStateNow();
        });

        // Events on the tab menu (at the upper right corner of each tab)
        $("#main-content").on("mouseover", ".cmd-tab-menu", function(e){
            e.preventDefault();     // Stop the mouseover bubbled up to tab-img
            $(this).css("opacity", "1.0");
            return false;
        });
        $("#main-content").on("mouseout", ".cmd-tab-menu", function(e){
            e.preventDefault();     // Stop the mouseout bubbled up to tab-img
            $(this).css("opacity", "0.2");
            return false;
        });
        $("#main-content").on("click", ".cmd-tab-menu", function(e){
            e.preventDefault();     // Stop the click bubbled up to tab-img
            return false;
        });

        // Events on tab thumbnails
        $("#main-content").on("click", ".tab-thumbnail", function(e){
            e.preventDefault();     // Stop the click event.
            let tid = $(this).closest(".tab-box").data("tid");
            activateTab(tabsById[tid].windowId, tid);
            return false;
        });
        $("#main-content").on("click", "a.tab-url", function(e){
            e.preventDefault();     // Stop the click event.
            let tid = $(this).closest(".tab-box").data("tid");
            activateTab(tabsById[tid].windowId, tid);
            return false;
        });

        // Events on the window lane
        $("#main-content").on("click", ".window-tab-lane", function(){
            activateWindow($(this).data("wid"));
        });

        // Search handler
        $(".cmd-search").on("click", function(){
            $(this).select();
        });
        $(".cmd-search").on("keyup paste", function(){
            uiState.searchTerms = $(this).val().split(" ");
            dSaveUiState();
            refreshUIContent(false);
        });

        $(window).focus(function(){
            tiptabWindowActive = true;
            $(".cmd-search").focus().select();
        });
        $(window).blur(function(){
            tiptabWindowActive = false;
            saveUiStateNow();
        });

        // Mouse events on thumbnail
        $("#main-content").on("mouseover", ".tab-img", function(){
            if (!tiptabWindowActive || !enableOverlay)
                return;
            // mouse enters the thumbnail image; starts the overlay popup sequence.
            let $tabbox = $(this).closest(".tab-box");
            let tid = $tabbox.data("tid");
            let thumbnail = thumbnailsMap[tid];
            if (thumbnail) {
                thumbnailFocusTid = tid;
                $("#overlay-content").removeClass("hidden");
                $(".overlay-img").css("opacity", "0.0").attr("src", thumbnail); // set the overlay image but hide it initially.
            }
        });
        $("#main-content").on("mouseout", ".tab-img", function(){
            closeOverlay();
        });
        $("#main-content").on("mousemove", function(){
            // Timer to detect the mouse has stopped for a while.  Whenever the mouse move, restart the timer.
            clearTimeout(mouseMovedTimer);
            mouseMovedTimer = setTimeout(function(){
                mouseStopped = true;
            }, NOT_MOVING_THRESHOLD);

            if (!thumbnailFocusTid || !enableOverlay)
                return;     // no focused thumbnail or overlay not enabled

            // Every mousemove hides the overlay-img.
            $(".overlay-img").css("opacity", "0.0");

            if (overlayShownTid == thumbnailFocusTid)
                return;     // overlay was previously shown and the focused tab image still has focus; no popup again until mouse moves out of the thumbnail.

            // Delay some time before showing the overlay-img.
            let popupDelay  = mouseStopped ? NORMAL_POPUP_DELAY  : FASTER_POPUP_DELAY;
            let animationMS = mouseStopped ? NORMAL_ANIMATION_MS : FASTER_ANIMATION_MS;
            clearTimeout(popupDelayTimer);
            popupDelayTimer = setTimeout(function(){
                if (thumbnailFocusTid && enableOverlay) {
                    let $tabImg     = $("#tid-" + thumbnailFocusTid + " img");
                    let $overlayImg = $(".overlay-img");
                    let animateTo   = {
                        top:        $overlayImg.position().top,
                        left:       $overlayImg.position().left,
                        width:      $overlayImg.width(),
                        height:     $overlayImg.height(),
                        opacity:    "1.0",
                    };

                    // Move overlayImg to tabImg's dimension, and animate back to its own dimension.
                    $overlayImg.offset($tabImg.offset());
                    $overlayImg.width($tabImg.width());
                    $overlayImg.height($tabImg.height());
                    $overlayImg.css("opacity", "0.1");
                    $overlayImg.animate(animateTo, animationMS, function(){
                        $overlayImg.removeAttr("style");        // reset the animation effect applied with the temporary style.
                    });
                    overlayShownTid = thumbnailFocusTid;
                    mouseStopped = false;
                }
            }, popupDelay);
        });

    }

    function generateUILayout() {
    }

    function refreshStaticUI() {
        log.info("refreshStaticUI");
        let manifest = browser.runtime.getManifest();
        $(".logo-version").html(manifest.version);

        $(".cmd-search").val(uiState.searchTerms.join(" ")).focus().select();
    }
    
    function refreshControls() {
        log.info("refreshControls");
        refreshVBtnBarControls();
    }

    function refreshVBtnBarControls() {
        displayTypes.forEach( dt => $(".cmd-" + dt).removeClass("active") );
        $(".cmd-" + uiState.displayType).addClass("active");
    }

    function reloadTabs() {
        browser.tabs.query({})
            .then( tabs => {
                allTabs = tabs;
                tabsById = allTabs.reduce( (map, tab) => { map[tab.id] = tab; return map }, {} );
            })
            .then( () => {
                let uniqueWinIds = new Set(allTabs.map( tab => tab.windowId ));
                let winIds = [...uniqueWinIds];
                tabsByWindow = winIds.reduce( (map, wid) => { map[wid] = []; return map }, {} );
                allTabs.forEach( tab => tabsByWindow[tab.windowId].push(tab) );
                return Promise.all( winIds.map( wid => browser.windows.get(wid) ) ).then( windowArray => {
                    windows = windowArray;
                    windowsById = windows.reduce( (map, win) => { map[win.id] = win; return map }, {});
                });
            })
            .then( () => {
                let uniqueContainerId = new Set(allTabs.map( tab => tab.cookieStoreId ));
                let containerIds = [...uniqueContainerId];
                tabsByContainer = containerIds.reduce( (map, wid) => { map[wid] = []; return map }, {} );
                allTabs.filter( tab => tab.cookieStoreId).forEach( tab => tabsByContainer[tab.cookieStoreId].push(tab) );
                return Promise.all(
                    containerIds.filter( cid => cid != "firefox-default" ).map( cid => {
                        return browser.contextualIdentities.get(cid)
                            .then( contextualIdentity => contextualIdentity )
                            .catch( e => {
                                log.error(e);
                                return {
                                    cookieStoreId: cid,
                                    name: cid,
                                    colorCode: "#gray",
                                    iconUrl: "",
                                }
                            })
                    })
                ).then( contextualIdentities => containers = contextualIdentities.concat([{
                    cookieStoreId:  "firefox-default",
                    name:           "outside of any defined container",
                    colorCode:      "#b0b0b0",
                    iconUrl:        "",
                }]) )
            })
            .then( () => refreshUIContent(true, true) )
    }

    function filterTab(tab, filterTokens) {
        let titleMatched = app.hasAll(tab.title, filterTokens, true);
        let urlMatched = app.hasAll(tab.url, filterTokens, true);
        return titleMatched || urlMatched;
    }

    function effectiveTabIdSet() {
        let filterTokens = app.toLower(uiState.searchTerms);
        return new Set(allTabs.filter( tab => filterTab(tab, filterTokens) ).map( tab => tab.id ));
    }

    function refreshUIContent(forceRefresh, zoomOut) {
        let effectiveTids = effectiveTabIdSet();

        if (effectiveTids.size > 0) {
            let $mainContent = $("#main-content");
            $mainContent.html(renderByDisplayType(effectiveTids, zoomOut));

            $("#empty-content").addClass("hidden");
            $("#main-content" ).removeClass("hidden");
            
            effectiveTids.forEach( tid => refreshThumbnail(tid, forceRefresh) );
            setupDragAndDrop(effectiveTids);

            if (zoomOut) {
                zoomOutAnimation(effectiveTids);
            }
        } else {
            let $mainContent = $("#main-content");
            $mainContent.html("");

            $("#empty-content").removeClass("hidden");
            $("#main-content" ).addClass("hidden");
        }

    }

    function zoomOutAnimation(effectiveTids) {
        effectiveTids.forEach( tid => {
            let $tabBox = $("#tid-" + tid);
            let w = $tabBox.width();
            $tabBox.removeClass("d-invisible").width(0).animate( {  width: w }, 500 );
        });
    }

    function renderByDisplayType(effectiveTids, asHidden) {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            return renderAllTabs(effectiveTids, asHidden);
        case DT_BY_WINDOW:
            return renderByWindow(effectiveTids, asHidden);
        case DT_BY_CONTAINER:
            return renderByContainer(effectiveTids, asHidden);
        case DT_ALL_WINDOWS:
            return renderAllWindows(effectiveTids, asHidden);
        }
        return "Unknown displayType " + uiState.displayType;
    }
    
    function renderContentTitle(title) {
        return `
            <div class="content-title">${title}</div>
        `;
    }
    
    function renderAllTabs(effectiveTids, asHidden) {
        return `
            ${ renderContentTitle("all tabs") }
            <div class="all-tab-lane">
              ${ renderTabBoxes(allTabs.filter( t => effectiveTids.has(t.id) ), asHidden, null) }
            </div>
        `;
    }

    function renderByWindow(effectiveTids, asHidden) {
        return `
            ${ renderContentTitle("tabs by window") }
            ${ windows.map( w => renderWindowTabs(w, effectiveTids, asHidden) ).join("\n") }
        `;
    }

    function renderByContainer(effectiveTids, asHidden) {
        return `
            ${ renderContentTitle("tabs by container") }
            ${ containers.map( c => renderContainerTabs(c, effectiveTids, asHidden) ).join("\n") }
        `;
    }

    function renderAllWindows(effectiveTids, asHidden) {
        return "all windows";
    }

    function renderWindowTabs(w, effectiveTids, asHidden) {
        let tabs = tabsByWindow[w.id].filter( t => effectiveTids.has(t.id) );
        if (tabs && tabs.length > 0) {
            return `
                <div class="window-tab-lane" data-wid="${w.id}">
                  <div class="window-tab-title" title="Window">${w.title}</div>
                  ${ renderTabBoxes(tabs, asHidden, "dummy-w-" + w.id) }
                </div>
            `;
        }
        return "";
    }

    function renderContainerTabs(c, effectiveTids, asHidden) {
        return `
            <div class="container-tab-lane" style="border: 0.1rem solid ${c.colorCode};">
              <div class="container-tab-title" title="${c.cookieStoreId == 'firefox-default' ? '' : 'Container'}">
                <img src="${c.iconUrl}" style="width:12px; height:12px; margin-right: 0.2rem; visibility: ${c.cookieStoreId == 'firefox-default' ? 'hidden' : 'visible'};">
                <span>${c.name}</span>
              </div>
              ${ renderTabBoxes(tabsByContainer[c.cookieStoreId].filter( t => effectiveTids.has(t.id) ), asHidden, "dummy-c-" + c.cookieStoreId) }
            </div>
        `;
    }

    function renderTabBoxes(tabs, asHidden, dummyId) {
        return `
            <div class="tab-grid">
              ${ tabs.map( tab => renderTabBox(tab, asHidden) ).join("\n") }
              ${ renderDummyTabBox(dummyId) }
            </div>
        `;
    }

    function renderTabBox(tab, asHidden) {
        return `
            <div class="tab-box ${asHidden ? 'd-invisible' : ''}" id="tid-${tab.id}" data-tid="${tab.id}" >
              <div class="tab-thumbnail">
                <!-- <button class="btn cmd-tab-menu"><i class="icon icon-caret"></i></button> -->
                <img class="tab-img">
              </div>
              <div class="tab-subtitle">
                <a class="tab-url" href="${tab.url}" title="${tab.title}">${tab.title}</a>
              </div>
            </div>   
        `;
    }

    function renderDummyTabBox(dummyId) {
        if (true || !dummyId)
            return "";
        return `
            <div class="tab-box" id="${dummyId}" style="pointer-events: none; visibility: hidden;">
              <div class="tab-thumbnail"><img class="tab-img"></div>
              <div class="tab-subtitle">
                <a class="tab-url" href="#">&nbsp;</a>
              </div>
            </div>   
        `;
    }

    const captureOpts = { format: "jpeg", quality: 50 };

    function refreshThumbnail(tid, forceRefresh) {
        if (thumbnailsPending[tid])
            return;

        if (thumbnailsMap[tid] && !forceRefresh) {
            renderThumbnail(tid, thumbnailsMap[tid]);
        } else {
            thumbnailsPending[tid] = true;
            browser.tabs.captureTab(tid, captureOpts)
                .then( thumbnail => {
                    thumbnailsMap[tid] = thumbnail;
                    thumbnailsPending[tid] = false;
                    renderThumbnail(tid, thumbnailsMap[tid]);
                })
                .catch( e => {
                    thumbnailsPending[tid] = false;
                });
        }
    }

    function renderThumbnail(tid, thumbnail) {
        $("#tid-" + tid + " img").attr("src", thumbnail);
    }


    function setupDragAndDrop(effectiveTids) {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            break;
        case DT_BY_WINDOW:
            effectiveTids.forEach( tid => {
                let $elem = $("#tid-" + tid).draggable({
                    revert:         "invalid",
                    revertDuration: 200,
                    zIndex:         100,
                    start:          function(event, ui){
                        enableOverlay = false;
                        addDropTabZones(tid, effectiveTids);
                        addDropEndZones();
                        $(".drop-tab-zone").droppable({
                            accept:     ".tab-box",
                            classes:    { "ui-droppable-hover": "drop-hover-gap" },
                            drop:       function(event, ui){ dropInFrontOfTab($(this), ui) },
                        });
                        $(".drop-end-zone").droppable({
                            accept:     ".tab-box",
                            classes:    { "ui-droppable-hover": "drop-hover-endzone" },
                            drop:       function(event, ui){ dropAtTheEnd($(this), ui) },
                        });
                    },
                    stop:           function(event, ui){
                        delayEnableOverlay(4000);
                        removeDropTabZones();
                        removeDropEndZones();
                    },
                })
            });

            effectiveTids.forEach( tid => $("#tid-" + tid).droppable({
                accept:     ".tab-box",
                classes:    { "ui-droppable-hover": "drop-hover-border" },
                greedy:     true,
                drop:       function(event, ui){ dropInFrontOfTab($(this), ui) },
            }) );

            break;
        case DT_BY_CONTAINER:
            break;
        case DT_ALL_WINDOWS:
            break;
        }
    }

    function addDropTabZones(draggedTid, effectiveTids) {
        let tabBoxMargin = remToPixels(0.6);        // see .tab-box style
        effectiveTids.forEach( tid => {
            if (draggedTid == tid)
                return;
            let $thumbnail  = $("#tid-" + tid + " .tab-thumbnail");
            let $tabzone    = $("<div class='drop-tab-zone' data-tid='" + tid + "'></div>");
            $tabzone.offset({ top: $thumbnail.offset().top,  left: $thumbnail.offset().left - tabBoxMargin*2 + 1 })
                .width( tabBoxMargin*2 - 2 )
                .height( $thumbnail.outerHeight() );
            $(document.body).append($tabzone);
        });
    }

    function removeDropTabZones() {
        $(".drop-tab-zone").remove();
    }

    function addDropEndZones() {
        windows.forEach( w => {
            let $winLane    = $(".window-tab-lane[data-wid='" + w.id + "']");
            let $lastTab    = $winLane.find(".tab-thumbnail").last();
            if ($lastTab.length == 0)
                return;
            let $endzone    = $("<div class='drop-end-zone' data-wid='" + w.id + "'></div>");
            let endzoneLeft = $lastTab.offset().left + $lastTab.outerWidth() + 2;
            $endzone.offset({ top: $lastTab.offset().top,  left: endzoneLeft })
                .width($winLane.offset().left + $winLane.width() - endzoneLeft - 1)
                .height($lastTab.outerHeight());
            $(document.body).append($endzone);
        });
    }

    function removeDropEndZones() {
        $(".drop-end-zone").remove();
    }

    function dropInFrontOfTab($dest, ui) {
        // Move the tab in front of the destination tab.
        let srcTab  = tabsById[ui.draggable.data("tid")];
        let destTab = tabsById[$dest.data("tid")];
        let srcTabs = tabsByWindow[srcTab.windowId];
        let srcIdx  = srcTabs.findIndex( tab => tab.id == srcTab.id );
        let destTabs= tabsByWindow[destTab.windowId];
        let destIdx = destTabs.findIndex( tab => tab.id == destTab.id );
        if (srcTab.windowId == destTab.windowId && srcIdx < destIdx) {
            destIdx--;      // Src and dest tabs on the same window, and src tab is before dest, decrement index by 1 since the src tab will be removed.
        }
        browser.tabs.move(srcTab.id, { windowId: destTab.windowId, index: destIdx})
            .then( () => {
                let destTabs = tabsByWindow[destTab.windowId];
                let srcIdx = srcTabs.findIndex( tab => tab.id == srcTab.id );
                srcTabs.splice(srcIdx, srcIdx);
                destTabs.splice(destIdx, 0, srcTab);
                srcTab.windowId = destTab.windowId;

                let $srcTabBox  = $("#tid-" + srcTab.id);
                let $destTabBox = $("#tid-" + destTab.id);
                $srcTabBox.detach();
                $srcTabBox.css({"top":"", "left":""});      // reset dragging position.
                $srcTabBox.insertBefore($destTabBox);
                let toWidth = $srcTabBox.width();
                $srcTabBox.width(0).animate({ width: toWidth }, 300);
            });
    }                                   

    function dropAtTheEnd($dest, ui) {
        let srcTab  = tabsById[ui.draggable.data("tid")];
        let destWid = $dest.data("wid");  // data-wid on .drop-end-zone.
        browser.tabs.move(srcTab.id, { windowId: destWid, index: -1}).then( () => {
            // Move the tab to the end of the window lane.
            let srcTabs = tabsByWindow[srcTab.windowId];
            let destTabs= tabsByWindow[destWid];
            let srcIdx  = srcTabs.findIndex( tab => tab.id == srcTab.id );
            srcTabs.splice(srcIdx, srcIdx);
            destTabs.push(srcTab);
            srcTab.windowId = destWid;
            let $tabBox = $("#tid-" + srcTab.id);
            $tabBox.css({ top:"", left:"" });   // reset the dragging position
            if (!$tabBox.is(":last-child")) {
                let tabWidth = $tabBox.width();
                $tabBox.css({ visibility: "hidden" }).animate({ width: 0 }, 200, function(){
                    $tabBox.detach();
                    $(".window-tab-lane[data-wid='" + destWid + "'] .tab-grid").append($tabBox);
                    $tabBox.width(tabWidth).css({ visibility: "visible" });
                });
            } else {
                $tabBox.detach();
                $(".window-tab-lane[data-wid='" + destWid + "'] .tab-grid").append($tabBox);
            }
        });
    }
                                   
    function pSendCmd(msg) {
        lastCmd = msg.cmd;
        return browser.runtime.sendMessage(msg);    // response is returned in .then( response => ... ).
    }

    function dim($elem) {
        let offset = $elem.offset();
        return { left: offset.left, top: offset.top, width: $elem.width(), height: $elem.height() };
    }

    function setDim($elem, left, top, width, height) {
        $elem.offset({ left: left, top: top }).width(width).height(height);
    }

    function activateTab(wid, tid) {
        tiptabWindowActive = false;
        closeOverlay();
        browser.tabs.update(tid, { active: true }).then( () => browser.windows.update(wid, {focused: true}) );
    }

    function activateWindow(wid) {
        tiptabWindowActive = false;
        closeOverlay();
        browser.windows.update(wid, {focused: true});
    }

    function closeOverlay() {
        thumbnailFocusTid = null;
        overlayShownTid = null;
        $("#overlay-content").addClass("hidden");
        $(".overlay-img").attr("src", "#");
    }

    function delayEnableOverlay(delayMS) {
        clearTimeout(enableOverlayDelayTimer);
        enableOverlayDelayTimer = setTimeout(function(){
            enableOverlay = true;
        }, delayMS);
    }

    log.info("module loaded");
    return module;

}(this, "tiptab_ui"));    // Pass in the global scope as 'this' scope.



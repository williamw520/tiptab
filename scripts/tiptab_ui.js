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
    // import wwhotkey
    let TipTabSettings = settings.TipTabSettings;

    let log = new logger.Logger(appcfg.APPNAME, modulename, appcfg.LOGLEVEL);

    var module = function() { };    // Module object to be returned; local reference to the package object for use below.
    if (modulename)
        scope[modulename] = module; // set module name in scope, otherwise caller sets the name with the returned module object.

    const tiptabUrl = browser.extension.getURL("tiptab.html");
    function is_tiptaburl(url) { return url.startsWith(tiptabUrl) };    // sometimes # is added to the end of the url; just check prefix.

    // Display types
    const DT_ALL_TABS = "all-tabs";
    const DT_WINDOW = "by-window";
    const DT_CONTAINER = "by-container";
    const DT_ALL_WINDOWS = "all-windows"
    const displayTypes = [DT_ALL_TABS, DT_WINDOW, DT_CONTAINER, DT_ALL_WINDOWS];
    function is_all_tabs()      { return uiState.displayType == DT_ALL_TABS }
    function is_by_window()     { return uiState.displayType == DT_WINDOW }
    function is_by_container()  { return uiState.displayType == DT_CONTAINER }
    function is_all_windows()   { return uiState.displayType == DT_ALL_WINDOWS }

    // Overlay animation parameters
    const NOT_MOVING_THRESHOLD = 4000;
    const FASTER_POPUP_DELAY = 400;
    const NORMAL_POPUP_DELAY = 800;
    const FASTER_ANIMATION_MS = 200;
    const NORMAL_ANIMATION_MS = 500;

    // Special Firefox container types.
    const CT_FIREFOX_DEFAULT = "firefox-default";
    const CT_FIREFOX_PRIVATE = "firefox-private";
    const CT_SPECIAL_TYPES = [CT_FIREFOX_DEFAULT, CT_FIREFOX_PRIVATE];
    function is_firefox_default(id) { return id == CT_FIREFOX_DEFAULT }
    function is_firefox_private(id) { return id == CT_FIREFOX_PRIVATE }
    function is_real_container(id)  { return !is_firefox_default(id) && !is_firefox_private(id) }

    // Colors
    //const COLOR_DEFAULT = "#c7c9cd";
    const COLOR_DEFAULT = "#97999d";
    const COLOR_PRIVATE = "#8D20AE";    // purple

    // Chars
    const CHAR_CHECKMARK = "&#x2713;";

    // Dimensions for thumbnailSize.  See --img-width-base and --img-height-base in .css file.
    const imgWidth  = ["8.0rem", "12rem", "17.77rem"];
    const imgHeight = ["4.5rem", "6.75rem",  "10rem"];

    // Module variables.
    let ttSettings = new TipTabSettings();
    let defaultSeq;
    let settingSeq;
    let currentSeq = wwhotkey.ofKeySeq();
    let pixels_per_rem = 16;
    let currentWid;
    let currentTid;
    let currentLastActiveTabId = -1;

    let uiState = {};
    let tabById = {};               // the only map holding the Tab objects.
    let windowById = {};            // the only map holding the Window objects.  note that the tabs member is not loaded; use tabIdsByWid instead.
    let windowIds = [];             // track the order of the windows, id only.
    let tabIdsByWid = {};           // track the list of tab ids by window id.
    let containerById = {};         // the only map holding the Container objects
    let containerIds = [];          // track the order of the containers, id only.
    let tabIdsByCid = {};           // track the list of tab ids by container id.

    let effectiveTabIds = [];       // list of tab ids after filtering.
    let effectiveTidSet = new Set();
    let thumbnailsMap = {};         // keyed by tab id
    let thumbnailsCapturing = {};   // keyed by tab id

    let thumbnailFocusTid = null;   // related to thumbnail popup on mouse move.
    let enableOverlay = true;
    let overlayShownTid = null;
    let mouseStopped = true;
    let mouseMovedTimer;
    let popupDelayTimer;
    let enableOverlayDelayTimer;

    let tiptabWindowActive = true;  // setupDOMListeners() is called too late after the window has been in focus.  Assume window is active on startup.

    // Firefox's Content Security Policy for WebExtensions prohibits running any Javascript in the html page.
    // Wait for the page loaded event before doing anything.
    window.addEventListener("load", function(event){
        // Page is loaded and ready for the script to run.
        Promise.resolve()
            //.then(() => log.info("Page initialization starts") )
            .then(() => settings.pLoad().then(tts => ttSettings = tts) )
            .then(() => pixels_per_rem = getFontSizeRem() )
            .then(() => pGetCurrnetTab() )
            .then(() => pGetLastActiveTab() )
            .then(() => generateUILayout() )
            .then(() => pLoadUiState() )
            .then(() => refreshStaticUI() )     // for the UI that need to be set up before setting up the DOM listeners.
            .then(() => setupDOMListeners() )
            .then(() => setupKeyboardListeners() )
            .then(() => pReloadRedrawRefreshContent() )
            .then(() => redrawRefreshControls() )
            .then(() => browser.storage.onChanged.addListener(storage_onChanged) )
            .then(() => browser.windows.onCreated.addListener(windows_onCreated) )
            .then(() => browser.windows.onRemoved.addListener(windows_onRemoved) )
            .then(() => browser.tabs.onActivated.addListener(tabs_onActivated) )
            .then(() => browser.tabs.onRemoved.addListener(tabs_onRemoved) )
            .then(() => browser.tabs.onUpdated.addListener(tabs_onUpdated) )
            //.then(() => log.info("Page initialization done") )
            .catch( e => log.warn(e) )
    });

    function pGetCurrnetTab() {
        return browser.tabs.getCurrent().then( tab => {
            currentWid = tab.windowId;
            currentTid = tab.id;
        });
    }

    function pGetLastActiveTab() {
        return pSendCmd({ cmd: "last-active-tab", wid: currentWid, currentTid: currentTid }).then( res => currentLastActiveTabId = res.lastActiveTabId );
    }

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
        uiState.thumbnailSize = state.thumbnailSize || 0;
        uiState.windowsHiddenByUser = state.windowsHiddenByUser || {};          // a flag means the window is deselected.
        uiState.containersHiddenByUser = state.containersHiddenByUser || {};    // a flag means the container is deselected.

        return uiState;
    }

    function storage_onChanged(storageChange) {
        // Monitor settings storage change.
        if (app.has(storageChange, "tipTabSettings")) {
            ttSettings = new TipTabSettings(storageChange.tipTabSettings.newValue);
            setupKeyboardListeners();
            redrawRefreshContentOnFiltering();
            redrawRefreshControls();
        }
    }

    function windows_onCreated(win) {
        // log.info("windows_onCreated", win);
        windowIds.push(win.id);
        windowById[win.id] = win;
        tabIdsByWid[win.id] = [];
        addWindowLane(win);
    }

    // This should be called after tabs_onRemoved on all the tabs in the window.
    function windows_onRemoved(wid) {
        // log.info("windows_onRemoved", wid);
        removeWindowLane(wid);
        windowIds = windowIds.filter( id => id != wid );
        delete windowById[wid];
        delete tabIdsByWid[wid];
    }

    function tabs_onActivated(info) {
        // log.info("tabs_onActivated", info);
        if (tabById.hasOwnProperty(info.tabId))
            transitionActiveTabs(info.tabId);
    }

    function transitionActiveTabs(newActiveTid) {
        let oldActiveId = tabIdsByWid[tabById[newActiveTid].windowId].find( tid => tabById[tid].active );
        if (oldActiveId) {
            tabById[newActiveTid].active = true;
            tabById[oldActiveId].active = false;
            refreshTabBoxes([oldActiveId, newActiveTid], false);
        } else {
            tabById[newActiveTid].active = true;
            refreshTabBoxes([newActiveTid], false);
        }
    }

    // This is called before windows_onRemoved() when the window and its tabs are removed.
    function tabs_onRemoved(tabId, info) {
        if (tabById[tabId]) {
            // log.info("tabs_onRemoved.  Still has tab ", tabId, info);
            removeTabBoxes([tabId]);
        } else {
            // log.info("tabs_onRemoved.  Tab has already been cleaned up " + tabId);
        }
    }

    function tabs_onUpdated(tabId, info, tab) {
        // log.info("tabs_onUpdated ", tabId, info, tab);

        // if (tab && tab.hasOwnProperty("url") && is_tiptaburl(tab.url))  // skip the TipTab tab itself.
        //     return;

        createTabData(tab);
        if (info.hasOwnProperty("url"))
            tabById[tabId].url = info.url;
        if (info.hasOwnProperty("title"))
            tabById[tabId].title = info.title;
        if (info.hasOwnProperty("favIconUrl")) {
            tabById[tabId].favIconUrl = info.favIconUrl;
            if (tab.url == "about:newtab") {
                refreshTabData(tab);
            }
        }
        if (info.hasOwnProperty("status") && info.status == "complete") {
            refreshTabData(tab);
        }
    }


    function setupDOMListeners() {
        //log.info("setupDOMListeners");

        // Dialog setup
        dlg.setupDlg("#about-dlg", true);

        // Global menu at the top navbar
        $("#global-cmds").on("click", ".cmd-options",           function(){ browser.runtime.openOptionsPage() });
        $("#global-cmds").on("click", ".cmd-refresh",           pReloadRedrawRefreshContent);
        $("#global-cmds").on("click", ".cmd-undo-close",        function(){ undoCloseTab()                  });
        $("#global-cmds").on("click", ".cmd-mute-all",          function(){ muteTabs(null, true)            });
        $("#global-cmds").on("click", ".cmd-unmute-all",        function(){ muteTabs(null, false)           });
        $("#global-cmds").on("click", ".cmd-close-ui",          function(){ pSendCmd({ cmd: "close-ui" })   });
        $("#global-cmds").on("click", ".cmd-about",             showAboutDlg);
        $(".logo").on("click",                                  showAboutDlg);

        // Commands on v-btn-bar
        $(".v-btn-bar").on("click", ".cmd-all-tabs",            function(){ selectDisplayType(DT_ALL_TABS)      });
        $(".v-btn-bar").on("click", ".cmd-by-window",           function(){ selectDisplayType(DT_WINDOW)        });
        $(".v-btn-bar").on("click", ".cmd-by-container",        function(){ selectDisplayType(DT_CONTAINER)     });
        $(".v-btn-bar").on("click", ".cmd-all-windows",         function(){ selectDisplayType(DT_ALL_WINDOWS)   });
        $(".v-btn-bar").on("click", ".cmd-small-size",          function(){ setThumbnailSize(0)                 });
        $(".v-btn-bar").on("click", ".cmd-medium-size",         function(){ setThumbnailSize(1)                 });
        $(".v-btn-bar").on("click", ".cmd-large-size",          function(){ setThumbnailSize(2)                 });

        // Window command handlers
        $("#main-content").on("click", ".cmd-reload-w-tabs",    function(){ reloadWindowTabs($(this).closest(".window-lane").data("wid"))           });
        $("#main-content").on("click", ".cmd-copy-w-title-url", function(){ copyWindowTabTitleUrls($(this).closest(".window-lane").data("wid"))     });
        $("#main-content").on("click", ".cmd-undo-close",       function(){ undoCloseTab()                                                          });
        $("#main-content").on("click", ".cmd-mute-w-all",       function(){ muteTabs($(this).closest(".window-lane").data("wid"), true)             });
        $("#main-content").on("click", ".cmd-unmute-w-all",     function(){ muteTabs($(this).closest(".window-lane").data("wid"), false)            });
        $("#main-content").on("click", ".cmd-pin-w-all",        function(){ pinWindowTabs($(this).closest(".window-lane").data("wid"), true)        });
        $("#main-content").on("click", ".cmd-unpin-w-all",      function(){ pinWindowTabs($(this).closest(".window-lane").data("wid"), false)       });

        // Tab command handlers
        $("#main-content").on("click", ".cmd-close-tab",        function(){ closeTab($(this).closest(".tab-box").data("tid"))                       });
        $("#main-content").on("click", ".cmd-reload-tab",       function(){ reloadTab($(this).closest(".tab-box").data("tid"))                      });
        $("#main-content").on("click", ".cmd-duplicate-tab",    function(){ duplicateTab($(this).closest(".tab-box").data("tid"))                   });
        $("#main-content").on("click", ".cmd-move-tab-new",     function(){ moveToNewWindow($(this).closest(".tab-box").data("tid"))                });
        $("#main-content").on("click", ".cmd-copy-tab-url",     function(){ copyTabUrl($(this).closest(".tab-box").data("tid"))                     });
        $("#main-content").on("click", ".cmd-save-tab-img",     function(){ saveTabImg($(this).closest(".tab-box").data("tid"))                     });
        $("#main-content").on("click", ".cmd-close-others",     function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "all")          });
        $("#main-content").on("click", ".cmd-close-left",       function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "left")         });
        $("#main-content").on("click", ".cmd-close-right",      function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "right")        });
        $("#main-content").on("click", ".cmd-toggle-pinned",    function(){ toggleTabPinned($(this).closest(".tab-box").data("tid"))                });
        $("#main-content").on("click", ".cmd-toggle-muted",     function(){ toggleTabMuted($(this).closest(".tab-box").data("tid"))                 });

        // Tab topbar event handlers
        $("#main-content").on("click", ".tab-topbar",           function(){ $(this).closest(".tab-box").focus()                                     });

        // Footer command handlers
        $(".footer-bar").on("click", ".footer-btn",             function(){ toggleFooterBtn($(this).data("wid"), $(this).data("cid"))               });

        // Events on tab thumbnails
        $("#main-content").on("click", ".tab-thumbnail",        function(e){ activateTid($(this).closest(".tab-box").data("tid")); return stopEvent(e) });

        // Events on the window lane
        $("#main-content").on("click", ".window-topbar",        function(){ activateWindow($(this).closest(".window-lane").data("wid"))             });

        // Command containers stop event propagation
        $("#main-content").on("click", ".window-topbar-menu, .tab-topbar-menu, .tab-topbar-cmds, .status-private, .status-pin, .status-mute", function(e){ return stopEvent(e) });

        // Search handler
        $(".cmd-search").on("click",                            function(){ $(this).select()            });
        $(".cmd-search").on("keyup paste",                      function(){ searchTabs($(this).val())   });

        $(window).focus(function(){
            tiptabWindowActive = true;
            initialFocus().select();
        });
        $(window).blur(function(){
            //log.info("tiptabWindow shutdown");
            tiptabWindowActive = false;
            saveUiStateNow();
        });

        // Mouse events on thumbnail
        $("#main-content").on("mouseover", "img.tab-img", function(){
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
        $("#main-content").on("mouseout", "img.tab-img", function(){
            closeOverlay();
        });
        $("#main-content").on("mousemove", function(){
            // Timer to detect the mouse has stopped for a while.  Whenever the mouse move, restart the timer.
            clearTimeout(mouseMovedTimer);
            mouseMovedTimer = setTimeout(function(){
                mouseStopped = true;
            }, NOT_MOVING_THRESHOLD);

            if (!ttSettings.thumbnailPopup || !thumbnailFocusTid || !enableOverlay)
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
                    let $tabImg     = $tabimg(thumbnailFocusTid);
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
                    $overlayImg.css("opacity", "0.3");
                    $overlayImg.animate(animateTo, animationMS, function(){
                        $overlayImg.removeAttr("style");        // reset the animation effect applied with the temporary style.
                    });
                    overlayShownTid = thumbnailFocusTid;
                    mouseStopped = false;
                }
            }, popupDelay);
        });

    }

    function setupKeyboardListeners() {
        $("#main-content").off("keyup", ".tab-box", onTabBoxEnterKey).on("keyup", ".tab-box", onTabBoxEnterKey);

        document.removeEventListener("keydown", hotKeydownHandler, false);
        document.removeEventListener("keyup", hotKeyupHandler, false);
        defaultSeq = wwhotkey.ofKeySeq(getDefaultHotKey());
        settingSeq = wwhotkey.ofKeySeq(ttSettings.enableCustomHotKey ? ttSettings.appHotKey : "");
        document.addEventListener("keydown", hotKeydownHandler, false);
        document.addEventListener("keyup", hotKeyupHandler, false);
    }
    
    function getDefaultHotKey() {
        try {
            let manifest = browser.runtime.getManifest();
            return manifest.commands._execute_browser_action.suggested_key.default;
        } catch (err) {
            return "Ctrl-Shift-F";
        }
    }

    function hotKeydownHandler(e) {
        if (ttSettings.enableCustomHotKey) {
            currentSeq.fromEvent(e);
            if (defaultSeq.equals(currentSeq) || settingSeq.equals(currentSeq)) {
                focusNextTabbox();
            }
        }
    }

    function hotKeyupHandler(e) {
        currentSeq.clear();
    }

    function focusNextTabbox() {
        if (document.activeElement) {
            let $tabbables = $("[tabindex]:not([disabled]):not([tabindex='-1'])");
            let activeIndex = $tabbables.index($(document.activeElement));
            if (activeIndex >= 0) {
                $tabbables[ (activeIndex + 1) % $tabbables.length ].focus();
            }
        }
    }    


    function generateUILayout() {
    }

    function refreshStaticUI() {
        //log.info("refreshStaticUI");

        setImgDimension(imgWidth[uiState.thumbnailSize], imgHeight[uiState.thumbnailSize]);

        $(".cmd-search").val(uiState.searchTerms.join(" ")).focus().select();
    }
    
    function redrawRefreshControls() {
        // VBar buttons are always visible and no need to redraw.
        refreshVBtnBarControls();
        redrawFooterControls();     // footer controls are dynamic and need redrawing based on current state of the data.
        refreshFooterControls();
    }

    function refreshControls() {
        refreshVBtnBarControls();
        refreshFooterControls();
    }

    function refreshVBtnBarControls() {
        displayTypes.forEach( dt => $(".cmd-" + dt).removeClass("active") );
        $(".cmd-" + uiState.displayType).addClass("active");

        $(".cmd-small-size").removeClass("active");
        $(".cmd-medium-size").removeClass("active");
        $(".cmd-large-size").removeClass("active");
        if (uiState.thumbnailSize == 0) {   $(".cmd-small-size").addClass("active")     }
        if (uiState.thumbnailSize == 1) {   $(".cmd-medium-size").addClass("active")    }
        if (uiState.thumbnailSize == 2) {   $(".cmd-large-size").addClass("active")     }
    }

    function redrawFooterControls() {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
        case DT_WINDOW:
            redrawWindowFooterBtns();
            break;
        case DT_CONTAINER:
            redrawContainerFooterBtns();
            break;
        }
    }

    function refreshFooterControls() {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
        case DT_WINDOW:
            refreshWindowFooterBtns();
            break;
        case DT_CONTAINER:
            refreshContainerFooterBtns();
            break;
        }
    }


    function pReloadRedrawRefreshContent() {
        return pReloadTabsAndWindows().then( () => redrawRefreshUIContent(true, true) );
    }

    function pReloadTabsAndWindows() {
        return browser.tabs.query({})
            .then( tabs => {
                // tabs            = tabs.filter( tab => !is_tiptaburl(tab.url) );     // get rid of the TipTab tab.
                tabById         = tabs.reduce( (map, tab) => { map[tab.id] = tab; return map }, {} );
                return tabs;
            }).then( tabs => {
                let uniqueIds   = new Set(tabs.map( tab => tab.windowId ));
                let winIds      = [...uniqueIds];
                tabIdsByWid     = winIds.reduce( (map, wid) => { map[wid] = []; return map }, {} );
                tabs.forEach( tab => tabIdsByWid[tab.windowId].push(tab.id) );
                return Promise.all( winIds.map( wid => browser.windows.get(wid) ));
            }).then( windows => {
                windowById      = windows.reduce((map, win) => { map[win.id] = win; return map }, {});
                windowIds       = windows.map( w => w.id );
            }).then( () => pGetContainerInfos() )               // get the containers defined in the system.
            .then( contextualIdentities => {
                containerIds    = contextualIdentities.map( c => c.cookieStoreId );
                containerById   = contextualIdentities.reduce( (map, c) => { map[c.cookieStoreId] = c; return map }, {} );
            }).then( () => {
                let uniqueCids  = new Set( Object.values(tabById).map( tab => tab.cookieStoreId ));   // get containerIds from tabs.
                let cids        = [...uniqueCids];
                return Promise.all( cids.map( cid => pGetContainerInfo(cid) ));
            }).then( contextualIdentitiesFromTabs => {
                let extraCids   = contextualIdentitiesFromTabs.map( ci => ci.cookieStoreId ).filter( cid => !containerById.hasOwnProperty(cid) );
                containerIds.push(...extraCids);
                let extraCtners = contextualIdentitiesFromTabs.reduce( (map, c) => { map[c.cookieStoreId] = c; return map }, {} );
                containerById   = Object.assign(extraCtners, containerById);
                tabIdsByCid     = containerIds.reduce( (map, cid) => { map[cid] = []; return map }, {} );
                Object.values(tabById).forEach( tab => tabIdsByCid[tab.cookieStoreId].push(tab.id) );
            }).then( () => {
                updateEffectiveTabIds();
            })
    }

    function createTabData(newTab) {
        if (tabById.hasOwnProperty(newTab.id))
            return;
        tabById[newTab.id] = newTab;
        app.addAt(tabIdsByWid[newTab.windowId], newTab.id, newTab.index);
        app.addAt(tabIdsByCid[newTab.cookieStoreId], newTab.id, newTab.index);
        thumbnailsMap[newTab.id] = null;
        thumbnailsCapturing[newTab.id] = null;
    }

    function refreshTabData(tab) {
        updateEffectiveTabIds();
        renderTabData(tab.id);
        if (tab.active)
            transitionActiveTabs(tab.id);
        if (ttSettings.realtimeUpdateThumbnail || !thumbnailsMap[tab.id])
            refreshThumbnail(tab.id, true);     // force recapturing image
    }
 
    function renderTabData(tid) {
        //resetDragAndDrop();
        let tab = tabById[tid];
        switch (uiState.displayType) {
            // TODO: draw one tab instead of all.
        case DT_ALL_TABS:
            refreshAllTabsContent(false, false);
            effectiveTabIds.forEach( tid => refreshThumbnail(tid, false) );     // not force recapturing image
            break;
        case DT_WINDOW:
            refreshWindowTabs(tab.windowId);
            effectiveWindowTids(tab.windowId).forEach( tid => refreshThumbnail(tid, false) );
            break;
        case DT_CONTAINER:
            refreshContainerTabs(tab.cookieStoreId, false);
            effectiveContainerTids(tab.cookieStoreId).forEach( tid => refreshThumbnail(tid, false) );
            break;
        }
        setupDragAndDrop();
    }

    function deleteTabData(tid) {
        delete tabById[tid];
        for (var wid in tabIdsByWid) {
            tabIdsByWid[wid] = tabIdsByWid[wid].filter( tabId => tabId != tid );
        }
        for (var cid in tabIdsByCid) {
            tabIdsByCid[cid] = tabIdsByCid[cid].filter( tabId => tabId != tid );
        }
        delete thumbnailsMap[tid];
        delete thumbnailsCapturing[tid];
        if (thumbnailFocusTid == tid)
            thumbnailFocusTid = null;
        if (overlayShownTid == tid)
            overlayShownTid = null;
    }

    function pGetContainerInfos() {
        return browser.contextualIdentities.query({})
            .then( contextualIdentities => {
                contextualIdentities.unshift({
                        cookieStoreId:  CT_FIREFOX_PRIVATE,
                        name:           "Private Browsing",
                        colorCode:      COLOR_PRIVATE,
                        iconUrl:        "",
                });
                contextualIdentities.unshift({
                        cookieStoreId:  CT_FIREFOX_DEFAULT,
                        name:           "General Tabs",
                        colorCode:      COLOR_DEFAULT,
                        iconUrl:        "",
                });
                return contextualIdentities;
            });
    }
    
    function pGetContainerInfo(cid) {
        // Get the container info.  Return a fake one in case not found.
        return browser.contextualIdentities.get(cid)
            .catch( e => {
                //log.error("cid not found " + cid, e);
                switch (cid) {
                case CT_FIREFOX_PRIVATE:
                    return {
                        cookieStoreId:  CT_FIREFOX_PRIVATE,
                        name:           "Private Browsing",
                        colorCode:      COLOR_PRIVATE,
                        iconUrl:        "",
                    };
                case CT_FIREFOX_DEFAULT:
                    return {
                        cookieStoreId:  CT_FIREFOX_DEFAULT,
                        name:           "General Tabs",
                        colorCode:      COLOR_DEFAULT,
                        iconUrl:        "",
                    };
                default:
                    return {
                        cookieStoreId:  cid,
                        name:           cid,
                        colorCode:      "gray",
                        iconUrl:        "",
                    };
                }
            });
    }

    function wasTabActive(tab) {
        return (tab.hasOwnProperty("windowId") && tab.windowId == currentWid && tab.id == currentLastActiveTabId) ? true : tab.active;
    }

    function countTabs() {
        return Object.keys(tabById).length;
    }

    function getTabIds() {
        return [].concat.apply([], Object.values(tabIdsByWid));     // join all the tabId arrays from tabIdsByWid.
    }

    function toTabs(tids) {
        return tids.map( tid => tabById[tid] );
    }

    function toTabIds(tabs) {
        return tabs.map( tab => tab.id );
    }

    function orderTabIndex(wid) {
        tabIdsByWid[wid].forEach( (tid, index) => tabById[tid].index = index );
    }

    function isHidden(tab) {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
        case DT_WINDOW:
            return app.boolVal(uiState.windowsHiddenByUser, tab.windowId);
        case DT_CONTAINER:
            return app.boolVal(uiState.containersHiddenByUser, tab.cookieStoreId);
        }
        return false;
    }

    function filterTab(tab, filterTokens) {
        let titleMatched = app.hasAll(tab.title, filterTokens, true);
        let urlMatched = app.hasAll(tab.url, filterTokens, true);
        return (titleMatched || urlMatched) && !isHidden(tab);
    }

    function filterTabs() {
        let filterTokens = app.toLower(uiState.searchTerms);
        return toTabs(getTabIds()).filter( tab => filterTab(tab, filterTokens) );
    }

    function updateEffectiveTabIds() {
        effectiveTabIds = toTabIds(filterTabs());
        effectiveTidSet = new Set(effectiveTabIds);
    }

    function effectiveWindowTids(wid) {
        return tabIdsByWid[wid].filter( tid => effectiveTidSet.has(tid) );
    }

    function effectiveWindowTabs(wid) {
        return toTabs(effectiveWindowTids(wid));
    }

    function effectiveContainerTids(cid) {
        return tabIdsByCid[cid].filter( tid => effectiveTidSet.has(tid) );
    }

    function effectiveContainerTabs(cid) {
        return toTabs(effectiveContainerTids(cid));
    }

    function redrawRefreshContentOnFiltering() {
        updateEffectiveTabIds();
        redrawRefreshUIContent(false, false);
    }

    function redrawRefreshUIContent(forceRefreshImg, zoomOut) {
        resetDragAndDrop();
        if (effectiveTabIds.length > 0) {
            redrawContentLayout();
            $("#empty-content").addClass("hidden");
            $("#main-content" ).removeClass("hidden");  // show the content to force layout calculation; animations in the next step use width and height.
            refreshContent(forceRefreshImg, zoomOut);
        } else {
            $("#main-content").html("");
            $("#main-content").addClass("hidden");
            $("#empty-content").removeClass("hidden");
            if (countTabs() > 0) {
                $("#empty-msg1").text("Tabs are hidden due to filtering by search, or by window or container selection at footer.");
            } else {
                $("#empty-msg1").text("");
            }
        }
        setupDragAndDrop();
    }

    function zoomOutAnimation(tids) {
        if (tids.length == 0)
            return;
        let total = 500;
        let inc = total / tids.length;
        let delayMS = 0;
        tids.forEach( tid => {
            let $tabBox = $tabbox(tid);
            $tabBox.removeClass("d-invisible").css("opacity", "0").stop().delay(delayMS).animate( {  opacity: 1 }, 100 );
            delayMS += inc;
        });
    }

    // Re-draw/re-generate the UI content layout based on the current displayType.
    function redrawContentLayout() {
        let $mainContent = $("#main-content");

        switch (uiState.displayType) {
        case DT_ALL_TABS:
            $mainContent.html(renderAllTabLane());
            break;
        case DT_WINDOW:
            $mainContent.html(renderWindowLanes());         // unsafe text are left out.
            fillWindowText(windowIds);                      // fill in the unsafe text of the objects using html-escaped API.
            showHideWindowLanes();
            break;
        case DT_CONTAINER:
            $mainContent.html(renderContainerLanes());      // unsafe text are left out.
            fillContainerText(containerIds);                // fill in the unsafe text of the objects using html-escaped API.
            showHideContainerLanes();
            break;
        case DT_ALL_WINDOWS:
            renderAllWindows();
            break;
        default:
            $mainContent.html("Unknown displayType " + uiState.displayType);
            break;
        }
    }
    
    function refreshContent(forceRefreshImg, zoomOut) {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            refreshAllTabsContent(forceRefreshImg, zoomOut);
            break;
        case DT_WINDOW:
            refreshWindowsContent(forceRefreshImg, zoomOut);
            break;
        case DT_CONTAINER:
            refreshContainersContent(forceRefreshImg, zoomOut);
            break;
        case DT_ALL_WINDOWS:
            refreshAllWindowsContent(forceRefreshImg, zoomOut);
            break;
        }
    }
    
    function renderAllTabLane() {
        return `
            <div class="content-title">all tabs</div>
            <div class="all-tab-lane">
              <div class="tab-grid"></div>
            </div>
        `;
    }

    function refreshAllTabsContent(forceRefreshImg, zoomOut) {
        let tabs = toTabs(effectiveTabIds);
        let html = renderTabGrid(tabs);                                     // unsafe text are left out.
        $(".all-tab-lane .tab-grid").html(html);
        fillTabText(tabs);                                                  // fill in the unsafe text using escaped API.

        effectiveTabIds.forEach( tid => refreshThumbnail(tid, forceRefreshImg) );
        if (zoomOut) {
            zoomOutAnimation(effectiveTabIds);
        }
    }

    // unsafe text are left out.
    function renderWindowLanes() {
        return `
            <div class="content-title">tabs by window</div>
            ${ windowIds.map( wid => windowById[wid] ).map( w => renderWindowLane(w) ).join("\n") }
        `;
    }

    // unsafe text are left out.
    function renderWindowLane(w) {
        return `
              <div class="window-lane d-none" data-wid="${w.id}" style="${border_color_private(w.incognito)} ${box_shadow_private(w.incognito)}">
                <div class="window-topbar" title="Window">
                  <div class="window-title" title="Window">WINDOW-TITLE</div>
                  <div class="dropdown dropdown-right window-topbar-menu" >
                    <div class="btn-group" style="margin:0">
                      <a href="#" class="btn btn-primary dropdown-toggle window-menu-dropdown" tabindex="-1"><i class="icon icon-caret"></i></a>
                      <ul class="menu" style="min-width: 6rem; margin-top: -2px;">
                        <li class="menu-item" title="Reload tabs in window"> <a href="#" class="cmd-reload-w-tabs nowrap">Reload Tabs</a> </li>
                        <li class="menu-item" title="Undo the last close tab"> <a href="#" class="cmd-undo-close nowrap">Undo Close Tab</a> </li>
                        <li class="menu-item" title="Copy titles and Urls of tabs in window"> <a href="#" class="cmd-copy-w-title-url nowrap">Copy Titles & Urls</a> </li>
                        <li class="divider"></li>
                        <li class="menu-item" title="Mute tabs in window"> <a href="#" class="cmd-mute-w-all nowrap">Mute Tabs</a> </li>
                        <li class="menu-item" title="Unmute tabs in window"> <a href="#" class="cmd-unmute-w-all nowrap">Unmute Tabs</a> </li>
                        <li class="menu-item" title="Pin tabs in window"> <a href="#" class="cmd-pin-w-all nowrap">Pin Tabs</a> </li>
                        <li class="menu-item" title="Unpin tabs in window"> <a href="#" class="cmd-unpin-w-all nowrap">Unpin Tabs</a> </li>
                      </ul>
                    </div>
                  </div>
                </div>
                <div class="tab-grid"></div>
              </div>
            `;
    }

    // Use html-escaped API to fill in unsafe text.
    function fillWindowText(windowIds) {
        windowIds.map( wid => windowById[wid] ).forEach( w => $(".window-lane[data-wid='" + w.id + "'] .window-title").text(w.title) );
    }

    function showHideWindowLanes() {
        windowIds.forEach( wid => showHideWindowLane(wid) );
    }

    function showHideWindowLane(wid) {
        let windowTids = effectiveWindowTids(wid);
        let isVisible = !app.boolVal(uiState.windowsHiddenByUser, wid) && (ttSettings.showEmptyWindows || windowTids.length > 0);
        let $window_lane = $(".window-lane[data-wid='" + wid + "']");
        if (isVisible)
            $window_lane.removeClass("d-none");
        else
            $window_lane.removeClass("d-none").addClass("d-none");
    }


    function addWindowLane(win) {
        if (uiState.displayType == DT_WINDOW) {
            let $mainContent = $("#main-content");
            $mainContent.append(renderWindowLane(win));     // render without the unsafe text.
            fillWindowText([win.id]);                       // fill in the unsafe text of the objects using html-escaped API.
            let $window_lane = $(".window-lane[data-wid='" + win.id + "']");
            $window_lane.removeClass("d-none");
            redrawFooterControls();
            refreshFooterControls();
        }
    }

    function removeWindowLane(wid) {
        $(".window-lane[data-wid='" + wid + "']").animate({ height: 0 }, 600, function(){ $(this).remove() });
    }

    function redrawWindowFooterBtns() {
        $(".footer-btns").html(
            `${ windowIds.map( wid => windowById[wid] ).map( w => `
                <button class="btn footer-btn badge" data-wid="${w.id}" data-badge="${CHAR_CHECKMARK}" tabindex="-1"></button>
                ` ).join("\n") }
        `);
    }

    function refreshWindowFooterBtns() {
        windowIds.map( wid => windowById[wid] ).forEach( w => {
            $(".footer-btn[data-wid='" + w.id + "']")
                .attr("title", "Window: " + w.title).text(titleLetter(w.title))
                .removeClass("deselected").addClass(app.boolVal(uiState.windowsHiddenByUser, w.id) ? "deselected" : "");
        });
    }

    function redrawContainerFooterBtns() {
        $(".footer-btns").html(
            `${ containerIds.map( cid => containerById[cid] ).map( c => `
                <button class="btn footer-btn badge" data-cid="${c.cookieStoreId}" data-badge="${CHAR_CHECKMARK}" style="color: ${c.colorCode}" tabindex="-1"></button>
                ` ).join("\n") }
        `);
    }
 
    function refreshContainerFooterBtns() {
        containerIds.map( cid => containerById[cid] ).forEach( c => {
            $(".footer-btn[data-cid='" + c.cookieStoreId + "']")
                .attr("title", "Container: " + c.name).text(titleLetter(c.name))
                .removeClass("deselected").addClass(uiState.containersHiddenByUser[c.cookieStoreId] ? "deselected" : "");
        });
    }

    function titleLetter(title, defaultLetter) {
        return title.length ? title.substring(0, 1) : defaultLetter;
    }


    function refreshWindowsContent(forceRefreshImg, zoomOut) {
        windowIds.forEach( wid => refreshWindowTabs(wid) );

        effectiveTabIds.forEach( tid => refreshThumbnail(tid, forceRefreshImg) );
        if (zoomOut) {
            zoomOutAnimation(effectiveTabIds);
        }
    }

    function updateRefreshOneWindow(wid, forceRefreshImg, zoomOut) {
        refreshWindowTabs(wid);

        effectiveTabIds.forEach( tid => refreshThumbnail(tid, forceRefreshImg) );
        if (zoomOut) {
            zoomOutAnimation(effectiveTabIds);
        }
    }

    function refreshWindowTabs(wid) {
        let windowTabs = effectiveWindowTabs(wid);
        let $window_lane = $(".window-lane[data-wid='" + wid + "']");
        if (windowTabs.length > 0) {
            let html = renderTabGrid(windowTabs);                           // unsafe text are left out.
            $window_lane.find(".tab-grid").html(html);
            fillTabText(windowTabs);                                        // fill in the unsafe text using escaped API.
        }
    }

    // unsafe text are left out.
    function renderContainerLanes() {
        return `
            <div class="content-title">tabs by container</div>
            ${ containerIds.map( cid => containerById[cid] ).map( c => `
                <div class="container-lane d-none" data-cid="${c.cookieStoreId}" style="border: 0.1rem solid ${c.colorCode}; ${box_shadow_private(is_firefox_private(c.cookieStoreId))}">
                  <div class="container-tab-title" title="${is_firefox_default(c.cookieStoreId) ? '' : 'Container'}">
                    <img src="${c.iconUrl}" style="width:12px; height:12px; margin-right: 0.2rem; visibility: ${is_firefox_default(c.cookieStoreId) ? 'hidden' : 'visible'};">
                    <span class="container-name" style="color: ${c.colorCode}">CONTAINER-NAME</span>
                  </div>
                  <div class="tab-grid"></div>
                </div>
            ` ).join("\n") }
        `;
    }

    // Use html-escaped API to fill in unsafe text.
    function fillContainerText(containerIds) {
        containerIds.map( cid => containerById[cid] ).forEach( c => $(".container-lane[data-cid='" + c.cookieStoreId + "'] .container-name").text(c.name) );
    }

    function showHideContainerLanes() {
        containerIds.forEach( cid => showHideContainerLane(cid) );
    }

    function showHideContainerLane(cid) {
        let containerTids = effectiveContainerTids(cid);
        let isVisible = !uiState.containersHiddenByUser[cid] && (ttSettings.showEmptyContainers || containerTids.length > 0);
        let $container_lane = $(".container-lane[data-cid='" + cid + "']");
        if (isVisible)
            $container_lane.removeClass("d-none");
        else
            $container_lane.removeClass("d-none").addClass("d-none");
    }

    function refreshContainersContent(forceRefreshImg, zoomOut) {
        containerIds.forEach( cid => refreshContainerTabs(cid) );

        effectiveTabIds.forEach( tid => refreshThumbnail(tid, forceRefreshImg) );
        if (zoomOut) {
            zoomOutAnimation(effectiveTabIds);
        }
    }

    function refreshContainerTabs(cid) {
        let containerTabs = effectiveContainerTabs(cid);
        let $container_lane = $(".container-lane[data-cid='" + cid + "']");
        if (containerTabs.length > 0) {
            let html = renderTabGrid(containerTabs);                            // unsafe text are left out.
            $container_lane.find(".tab-grid").html(html);
            fillTabText(containerTabs);                                         // fill in the unsafe text using escaped API.
        }
    }


    function renderAllWindows() {
        return "all windows";
    }

    function refreshAllWindowsContent(forceRefreshImg, zoomOut) {
    }


    // Redraw the tab boxes, fill in the tab's text, and refresh their thumbnails.
    function refreshTabBoxes(tids, forceRefreshImg) {
        //resetDragAndDrop();
        let tabs = toTabs(tids);
        tabs.forEach( tab => $tabbox(tab.id).replaceWith(renderTabBox(tab, false)) );   // 1. Generate html, without the unsafe text rendered.
        fillTabText(tabs);                                                              // 2. Fill in the unsafe text.
        tids.forEach( tid => refreshThumbnail(tid, forceRefreshImg) );                  // 3. Render the thumbnail.
        setupDragAndDrop();                                                             // 4. Set up drag and drop.
    }


    function renderTabGrid(tabs) {
        return ` ${ tabs.map( tab => renderTabBox(tab) ).join("\n") } `;
    }

    // Unsafe text of the tab are not rendered.  Caller needs to call fillTabText() later to fill in the unsafe text.
    function renderTabBox(tab) {
        let c = containerById[tab.cookieStoreId];
        let isPrivate = is_firefox_private(tab.cookieStoreId);
        let isContainer = is_real_container(tab.cookieStoreId);

        // Note that the unsafe text of a tab's url are left out, and will be filled in later, in below.
        return `
            <div class="tab-box ${css_tabbox(isPrivate)}" id="tid-${tab.id}" data-tid="${tab.id}" tabindex="2">

              <div class="tab-topbar ${css_draggable()}" title="Drag the top bar to start drag and drop on the thumbnail.">
                <div class="tab-title" title="TAB-TITLE">TAB-TITLE</div>
              </div>

              <div class="tab-topbar-cmds">
                <a href="#" class="btn cmd-close-tab" title="Close the tab" tabindex="-1"><i class="icon icon-cross"></i></a>
              </div>

              <div class="dropdown dropdown-right tab-topbar-menu" >
                <div class="btn-group" style="margin:0">
                  <a href="#" class="btn dropdown-toggle tab-menu-dropdown" tabindex="-1"><i class="icon icon-caret"></i></a>
                  <ul class="menu" style="min-width: 6rem; margin-top: -2px;">
                    <li class="menu-item"> <a href="#" class="cmd-reload-tab nowrap">Reload Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-toggle-muted nowrap">${isMuted(tab) ? "Unmute" : "Mute"} Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-toggle-pinned nowrap">${tab.pinned ? "Unpin" : "Pin"} Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-duplicate-tab nowrap">Duplicate Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-move-tab-new nowrap">To New Window</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-copy-tab-url nowrap">Copy URL</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-save-tab-img nowrap">Save Image</a> </li>
                    <li class="divider   ${is_by_window() ? 'd-block' : 'd-none'}"></li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-others nowrap">Close Other Tabs</a> </li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-left nowrap">Close Left Tabs</a> </li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-right nowrap">Close Right Tabs</a> </li>
                  </ul>
                </div>
              </div>

              <div class="tab-thumbnail" style="border-color: ${c.colorCode}; ${box_shadow_private(tab.incognito)}; ${box_shadow_active(wasTabActive(tab))}; ">
                <img class="tab-img">
              </div>

              <div class="tab-status-bar">
                <a href="#" class="btn status-private   ${css_display(isPrivate)}"    tabindex="-1" title="Tab is in a private window"><img src="icons/eyepatch.png" ></a>
                <a href="#" class="btn status-container ${css_display(isContainer)}"  tabindex="-1" title="CONTAINER-NAME" style="background: ${c.colorCode}"><img src="${c.iconUrl}"></a>
                <a href="#" class="btn status-pin       ${css_display(tab.pinned)}"   tabindex="-1" title="Tab is pinned"><img src="icons/pin.png" ></a>
                <a href="#" class="btn status-mute      ${css_display(isMuted(tab))}" tabindex="-1" title="Tab is muted"><img src="icons/mute.png" ></a>
              </div>
            </div>   
        `;
    }

    // Use html-escaped API to fill in unsafe text of the tabs.
    function fillTabText(tabs) {
        tabs.forEach( tab => $tabbox(tab.id).find(".tab-url").attr("href", tab.url).attr("title", tab.title).text(tab.title) );
        tabs.forEach( tab => $tabbox(tab.id).find(".tab-title").attr("title", tab.title).text(tab.title) );
        tabs.forEach( tab => $tabbox(tab.id).find(".status-container").attr("title", "Container: " + containerById[tab.cookieStoreId].name) );
    }

    function refreshTabStatusBar(tab) {
        let $statusbar = $tabbox(tab.id).find(".tab-status-bar");

        if (is_firefox_private(tab.cookieStoreId)) {
            $statusbar.find(".status-private").removeClass("d-none").addClass("d-block");
        } else {
            $statusbar.find(".status-private").removeClass("d-block").addClass("d-none");
        }

        if (is_real_container(tab.cookieStoreId)) {
            $statusbar.find(".status-container").removeClass("d-none").addClass("d-block");
        } else {
            $statusbar.find(".status-container").removeClass("d-block").addClass("d-none");
        }

        if (tab.pinned) {
            $statusbar.find(".status-pin").removeClass("d-none").addClass("d-block");
        } else {
            $statusbar.find(".status-pin").removeClass("d-block").addClass("d-none");
        }

        if (isMuted(tab)) {
            $statusbar.find(".status-mute").removeClass("d-none").addClass("d-block");
        } else {
            $statusbar.find(".status-mute").removeClass("d-block").addClass("d-none");
        }
    }

    const captureOpts = { format: "jpeg", quality: 50 };

    function refreshThumbnail(tid, forceRefreshImg) {
        if (thumbnailsCapturing[tid])
            return;

        if (thumbnailsMap[tid] && !forceRefreshImg) {
            renderThumbnail(tid, thumbnailsMap[tid]);
        } else {
            thumbnailsCapturing[tid] = true;
            browser.tabs.captureTab(tid, captureOpts)
                .then( thumbnail => {
                    thumbnailsMap[tid] = thumbnail;
                    thumbnailsCapturing[tid] = false;
                    renderThumbnail(tid, thumbnailsMap[tid]);
                })
                .catch( e => {
                    thumbnailsCapturing[tid] = false;
                });
        }
    }

    function $tabimg(tid) {
        return $tabbox(tid).find("img.tab-img");
    }

    function renderThumbnail(tid, thumbnail) {
        $tabimg(tid).attr("src", thumbnail);
    }

 
    function stopEvent(e)                       { e.preventDefault(); return false }
    function box_shadow_private(isPrivate)      { return isPrivate ? "box-shadow: 0 0 .4rem -.02rem rgba(0, 0, 0, 0.75);" : "" }
    function box_shadow_active(isActive)        { return isActive  ? "box-shadow: 0 0 .4rem -.02rem rgba(239, 196, 40, 1.00);" : "" }
    function border_color_private(isPrivate)    { return isPrivate ? "border-color: " + COLOR_PRIVATE + ";" : "" }
    function css_display(showing)               { return showing  ? "d-block" : "d-none" }
    function css_draggable()                    { return uiState.displayType == DT_WINDOW || uiState.displayType == DT_CONTAINER ? "draggable-item" : "" }
    function css_tabbox(isPrivate)              { return isPrivate ? " droppable-private " : " droppable-normal " }

    function canDropBeforeTab(draggingFromTid, droppingToTid) {
        if (draggingFromTid) {
            let isDraggablePrivate = is_firefox_private(tabById[draggingFromTid].cookieStoreId);
            let isDroppablePrivate = is_firefox_private(tabById[droppingToTid].cookieStoreId);
            return isDraggablePrivate == isDroppablePrivate;
        }
        return false;
    }

    function isDroppableToWin(draggingFromTid, droppingToWid) {
        if (draggingFromTid) {
            let isDraggablePrivate = is_firefox_private(tabById[draggingFromTid].cookieStoreId);
            let isDroppablePrivate = windowById[droppingToWid].incognito;
            return isDraggablePrivate == isDroppablePrivate;
        }
        return false;
    }

    function resetDragAndDrop() {
        $(".draggabled-item").draggable("destroy").removeClass("draggabled-item");
    }

    function setupDragAndDrop() {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            break;
        case DT_WINDOW:
            setupDragAndDropForDT_Window();
            break;
        case DT_CONTAINER:
            setupDragAndDropForDT_Container();
            break;
        case DT_ALL_WINDOWS:
            break;
        }
    }

    function setupDragAndDropForDT_Window() {
        effectiveTabIds.forEach( tid => {
            let $tb = $tabbox(tid);
            if ($tb.hasClass("draggabled-item"))
                return;

            $tb.draggable({
                revert:         "invalid",
                revertDuration: 200,
                zIndex:         100,
                handle:         ".draggable-item",
                containment:    "#main-content",
                create:         function(event, ui){ $(this).addClass("draggabled-item") },
                start:          function(event, ui){
                    enableOverlay = false;
                    addDropTabGapZonesForWindows(tid, effectiveTabIds);
                    addDropEndZonesForWindows(tid);
                    setTabBoxDroppableForWindows(tid, effectiveTabIds);
                },
                stop:           function(event, ui){
                    $(".drop-tab-gap-zone, .drop-end-zone").droppable("destroy").remove();
                    $(".tab-box.droppabled-item").droppable("destroy").removeClass("droppabled-item");
                    enableOverlayAfterDelay(4000);
                },
            });
        });
    }
    
    function setupDragAndDropForDT_Container() {
        effectiveTabIds.forEach( tid => {
            let $tb = $tabbox(tid);
            if ($tb.hasClass("draggabled-item"))
                return;

            $tb.draggable({
                revert:         true,
                revertDuration: 200,
                zIndex:         100,
                handle:         ".draggable-item",
                containment:    "#main-content",
                helper:         "clone",
                create:         function(event, ui){ $(this).addClass("draggabled-item") },
                start:          function(event, ui){
                    enableOverlay = false;
                    addDropEndZonesForContainer(tid);
                    $(".drop-end-zone").droppable({
                        accept:     ".tab-box",
                        classes:    { "ui-droppable-hover": "onhover-copy-ondrop" },
                        create:     function(event, ui){ $(this).addClass("droppabled-item") },
                        drop:       function(event, ui){ dropInTheContainer($(this), event, ui) },
                    });
                },
                stop:           function(event, ui){
                    $(".drop-end-zone").droppable("destroy").remove();
                    enableOverlayAfterDelay(4000);
                },
            });
        });
    }

    function addDropTabGapZonesForWindows(draggingTid, droppableTids) {
        let isDraggingPrivate = is_firefox_private(tabById[draggingTid].cookieStoreId);
        let tabBoxMargin = remToPixels(0.5);        // see .tab-box style with --tab-gap.

        droppableTids.filter(tid => tid != draggingTid).forEach( tid => {
            let destPrivate = is_firefox_private(tabById[tid].cookieStoreId);
            let sameDomain  = isDraggingPrivate == destPrivate;     // prevent dragging to move across private and normal windows.
            let $thumbnail  = $tabbox(tid).find(".tab-thumbnail");
            let $tabGapZone = $("<div class='drop-tab-gap-zone' data-tid='" + tid + "'></div>");
            $tabGapZone.offset({
                top:    $thumbnail.offset().top,
                left:   $thumbnail.offset().left - tabBoxMargin*2 + 1 })
                .width( tabBoxMargin*2 - 2 )
                .height( $thumbnail.outerHeight() );
            $(".drop-tab-gap-zone[data-tid='" + tid  + "']").remove();
            $(document.body).append($tabGapZone);

            $(".drop-tab-gap-zone[data-tid='" + tid  + "']").droppable({
                accept:     ".tab-box",
                classes:    { "ui-droppable-hover": sameDomain ? "onhover-move-in-gap-ondrop" : "onhover-copy-in-gap-ondrop" },
                create:     function(event, ui){ $(this).addClass("droppabled-item") },
                drop:       function(event, ui){ dropInFrontOfTabInWindow($(this), event, ui) },
            });
            
        });
    }

    function setTabBoxDroppableForWindows(draggingTid, droppableTids) {
        let isDraggingPrivate = is_firefox_private(tabById[draggingTid].cookieStoreId);

        droppableTids.filter(tid => tid != draggingTid).forEach( tid => {
            let destPrivate = is_firefox_private(tabById[tid].cookieStoreId);
            let sameDomain  = isDraggingPrivate == destPrivate;     // prevent dragging to move across private and normal windows.
            $tabbox(tid).droppable({
                accept:     ".tab-box",
                classes:    { "ui-droppable-hover": sameDomain ? "onhover-move-in-border-ondrop" : "onhover-copy-in-border-ondrop" },
                create:     function(event, ui){ $(this).addClass("droppabled-item") },
                drop:       function(event, ui){ dropInFrontOfTabInWindow($(this), event, ui) },
            });
        });
    }

    function addDropEndZonesForWindows(draggingTid) {
        let isDraggingPrivate = is_firefox_private(tabById[draggingTid].cookieStoreId);

        windowIds.map( wid => windowById[wid] ).forEach( w => {
            let destPrivate = w.incognito;
            let sameDomain  = isDraggingPrivate == destPrivate;     // prevent dragging to move across private and normal windows.
            let $winLane    = $(".window-lane[data-wid='" + w.id + "']");
            let $endzone    = $("<div class='drop-end-zone' data-wid='" + w.id + "'></div>");
            let $lastTab    = $winLane.find(".tab-thumbnail").last();
            if ($lastTab.length) {
                let endzoneLeft = $lastTab.offset().left + $lastTab.outerWidth() + 2;
                $endzone.offset({
                    top:    $lastTab.offset().top,
                    left:   endzoneLeft })
                    .width($winLane.offset().left + $winLane.width() - endzoneLeft - 2)
                    .height($lastTab.outerHeight());
            } else {
                let $tab_grid = $winLane.find(".tab-grid");
                $endzone.offset({
                    top:    $tab_grid.offset().top,
                    left:   $tab_grid.offset().left + 4 })
                    .width($winLane.offset().left + $winLane.width() - ($tab_grid.offset().left + 4) - 2)
                    .height($tab_grid.outerHeight() - 12);
            }
            $(".drop-end-zone[data-wid='" + w.id  + "']").remove();
            $(document.body).append($endzone);

            $(".drop-end-zone[data-wid='" + w.id  + "']").droppable({
                accept:     ".tab-box",
                classes:    { "ui-droppable-hover": sameDomain ? "onhover-move-to-end-ondrop" : "onhover-copy-ondrop" },
                create:     function(event, ui){ $(this).addClass("droppabled-item") },
                drop:       function(event, ui){ dropAtTheEndInWindow($(this), event, ui) },
            });
            
        });
    }

    function addDropEndZonesForContainer(draggingTid) {
        let draggingTab = tabById[draggingTid];
        containerIds.map( cid => containerById[cid] ).forEach( c => {
            if (draggingTab.cookieStoreId == c.cookieStoreId)
                return;     // skip dropping to self's container.
            $(".drop-end-zone[data-cid='" + c.cookieStoreId  + "']").remove();
            let $container  = $(".container-lane[data-cid='" + c.cookieStoreId + "']");
            let $endzone    = $("<div class='drop-end-zone' data-cid='" + c.cookieStoreId + "'></div>");
            let $lastTab    = $container.find(".tab-thumbnail").last();
            if ($lastTab.length) {
                let endzoneLeft = $lastTab.offset().left + $lastTab.outerWidth() + 2;
                $endzone.offset({ top: $lastTab.offset().top,  left: endzoneLeft })
                    .width($container.offset().left + $container.width() - endzoneLeft - 1)
                    .height($lastTab.outerHeight());
            } else {
                let $tab_grid = $container.find(".tab-grid");
                $endzone.offset({ top: $tab_grid.offset().top,  left: $tab_grid.offset().left + 4 })
                    .width($container.offset().left + $container.width() - ($tab_grid.offset().left + 4) - 2)
                    .height($tab_grid.outerHeight() - 12);
            }
            $(document.body).append($endzone);
        });
    }

    function dropInFrontOfTabInWindow($dest, event, ui) {
        let srcTab      = tabById[ui.draggable.data("tid")];
        let destTab     = tabById[$dest.data("tid")];
        let srcIdx      = tabIdsByWid[srcTab.windowId].findIndex( tid => tid == srcTab.id );
        let destIdx     = tabIdsByWid[destTab.windowId].findIndex( tid => tid == destTab.id );
        let srcPrivate  = is_firefox_private(tabById[srcTab.id].cookieStoreId);
        let destPrivate = is_firefox_private(tabById[destTab.id].cookieStoreId);
        let sameDomain  = srcPrivate == destPrivate;
        if (sameDomain) {
            // Move the tab in front of the destination tab.
            let sameWin     = srcTab.windowId == destTab.windowId;
            if (sameWin && srcIdx < destIdx) {
                destIdx--;      // Src and dest tabs on the same window, and src tab is before dest, decrement index by 1 since the src tab will be removed.
            }
            browser.tabs.move(srcTab.id, { windowId: destTab.windowId, index: destIdx}).then( movedTabs => {
                if (movedTabs && movedTabs.length > 0 && (!sameWin || srcIdx != movedTabs[0].index)) {
                    tabIdsByWid[srcTab.windowId].splice(srcIdx, 1);                 // remove the moved tabId from source array
                    tabIdsByWid[destTab.windowId].splice(destIdx, 0, srcTab.id);    // add the moved tabId to the destination array
                    orderTabIndex(srcTab.windowId);
                    if (destTab.windowId != srcTab.windowId)
                        orderTabIndex(destTab.windowId);
                    srcTab.windowId = destTab.windowId;

                    let $srcTabBox  = $tabbox(srcTab.id);
                    let $destTabBox = $tabbox(destTab.id);
                    $srcTabBox.detach();
                    $srcTabBox.css({"top":"", "left":""});      // reset dragging position.
                    $srcTabBox.insertBefore($destTabBox);
                    let toWidth = $srcTabBox.width();
                    $srcTabBox.width(0).animate({ width: toWidth }, 500).effect( "bounce", {times:2, distance:5}, 200 );
                } else {
                    let $srcTabBox  = $tabbox(srcTab.id);
                    $srcTabBox.removeAttr("style");
                }
            });
        } else {
            // Copy the tab in front of the destination tab.
            openInWindow(srcTab, destTab.windowId, destIdx);
            let $srcTabBox  = $tabbox(srcTab.id);
            $srcTabBox.removeAttr("style");
        }
    }                                   

    function dropAtTheEndInWindow($dest, event, ui) {
        let srcTab      = tabById[ui.draggable.data("tid")];
        let destWid     = $dest.data("wid");  // data-wid on .drop-end-zone.
        let sameWin     = srcTab.windowId == destWid;
        let srcPrivate  = is_firefox_private(tabById[srcTab.id].cookieStoreId);
        let destPrivate = windowById[destWid].incognito;
        let sameDomain  = srcPrivate == destPrivate;
        if (sameDomain) {
            // Move the tab to the end of th window
            browser.tabs.move(srcTab.id, { windowId: destWid, index: -1}).then( movedTabs => {
                if (movedTabs && movedTabs.length > 0 && (!sameWin || srcTab.index != movedTabs[0].index)) {
                    // Move the tab to the end of the window lane.
                    let srcIdx = tabIdsByWid[srcTab.windowId].findIndex( tid => tid == srcTab.id );
                    tabIdsByWid[srcTab.windowId].splice(srcIdx, 1);
                    tabIdsByWid[destWid].push(srcTab.id);
                    orderTabIndex(srcTab.windowId);
                    if (destWid != srcTab.windowId)
                        orderTabIndex(destWid);
                    
                    srcTab.windowId = destWid;
                    let $tabBox = $tabbox(srcTab.id);
                    $tabBox.css({ top:"", left:"" });   // reset the dragging position
                    if (!$tabBox.is(":last-child")) {
                        $tabBox.detach();
                        $(".window-lane[data-wid='" + destWid + "'] .tab-grid").append($tabBox);
                        $tabBox.offset({left: event.pageX}).animate({ left: 0 }, 300)
                            .effect( "bounce", {times:2, distance:5}, 200 );
                    } else {
                        $tabBox.detach();
                        $(".window-lane[data-wid='" + destWid + "'] .tab-grid").append($tabBox);
                        $tabBox.offset({left: event.pageX}).animate({ left: 0 }, 300)
                            .effect( "bounce", {times:2, distance:5}, 200 );
                    }
                } else {
                    let $srcTabBox  = $tabbox(srcTab.id);
                    $srcTabBox.removeAttr("style");
                }
            });
        } else {
            // Copy the tab to the end of th window
            openInWindow(srcTab, destWid, null);
            let $srcTabBox  = $tabbox(srcTab.id);
            $srcTabBox.removeAttr("style");
        }
    }

    // Need to do blocking wait until tabs.create() finish before finishing up the drop operation.
    function dropInTheContainer($dest, event, ui) {
        let srcTab  = tabById[ui.draggable.data("tid")];
        let destCid = $dest.data("cid");  // data-cid on .drop-end-zone.

        if (is_firefox_private(srcTab.cookieStoreId)) {
            if (is_firefox_private(destCid)) {
                openInPrivateWindow(srcTab, null);      // the drop target is a container; the target window is unknown.
            } else {
                openInContainer(srcTab, null, destCid); // src is private and dest is not private; the target window is unknown.
            }
        } else {
            if (is_firefox_private(destCid)) {
                openInPrivateWindow(srcTab, null);      // the drop target is a container; the target window is unknown.
            } else {
                openInContainer(srcTab, srcTab.windowId, destCid);
            }
        }
    }

    async function openInPrivateWindow(srcTab, destWid) {
        if (!destWid) {
            let privateWindow = await pFindOrCreatePrivateWindow();     // pick the first private window or create one.
            destWid = privateWindow.id;
        }
        browser.tabs.create({
            active:         true,
            windowId:       destWid,
            pinned:         srcTab.pinned,
            url:            srcTab.url,
        });
        // Rely on tabs.onUpdated to add the newly created tab when the tab.url and tab.title are completely filled in.
    }

    async function openInWindow(srcTab, destWid, destIndex) {
        browser.tabs.create({
            active:         true,
            windowId:       destWid,
            index:          destIndex,
            pinned:         srcTab.pinned,
            url:            srcTab.url,
        }).then( newTab => {
            createTabData(newTab);
            refreshTabData(newTab);
            let $newTabBox = $tabbox(newTab.id);
            let toWidth = $newTabBox.width();
            $tabbox(newTab.id).width(0).animate({ width: toWidth }, 500).effect( "bounce", {times:2, distance:5}, 200 );
        }).then(() => browser.tabs.update(currentTid, { active: true }).then( () => browser.windows.update(currentWid, {focused: true}) ));
        // Rely on tabs.onUpdated to add the newly created tab when the tab.url and tab.title are completely filled in.
    }

    async function openInContainer(srcTab, destWid, destCid) {
        if (!destWid) {
            let containerWindow = await pFindOrCreateContainerWindow(destCid); // pick the first window with the container or create one.
            destWid = containerWindow.id;
        }
        browser.tabs.create({
            active:         true,
            windowId:       destWid,
            cookieStoreId:  destCid,
            pinned:         srcTab.pinned,
            url:            srcTab.url,
        }).then(() => browser.tabs.update(currentTid, { active: true }).then( () => browser.windows.update(currentWid, {focused: true}) ));
        // Rely on tabs.onUpdated to add the newly created tab when the tab.url and tab.title are completely filled in.
    }

    function pFindOrCreatePrivateWindow() {
        return browser.windows.getAll()
            .then( windows => windows.find( w => w.incognito ) )
            .then( privateWindow => privateWindow ? privateWindow : browser.windows.create({ incognito: true }) );
    }

    function pFindOrCreateContainerWindow(cid) {
        return browser.tabs.query({})
            .then( tabs => {
                let tabInTheContainer = tabs.find( tab => tab.cookieStoreId == cid );
                if (tabInTheContainer) {
                    return tabInTheContainer.windowId;
                } else {
                    return browser.windows.create({}).then( w => w.id )
                }
            });
    }
        
    // Command handlers
    function showAboutDlg() {
        let manifest = browser.runtime.getManifest();
        dlg.openDlg("#about-dlg",
                    {
                        ".app-name":    manifest.name,
                        ".app-version": manifest.version,
                        ".app-author":  manifest.author,
                    },
                    {},
                    ".modal-submit");
    }

    function selectDisplayType(displayType) {
        uiState.displayType = displayType;
        refreshVBtnBarControls();
        redrawRefreshUIContent(false, false);
        saveUiStateNow();
        initialFocus();
    }

    // size: 0-2
    function setThumbnailSize(size) {
        uiState.thumbnailSize = size;
        resizeThumbnails();
        saveUiStateNow();
        initialFocus()
    }

    function resizeThumbnails() {
        setImgDimension(imgWidth[uiState.thumbnailSize], imgHeight[uiState.thumbnailSize]);
        refreshVBtnBarControls();
        redrawRefreshUIContent(false, false);
    }

    function duplicateTab(tid) {
        browser.tabs.duplicate(tid)
            .then( newTab => {
                activateTab(newTab);
            }).catch( e => log.warn(e) );
    }

    function reloadTab(tid) {
        browser.tabs.reload(tid);
    }

    function reloadWindowTabs(wid) {
        let tabs = effectiveWindowTabs(wid);
        tabs.forEach( tab => browser.tabs.reload(tab.id) );
    }

    function copyWindowTabTitleUrls(wid) {
        let tabs = effectiveWindowTabs(wid)
        let titleUrls = tabs.map( tab => [tab.title, tab.url, ""] );
        let text = [].concat.apply([], titleUrls).join("\n");
        $("#copy-to-clipboard").val(text).select();             // note that .val() can sandbox unsafe text from tab.url and tab.title
        document.execCommand("copy");
    }

    function muteTabs(wid, isMuting) {
        let tabs = wid ? effectiveWindowTabs(wid) : toTabs(effectiveTabIds);    // tabs of a window or all tabs.
        Promise.all( tabs.map( tab => browser.tabs.update(tab.id, { muted: isMuting }) ) )
            .then( updatedTabs => updatedTabs.forEach( tab => tabById[tab.id].mutedInfo = tab.mutedInfo ) )
            .then( () => refreshTabBoxes(toTabIds(tabs), false) )
    }
                     
    function pinWindowTabs(wid, isPinning) {
        let tabs = effectiveWindowTabs(wid);
        Promise.all( tabs.map( tab => browser.tabs.update(tab.id, { pinned: isPinning }) ) )
            .then( updatedTabs => updatedTabs.map( tab => tabById[tab.id].pinned = tab.pinned ) )
            .then( () => refreshTabBoxes(toTabIds(tabs), false) )
    }

    function moveToNewWindow(tid) {
        browser.windows.create({
            tabId:  tid
        });
    }

    function copyTabUrl(tid) {
        let tab = tabById[tid];
        $("#copy-to-clipboard").val(tab.url).select();  // note that .val() can sandbox unsafe text from tab.url to avoid XSS attack.
        document.execCommand("copy");
    }

    function saveTabImg(tid) {
        let tab = tabById[tid];
        let thumbnail = thumbnailsMap[tid];
        let filename = tab.title.replace(/[\\/:"*?<>|]/g, "").slice(0, 50).trim();  // illegal chars \/:*?"<>| in filename.
		let a = document.createElement("a");
		a.style = "display: none";
		a.href = thumbnail;
        a.download = filename ? filename + ".jpg" : "image-capture.jpg";            // unsafe text is ok when set to attribute.
		document.body.appendChild(a);
		a.click();
		setTimeout(function(){ a.ownerDocument.body.removeChild(a) }, 200);
    }

    function removeTabBoxes(tids) {
        resetDragAndDrop();
        tids.forEach( tid => {
            deleteTabData(tid);
            $tabbox(tid).animate({ width: 0 }, 500, function(){ $(this).remove() });
            //$tabbox(tid).css({ visibility: "hidden" }).animate({ width: 0 }, 500, function(){ $(this).remove() });
        });
        updateEffectiveTabIds();
        setupDragAndDrop();
    }
 
    function closeTab(tid) {
        removeTabBoxes([tid]);
        browser.tabs.remove(tid);
    }

    function closeOtherTabs(tid, whichSide) {
        let tab = tabById[tid];
        browser.windows.get(tab.windowId, {
            populate:   true
        }).then( win => {
            let index = win.tabs.findIndex(tab => tab.id == tid);
            let tabs = whichSide == "all" ? win.tabs : whichSide == "left" ? win.tabs.slice(0, index) : win.tabs.slice(index + 1);
            let tabIdsToClose = tabs.filter( tab => tab.id != tid && !is_tiptaburl(tab.url) ).map( tab => tab.id );
            removeTabBoxes(tabIdsToClose);
            browser.tabs.remove(tabIdsToClose);
        });
    }

    function undoCloseTab() {
        browser.sessions.getRecentlyClosed().then( sessions => {
            let sessionInfo = sessions[0];
            if (sessionInfo.tab) {
                browser.sessions.restore(sessionInfo.tab.sessionId);
            } else {
                browser.sessions.restore(sessionInfo.window.sessionId);
            }
        })
    }

    function toggleTabProperty(tid, property) {
        browser.tabs.get(tid).then( tab => {
            let updateProp = {};
            updateProp[property] = !tab[property];
            browser.tabs.update(tab.id, updateProp).then( tab => {
                tabById[tid][property] = tab[property];
                refreshTabBoxes([ tid ], false);
            });
        });
    }

    function toggleTabPinned(tid) {
        browser.tabs.get(tid).then( tab => {
            browser.tabs.update(tab.id, { pinned: !tab.pinned }).then( tab => {
                tabById[tid].pinned = tab.pinned;
                refreshTabBoxes([ tid ], false);
            });
        });
    }

    function toggleTabMuted(tid) {
        browser.tabs.get(tid).then( tab => {
            browser.tabs.update(tab.id, {
                muted: !isMuted(tab)
            }).then( tab => {
                tabById[tid].mutedInfo = tab.mutedInfo;
                refreshTabBoxes([ tid ], false);
            });
        });
    }

    function toggleFooterBtn(wid, cid) {
        if (wid) {
            uiState.windowsHiddenByUser[wid] = !app.boolVal(uiState.windowsHiddenByUser, wid);
            refreshFooterControls();
        }
        if (cid) {
            uiState.containersHiddenByUser[cid] = !uiState.containersHiddenByUser[cid];
            refreshFooterControls();
        }
        dSaveUiState();
        redrawRefreshContentOnFiltering();
    }

    function initialFocus() {
        // Put the focus in the search field so that the custom hotkey can work.
        return $(".cmd-search").focus();
    }

    function pSendCmd(msg) {
        return browser.runtime.sendMessage(msg);    // response is returned in .then( response => ... ).
    }

    function $tabbox(tid) { return $("#tid-" + tid) }   // using lookup by id is faster.

    function getFontSizeRem() {
        return parseFloat(getComputedStyle(document.documentElement).fontSize);
    }

    function remToPixels(rem) {
        return rem * pixels_per_rem;
    }
    
    function dim($elem) {
        let offset = $elem.offset();
        return { left: offset.left, top: offset.top, width: $elem.width(), height: $elem.height() };
    }

    function setDim($elem, left, top, width, height) {
        $elem.offset({ left: left, top: top }).width(width).height(height);
    }

    function setCssVar(cssVar, value) {
        $("html").css(cssVar, value);
    }

    function setImgDimension(width, height) {
        setCssVar("--img-width", width);
        setCssVar("--img-height", height);
    }

    function activateTid(tid) {
        let tab = tabById[tid];
        tiptabWindowActive = false;
        closeOverlay();
        activateTab(tab);
    }

    function activateTab(tab) {
        browser.tabs.update(tab.id, { active: true }).then( () => browser.windows.update(tab.windowId, {focused: true}) );
    }

    function activateWindow(wid) {
        tiptabWindowActive = false;
        closeOverlay();
        browser.windows.update(wid, {focused: true});
    }

    function onTabBoxEnterKey(event) {
        if (event.which == 13) {
            activateTid($(this).data("tid"));
            return stopEvent(event);
        }
        return false;
    }

    function searchTabs(searchText) {
        searchText = searchText.trim();
        let isEmpty = searchText.length == 0;
        uiState.searchTerms = searchText.split(" ");
        if (isEmpty) {
            saveUiStateNow();   // cleared search text needs to be saved now to have a better user experience.
        } else {
            dSaveUiState();
        }
        redrawRefreshContentOnFiltering();
    }

    function closeOverlay() {
        thumbnailFocusTid = null;
        overlayShownTid = null;
        $("#overlay-content").addClass("hidden");
        $(".overlay-img").attr("src", "#");
    }

    function enableOverlayAfterDelay(delayMS) {
        clearTimeout(enableOverlayDelayTimer);
        enableOverlayDelayTimer = setTimeout(function(){
            enableOverlay = true;
        }, delayMS);
    }

    function isMuted(tab) {
        return tab ? (tab.mutedInfo ? tab.mutedInfo.muted : false) : false;
    }

    function refreshBrowserActionTooltip() {
        let manifest = browser.runtime.getManifest();
        let hotkey   = ttSettings.appHotKey || "Ctrl-Shift-F";
        let tooltip  = manifest.name + " (hot key " + hotkey + ")";
        browser.browserAction.setTitle({ title: tooltip });
    }

    log.info("module loaded");
    return module;

}(this, "tiptab_ui"));    // Pass in the global scope as 'this' scope.



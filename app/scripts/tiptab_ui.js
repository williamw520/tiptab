/*
  Tip Tab
  A Firefox extension to manage and navigate the browser tabs.
  Copyright (C) 2018-2023  William Wong (williamw520@gmail.com)

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

// Non-ES6 global includes:
// <script src="/pkg/jquery/jquery.min.js"></script>
// <script src="/pkg/jquery-ui/jquery-ui.min.js"></script>
// <script src="/pkg/spark-md5/spark-md5.min.js"></script>

// ES6 imports
import logger from "/scripts/util/logger.js";
import appcfg from "/scripts/util/appcfg.js";
import app from "/scripts/util/app.js";
import db from "/scripts/util/db.js";
import ringbuf from "/scripts/util/ringbuf.js";
import wwhotkey from "/scripts/util/wwhotkey.js";
import ui from "/scripts/util/ui.js";
import settings from "/scripts/settings.js";
import uistate from "/scripts/uistate.js";
import dlg from "/scripts/util/dlg.js";


let the_module = (function() {
    "use strict";

    const module = { NAME: "tiptab_ui" };
    const log = new logger.Logger(appcfg.APPNAME, module.NAME, appcfg.LOGLEVEL);

    let TipTabSettings = settings.TipTabSettings;

    const tiptabUrl = browser.runtime.getURL("tiptab.html");
    function is_tiptaburl(url) { return url.startsWith(tiptabUrl) };    // sometimes # is added to the end of the url; just check prefix.

    // Display types
    const DT_ALL_TABS = "all-tabs";
    const DT_WINDOW = "by-window";
    const DT_CONTAINER = "by-container";
    function is_all_tabs()      { return uiState.displayType == DT_ALL_TABS }
    function is_by_window()     { return uiState.displayType == DT_WINDOW }
    function is_by_container()  { return uiState.displayType == DT_CONTAINER }

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

    const ICON_MUTED    = ["icons/mute-all.png", "icons/mute-muted.png",  "icons/mute-unmuted.png"];
    const ICON_PINNED   = ["icons/pin-all.png",  "icons/pin-pinned.png",  "icons/pin-unpinned.png"];
    const ICON_HIDDEN   = ["icons/hide-all.png", "icons/hide-hidden.png", "icons/hide-shown.png"];
    const ICON_AUDIBLE  = ["icons/audio-all.png", "icons/audio-audible.png", "icons/audio-inaudible.png"];

    // Module variables.
    let tiptabWindowActive = true;  // setupDOMListeners() is called too late after the window has been in focus.  Assume window is active on startup.
    let ttSettings = TipTabSettings.ofLatest();
    let activateDefaultSeq;
    let activateSettingSeq;
    let searchDefaultSeq;
    let searchSettingSeq;
    let currentSeq = wwhotkey.KeySeq.ofKeySeq();
    let savedSearchSeqs = [];
    let pixels_per_rem = 16;
    let tiptapWid;                  // the current TipTab's window id
    let tiptapTid;                  // the current TipTab's tab id
    let currentLastActiveTabId = 0; // the previous active tab on the current window.
    let previousFocusedTid = 0;
    let searchSavingMode = false;
    let oldSavedSearch = null;
    let dragSelectionMode = false;

    let uiState;
    let tabById = {};               // the only map holding the Tab objects.
    let windowById = {};            // the only map holding the Window objects.  note that the tabs member is not loaded; use tabIdsByWid instead.
    let windowIds = [];             // track the order of the windows, id only.
    let tabIdsByWid = {};           // track the list of tab ids by window id.
    let containerById = {};         // the only map holding the Container objects
    let containerIds = [];          // track the order of the containers, id only.
    let tabIdsByCid = {};           // track the list of tab ids by container id.
    let cachedFavIconMap = {};      // cached favicons mapped by Tab url.

    let effectiveTabIds = [];       // list of tab ids after filtering.
    let effectiveTidSet = new Set();
    let thumbnailsMap = {};         // keyed by tab id
    let thumbnailsCapturing = {};   // keyed by tab id

    // Effective dimensions for thumbnail; will set CSS variable --img-width and --img-height with these dimensions.
    let imgWidth  = ["8.0rem", "12rem", "17.77rem"];
    let imgHeight = ["4.5rem", "6.75rem",  "10rem"];

    let thumbnailFocusTid = null;   // related to thumbnail popup on mouse move.
    let enableOverlay = true;
    let overlayShownTid = null;
    let mouseStopped = true;
    let mouseMovedTimer;
    let popupDelayTimer;
    let enableOverlayDelayTimer;

    // Firefox's Content Security Policy for WebExtensions prohibits running any Javascript in the html page.
    // Wait for the page loaded event before doing anything.
    window.addEventListener("load", function(event){
        // Page is loaded and ready for the script to run.
        Promise.resolve()
            //.then(() => log.info("Page initialization starts") )
            .then(() => preInit() )
            .then(() => browser.runtime.getPlatformInfo().then( info => wwhotkey.setOS(info.os) ) )
            .then(() => settings.pLoad().then(tts => ttSettings = tts) )
            .then(() => thumbnailDimFromSetting(ttSettings) )
            .then(() => pixels_per_rem = getFontSizeRem() )
            .then(() => db.pOpenDB() )
            .then(() => pGetCurrnetTab() )
            .then(() => pGetCurrentLastActiveTab() )
            .then(() => uistate.pLoadUiState().then( state => uiState = state ) )
            .then(() => applyTheme() )
            .then(() => refreshStaticUI() )     // for the UI that need to be set up before setting up the DOM listeners.
            .then(() => setupDOMListeners() )
            .then(() => setupKeyboardListeners() )
            .then(() => browser.storage.onChanged.addListener(storage_onChanged) )
            .then(() => browser.windows.onCreated.addListener(windows_onCreated) )
            .then(() => browser.windows.onRemoved.addListener(windows_onRemoved) )
            .then(() => browser.windows.onFocusChanged.addListener(windows_onFocusChanged) )
            .then(() => browser.tabs.onActivated.addListener(tabs_onActivated) )
            .then(() => browser.tabs.onCreated.addListener(tabs_onCreated) )
            .then(() => browser.tabs.onRemoved.addListener(tabs_onRemoved) )
            .then(() => browser.tabs.onUpdated.addListener(tabs_onUpdated) )
            .then(() => browser.tabs.onMoved.addListener(tabs_onMoved) )
            .then(() => setupMessageHandlers() )
            .then(() => pHandleFirstAppCmd() )
            .then(() => pReloadRedrawRefreshContent() )
            .then(() => redrawRefreshControls() )
            .then(() => setupGCTask() )
            //.then(() => refreshBrowserActionTooltip() )
            //.then(() => log.info("Page initialization done") )
            .then(() => postInit() )
            .catch( e => log.warn(e) );
    });

    function preInit() {
//        db.pDeleteDB(true);
    }

    function postInit() {
        // Use this to debug focusable elements with tabindex.
        // $(":focusable").each(function(){
        //     let itemInfo = $(this).prop("tagName") + ", id: " + $(this).attr("id") + ", class: " + $(this).attr("class") + ", tabindex: " + $(this).attr("tabindex");
        //     log.info(itemInfo);
        // });

        //db.pQueryTabImagesByRange().then( records => log.info( records.map( r => app.pick(r, "key", "updated") ) ) );
        //db.pQueryTabImagesByRange(null, null, ["updated"]).then( records => log.info( records ) );
        //db.pQueryTabImagesByRange(null, app.offsetByDays(new Date(), -1)).then( records => log.info( records.map( r => app.pick(r, "key", "updated") ) ) );
        //db.pQueryTabImagesByRange(null, app.offsetByDays(new Date(), -1), ["key", "updated"]).then( records => log.info( records ) );
        //db.pDeleteTabImagesByRange(null, app.offsetByDays(new Date(), -1)).then( count => log.info( count ) );
        
        // log.info(ui.getCssVars("", "*"));
        // log.info(ui.getCssVars("--thm-"));
        // log.info("ui.isSystemDarkMode: " + ui.isSystemDarkMode());
        // log.info("ui.isSystemLightMode: " + ui.isSystemLightMode());
        // log.info("ui.isSystemNoPreference: " + ui.isSystemNoPreference());

    }

    function pGetCurrnetTab() {
        return browser.tabs.getCurrent().then( tab => {
            tiptapWid = tab.windowId;
            tiptapTid = tab.id;
        });
    }

    function pGetCurrentLastActiveTab() {
        return pSendCmd({ cmd: "last-active-tab", wid: tiptapWid, tiptapTid: tiptapTid }).then( res => currentLastActiveTabId = res.lastActiveTabId );
    }

    function pHandleFirstAppCmd() {
        // log.info("pHandleFirstAppCmd");
        return pSendCmd({ cmd: "last-app-command" }).then( res => {
            if (res.appCommand) {
                handleAppCommand(res.appCommand, true, true);
            } else {
                // Usually when the user refresh the TipTap page.
                // TODO: save last focus across TipTap invocation sessions.
                restoreFocus(true);
            }
        });
    }

    function handleAppCommand(appCommand, ttWinHasFocus, ttTabIsActive) {
        // log.info("handleAppCommand " + appCommand);
        pEnsureTipTabPageInFront(ttWinHasFocus, ttTabIsActive).then(() => {
            if (appCommand == "launch") {
                restoreFocus(true);
            } else if (appCommand == "activate") {
                //log.info("handleAppCommand, activate");
                // Only move the focus forward if the TipTap page is in focus;
                // otherwise, let windows_onFocusChanged() or tabs_onActivated() restore the focus on tab-box.
                if (ttWinHasFocus && ttTabIsActive) {
                    focusNextTabbox();
                } else {
                    //log.info("handleAppCommand, TipTap page was not in focus.  Let windows_onFocusChanged() or tabs_onActivated() restore focus on tab-box.");
                }
            } else if (appCommand == "search") {
                //log.info("handleAppCommand, search");
                focusSearch(true);
            } else {
                log.warn("handleAppCommand, unknown appCommand: " + appCommand);
                focusSearch(true);
            }
        });
    }

    const minimizedExpirationMS = 14 * 24 * 60 * 60 * 1000;
    function setupGCTask() {
        // setTimeout( () => {
        //     let nowMS = Date.now();
        //     let wins = Object.keys(uiState.windowsMinimized).filter( key => (nowMS - uiState.windowsMinimized[key]) > minimizedExpirationMS );
        //     wins.forEach( key => delete uiState.windowsMinimized[key] );
        //     let ctrs = Object.keys(uiState.containersMinimized).filter( key => (nowMS - uiState.containersMinimized[key]) > minimizedExpirationMS );
        //     ctrs.forEach( key => delete uiState.containersMinimized[key] );
        //     if ( (wins.length + ctrs.length) > 0 )
        //         dSaveUiState();
        // }, 15*1000);
    }

    function asyncSaveUiStateNow() {
        if (uiState)
            uistate.asyncSaveUiState(uiState);
    }

    let dSaveUiState = app.debounce(asyncSaveUiStateNow, 5*1000, false);

    function thumbnailDimFromSetting(theSettings) {
        imgWidth[0]  = theSettings.thumbnailWidth0  || "8.0rem";
        imgHeight[0] = theSettings.thumbnailHeight0 || "4.50rem";
        imgWidth[1]  = theSettings.thumbnailWidth1  || "12.00rem";
        imgHeight[1] = theSettings.thumbnailHeight1 || "6.75rem";
        imgWidth[2]  = theSettings.thumbnailWidth2  || "17.77rem";
        imgHeight[2] = theSettings.thumbnailHeight2 || "10.00rem";
    }

    function storage_onChanged(storageChange) {
        // Monitor settings storage change.
        if (app.has(storageChange, "tipTabSettings")) {
            ttSettings = TipTabSettings.upgradeWith(storageChange.tipTabSettings.newValue);
            thumbnailDimFromSetting(ttSettings);
            setupKeyboardListeners();
            redrawRefreshContentOnFiltering();
            redrawRefreshControls();
            setImgDimension(imgWidth[uiState.thumbnailSize], imgHeight[uiState.thumbnailSize]);
            //refreshBrowserActionTooltip();
        }
    }

    // Note: tabs_onCreated() can come before this.
    function windows_onCreated(win) {
        // log.info("windows_onCreated", win);
        createWindowDataAsNeeded(win.id, win, null);    // tabs_onCreated() can come before windows_onCreated; set up the window data structure.
    }

    // This should be called after tabs_onRemoved on all the tabs in the window.
    function windows_onRemoved(wid) {
        // log.info("windows_onRemoved", wid);
        removeWindowLane(wid);
        windowIds = windowIds.filter( id => id != wid );
        delete windowById[wid];
        delete tabIdsByWid[wid];
    }

    // Ways the extension page comes into focus:
    // 1. Not running, browserAction button is clicked, via browser.browserAction.onClicked => appCommand: launch, onFocusChanged/tabs_onActivated not called
    // 2. Not running, the "launch" hot key is pressed, via browser.commands.onCommand => appCommand: launch, onFocusChanged/tabs_onActivated not called
    // 3. Not running, the "search" hot key is pressed, via browser.commands.onCommand => appCommand: search, onFocusChanged/tabs_onActivated not called
    // 4. Window unfocused, browserAction button is clicked, via browser.browserAction.onClicked => appCommand: launch, onFocusChanged, onMessage appCommand
    // 5. Window unfocused, the "launch" hot key is pressed, via browser.commands.onCommand => appCommand: launch, onFocusChanged, onMessage appCommand
    // 6. Window unfocused, the "search" hot key is pressed, via browser.commands.onCommand => appCommand: search, onFocusChanged, onMessage appCommand
    // 7. Tab inactive, browserAction button is clicked, via browser.browserAction.onClicked => appCommand: launch, onActivated, onMessage appCommand
    // 8. Tab inactive, the "launch" hot key is pressed, via browser.commands.onCommand => appCommand: launch, onActivated, onMessage appCommand
    // 9. Tab inactive, the "search" hot key is pressed, via browser.commands.onCommand => appCommand: search, onActivated, onMessage appCommand
    // 10. Tab active, browserAction button is clicked, via browser.browserAction.onClicked => appCommand: launch, onFocusChanged/tabs_onActivated not called
    // 11. Tab active, the "launch" hot key is pressed, via browser.commands.onCommand => appCommand: launch, onFocusChanged/tabs_onActivated not called
    // 12. Tab active, the "search" hot key is pressed, via browser.commands.onCommand => appCommand: search, onFocusChanged/tabs_onActivated not called
    // 13. Window unfocused, the window is activated => appCommand: none, onFocusChanged
    // 14. Tab inactive, the tab is activated => appCommand: none,
    // 15. Window unfocused and tab inactive, the window is activated => appCommand: none, onFocusChanged
    // 16. Window unfocused and tab inactive, the tab is activated => appCommand: none, onFocusChanged, onActivated
    function windows_onFocusChanged(wid) {
        // log.info("windows_onFocusChanged windowId: " + wid + ", is tiptapWid: " + (wid == tiptapWid));
        if (wid >= 0) {
            // Update the active window's title to bold.
            Object.values(windowById).forEach( w => w.focused = false );
            $(".window-title").removeClass("bold");

            if (windowById.hasOwnProperty(wid)) {
                windowById[wid].focused = true;
                $(".window-lane[data-wid='" + wid + "'] .window-title").addClass("bold");
            }

            // TipTap loses focus on the tab-box item sometimes when activated other tabs before.
            // Restore focus to previous focused tab-box or to the search box when the TipTap's window is in focused.
            // The active states of all tabs in tabById are tracked by tabs_onActivated and they are uptodate.
            if (wid == tiptapWid && tabById.hasOwnProperty(tiptapTid) && tabById[tiptapTid].active) {
                restoreFocus(true);
            }
        }
    }

    function tabs_onActivated(info) {
        // log.info("tabs_onActivated windowId: " + info.windowId + ", tabId: " + info.tabId);
        // log.info("tabs_onActivated", info);
        if (tabById.hasOwnProperty(info.tabId)) {
            tabById[info.tabId].hidden = false;     // active tab cannot be hidden.
            transitionActiveTabs(info.tabId);       // refresh tab's UI
        }

        // TipTap loses focus on the tab-box item sometimes when activated other tabs before.
        // Restore focus to previous focused tab-box or to the search box when the TipTap's window is in focused.
        if (info.windowId == tiptapWid && info.tabId == tiptapTid) {
            restoreFocus(true);
        }
    }

    function transitionActiveTabs(newActiveTid) {
        //log.info("transitionActiveTabs: ", newActiveTid, tabById[newActiveTid], tabById[newActiveTid].windowId, tabIdsByWid[tabById[newActiveTid].windowId]);
        let newActiveTab        = tabById[newActiveTid];
        let oldActiveTid        = tabIdsByWid[newActiveTab.windowId].find( tid => tabById[tid].active );
        if (oldActiveTid && newActiveTid != oldActiveTid) {
            tabById[oldActiveTid].active = false;
            refreshTabActiveState(tabById[oldActiveTid]);
        }
        newActiveTab.active = true;
        refreshTabActiveState(newActiveTab);
        updateWindowTitle(newActiveTab);
    }

    function updateWindowTitle(tab) {
        if (tab.active) {
            windowById[tab.windowId].title = tab.title;
            fillWindowText(windowById[tab.windowId]);
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

    function tabs_onCreated(tab) {
        // log.info("tabs_onCreated ", tab.id);
        let exists = createTabDataAsNeeded(tab);    // tabs_onUpdated(, "favIconUrl", ) will be called before tabs_onCreated!
        if (!exists) {
            renderNewTab(tab);
        }
    }

    const ATTRS_FOR_UPDATE = ["url", "title", "favIconUrl", "audible", "pinned", "mutedInfo", "hidden"];
    
    function tabs_onUpdated(tabId, info, tab) {
        // log.info("tabs_onUpdated ", tabId, Object.keys(info));
        let exists = createTabDataAsNeeded(tab);    // tabs_onUpdated(, "favIconUrl", ) will be called before tabs_onCreated!
        if (!exists) {
            renderNewTab(tabById[tabId]);
        } else {
            let attrsToUpdate = ATTRS_FOR_UPDATE.filter( attr => info.hasOwnProperty(attr) );   // info has the property being updated.
            attrsToUpdate.forEach( attr => tabById[tabId][attr] = info[attr] );
            if ((info.hasOwnProperty("status") && info.status == "complete")) {
                refreshTabThumbnail(tab);
            }
            if (attrsToUpdate.length > 0) {
                refreshTabAttributes(tab);
            }
            if (info.hasOwnProperty("title")) {
                updateWindowTitle(tabById[tabId]);
            }
        }
    }

    function tabs_onMoved(tabId, moveInfo) {
        // log.info("tabs_onMoved tabId: " + tabId);
        return pReloadTabsWindowsAndContainers().then( () => redrawRefreshUIContent(false, false) );
    }


    function setupDOMListeners() {
        // log.info("setupDOMListeners");

        // Dialog setup
        dlg.setupDlg("#about-dlg", true);

        // Global menu at the top navbar
        $("#global-cmds").on("click", ".cmd-options",           function(){ browser.runtime.openOptionsPage()               });
        $("#global-cmds").on("click", ".cmd-toggle-theme",      toggleTheme);
        $("#global-cmds").on("click", ".cmd-refresh",           pReloadRedrawRefreshContent);
        $("#global-cmds").on("click", ".cmd-create-window",     function(){ pCreateWindow().then(w => activateWindow(w.id)) });
        $("#global-cmds").on("click", ".cmd-undo-close",        function(){ undoCloseTab()                                  });
        $("#global-cmds").on("click", ".cmd-drag-mode",         function(){ toggleDragMode()                                });
        $("#global-cmds").on("click", ".cmd-minimize-all",      function(){ toggleMinimize()                                });
        $("#global-cmds").on("click", ".cmd-mute-all",          function(){ muteTabs(effectiveTabIds, true)                 });
        $("#global-cmds").on("click", ".cmd-unmute-all",        function(){ muteTabs(effectiveTabIds, false)                });
        $("#global-cmds").on("click", ".cmd-close-ui",          function(){ pSendCmd({ cmd: "close-ui" })                   });
        $("#global-cmds").on("click", ".cmd-about",             showAboutDlg);
        $(".logo").on("click",                                  showAboutDlg);

        // Commands on v-btn-bar
        $(".v-btn-bar").on("click", ".cmd-tab-style",           function(){ toggleTabStyle()                                });
        $(".v-btn-bar").on("click", ".cmd-all-tabs",            function(){ selectDisplayType(DT_ALL_TABS)                  });
        $(".v-btn-bar").on("click", ".cmd-by-window",           function(){ selectDisplayType(DT_WINDOW)                    });
        $(".v-btn-bar").on("click", ".cmd-by-container",        function(){ selectDisplayType(DT_CONTAINER)                 });
        $(".v-btn-bar").on("click", ".cmd-small-size",          function(){ setThumbnailSize(0)                             });
        $(".v-btn-bar").on("click", ".cmd-medium-size",         function(){ setThumbnailSize(1)                             });
        $(".v-btn-bar").on("click", ".cmd-large-size",          function(){ setThumbnailSize(2)                             });
        $(".v-btn-bar").on("click", ".cmd-show-empty",          function(){ toggleShowEmpty()                               });

        $("#main-content").on("click", ".error-close",          function(){ hideErrorMsg()                                  });

        // Window topbar command handlers.
        $("#main-content").on("click", ".cmd-minimize-win",     function(){ minimizeWindowLane($(this).closest(".window-lane").data("wid"))         });
        $("#main-content").on("click", ".cmd-restore-win",      function(){ restoreWindowLane($(this).closest(".window-lane").data("wid"))          });
        
        // Window command handlers.  Event propagation stopped by .lane-topbar-cmds.
        $("#main-content").on("click", ".cmd-reload-w-tabs",    function(){ reloadWindowTabs($(this).closest(".window-lane").data("wid"))           });
        $("#main-content").on("click", ".cmd-create-tab",       function(){ pCreateWindowTab($(this).closest(".window-lane").data("wid"))           });
        $("#main-content").on("click", ".cmd-copy-w-title-url", function(){ copyWindowTabTitleUrls($(this).closest(".window-lane").data("wid"))     });
        $("#main-content").on("click", ".cmd-mute-w-all",       function(){ muteWindowTabs($(this).closest(".window-lane").data("wid"), true)       });
        $("#main-content").on("click", ".cmd-unmute-w-all",     function(){ muteWindowTabs($(this).closest(".window-lane").data("wid"), false)      });
        $("#main-content").on("click", ".cmd-show-w-all",       function(){ showWindowTabs($(this).closest(".window-lane").data("wid"), true)       });
        $("#main-content").on("click", ".cmd-hide-w-all",       function(){ showWindowTabs($(this).closest(".window-lane").data("wid"), false)      });
        $("#main-content").on("click", ".cmd-pin-w-all",        function(){ pinWindowTabs($(this).closest(".window-lane").data("wid"), true)        });
        $("#main-content").on("click", ".cmd-unpin-w-all",      function(){ pinWindowTabs($(this).closest(".window-lane").data("wid"), false)       });
        $("#main-content").on("click", ".cmd-close-w-tabs",     function(){ pCloseWindowTabs($(this).closest(".window-lane").data("wid"))           });

        // Container topbar command handlers.
        $("#main-content").on("click", ".cmd-minimize-c",       function(){ minimizeContainerLane($(this).closest(".container-lane").data("cid"))   });
        $("#main-content").on("click", ".cmd-restore-c",        function(){ restoreContainerLane($(this).closest(".container-lane").data("cid"))    });
        
        // Container command handlers.  Event propagation stopped by .lane-topbar-cmds.
        $("#main-content").on("click", ".cmd-reload-c-tabs",    function(){ reloadContainerTabs($(this).closest(".container-lane").data("cid"))     });
        $("#main-content").on("click", ".cmd-create-c-tab",     function(){ createContainerTab($(this).closest(".container-lane").data("cid"))      });
        $("#main-content").on("click", ".cmd-group-c-tabs",     function(){ groupContainerTab($(this).closest(".container-lane").data("cid"))       });
        $("#main-content").on("click", ".cmd-close-c-tabs",     function(){ closeContainerTab($(this).closest(".container-lane").data("cid"))       });

        // Tab command handlers
        $("#main-content").on("click", ".cmd-close-tab",        function(){ pCloseTabs([ $(this).closest(".tab-box").data("tid") ])                 });
        $("#main-content").on("click", ".cmd-select-tab",       function(e){ $(this).closest(".tab-box").toggleClass("selected");   return stopEvent(e)     });
        $("#main-content").on("click", ".cmd-reload-tab",       function(){ reloadTab($(this).closest(".tab-box").data("tid"))                      });
        $("#main-content").on("click", ".cmd-duplicate-tab",    function(){ duplicateTab($(this).closest(".tab-box").data("tid"))                   });
        $("#main-content").on("click", ".cmd-move-tab-new",     function(){ pMoveToNewWindow($(this).closest(".tab-box").data("tid"))               });
        $("#main-content").on("click", ".cmd-copy-tab-url",     function(){ copyTabUrl($(this).closest(".tab-box").data("tid"))                     });
        $("#main-content").on("click", ".cmd-save-tab-img",     function(){ saveTabImg($(this).closest(".tab-box").data("tid"))                     });
        $("#main-content").on("click", ".cmd-close-others",     function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "all")          });
        $("#main-content").on("click", ".cmd-close-left",       function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "left")         });
        $("#main-content").on("click", ".cmd-close-right",      function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "right")        });
        $("#main-content").on("click", ".cmd-toggle-muted",     function(){ toggleTabMuted($(this).closest(".tab-box").data("tid"))                 });
        $("#main-content").on("click", ".cmd-toggle-hidden",    function(){ toggleTabHidden($(this).closest(".tab-box").data("tid"))                });
        $("#main-content").on("click", ".cmd-toggle-pinned",    function(){ toggleTabPinned($(this).closest(".tab-box").data("tid"))                });
        $("#main-content").on("click", ".cmd-discard-tab",      function(){ discardTab($(this).closest(".tab-box").data("tid"))                     });

        // Tab status click handlers
        $("#main-content").on("click", ".status-pinned",        function(e){ toggleTabPinned($(this).closest(".tab-box").data("tid"));  return stopEvent(e) });
        $("#main-content").on("click", ".status-muted",         function(e){ toggleTabMuted($(this).closest(".tab-box").data("tid"));   return stopEvent(e) });
        $("#main-content").on("click", ".status-audible",       function(e){ toggleTabMuted($(this).closest(".tab-box").data("tid"));   return stopEvent(e) });
        $("#main-content").on("click", ".status-hidden",        function(e){ toggleTabHidden($(this).closest(".tab-box").data("tid"));  return stopEvent(e) });

        // Tab topbar event handlers
        $("#main-content").on("click", ".tab-topbar",           function(){ $(this).closest(".tab-box").focus()                                     });

        // focus handler on the tab-able elements (.cmd-search and .tab-box)
        $("body").on("focus", "[tabindex]:not([disabled]):not([tabindex='-1'])", function(){ previousFocusedTid = $(this).data("tid")               });

        // Footer command handlers
        $(".header-bar").on("click", ".cmd-filter-by-audible",  function(){ toggleFilterByStatus("filterByAudible")                                 });
        $(".header-bar").on("click", ".cmd-filter-by-muted",    function(){ toggleFilterByStatus("filterByMuted")                                   });
        $(".header-bar").on("click", ".cmd-filter-by-pinned",   function(){ toggleFilterByStatus("filterByPinned")                                  });
        $(".header-bar").on("click", ".cmd-filter-by-hidden",   function(){ toggleFilterByStatus("filterByHidden")                                  });

        // Events on tab thumbnails
        $("#main-content").on("click", ".tab-thumbnail",        onThumbnailClicked);

        // Events on the window lane
        $("#main-content").on("click", ".window-topbar",        function(){ activateWindow($(this).closest(".window-lane").data("wid"))             });
        $("#main-content").on("click", ".window-lane .tab-grid",function(){ activateWindow($(this).closest(".window-lane").data("wid"))             });

        // Events on the tabtext view
        $("#main-content").on("click", ".tabtext-window",       function(){ activateWindow($(this).data("wid"))                                     });
        $("#main-content").on("click", ".tabtext-tab",          function(e){ activateTid($(this).data("tid")); return stopEvent(e);                 });

        // Command containers cancel/stop event propagation
        $("#main-content").on("click", ".tab-topbar-menu, .tab-topbar-cmds, .status-private, .lane-topbar-cmds",
                                                                function(e){ return stopEvent(e) });
        // Search handler
        $(".cmd-search").on("click",                            function(){ $(this).select()                                                        });
        $(".cmd-search").on("keyup paste",                      function(){ searchTabs($(this).val())                                               });
        $(".cmd-clear-search").on("click",                      function(){ $(".cmd-search").val("").select();  searchTabs("")                      });
        $(".cmd-search-save").on("click",                       function(){ toggleSearchSaving()                                                    });
        $(".cmd-search-save-undo").on("click",                  function(){ undoSearchSaving()                                                      });
        $("#saved-search").on("click", ".btn-saved-search",     function(){ handleSavedSearch($(this))                                              });

        $(window).focus(function(){
            // log.info("window.focus");
            tiptabWindowActive = true;
        });

        // Blur event is fired whenever window loses focus.
        $(window).blur(function(){
            // log.info("window.blur, tiptabWindow shutdown");
            tiptabWindowActive = false;
            asyncSaveUiStateNow();
        });


        // Mouse events on thumbnail
        $("#main-content").on("mouseover", ".tabbox-arc", function(){
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
        $("#main-content").on("mouseout", ".tabbox-arc", function(){
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

        document.removeEventListener("keydown", keydownHandler, false);
        document.removeEventListener("keyup", hotKeyupHandler, false);

        savedSearchSeqs = [];
        for (let i = 1; i <= uistate.MAX_SAVED_SEARCHES; i++) {
            let prefix = (ttSettings.savedSearchKeyPrefix || "").trim();
            let keySeq = prefix == "" ? "" : prefix + i;            // Ctrl+Shift+1 to Ctrl+Shift+8
            savedSearchSeqs.push(wwhotkey.KeySeq.ofKeySeq(keySeq));
        }

        // activateDefaultSeq = wwhotkey.KeySeq.ofKeySeq(getDefaultActivateHotKey());
        // activateSettingSeq = wwhotkey.KeySeq.ofKeySeq(ttSettings.enableCustomHotKey ? ttSettings.appHotKey : "");
        // searchDefaultSeq = wwhotkey.KeySeq.ofKeySeq(getDefaultSearchHotKey());
        // searchSettingSeq = wwhotkey.KeySeq.ofKeySeq(ttSettings.enableCustomHotKey ? ttSettings.searchHotKey : "");
        activateDefaultSeq = wwhotkey.KeySeq.ofKeySeq("");
        activateSettingSeq = wwhotkey.KeySeq.ofKeySeq("");
        searchDefaultSeq = wwhotkey.KeySeq.ofKeySeq("");
        searchSettingSeq = wwhotkey.KeySeq.ofKeySeq("");
        
        document.addEventListener("keydown", keydownHandler, false);
        document.addEventListener("keyup", hotKeyupHandler, false);
    }
    
    function getDefaultActivateHotKey() {
        try {
            let manifest = browser.runtime.getManifest();
            let hotkey = manifest.commands._execute_browser_action.suggested_key.default;
            return hotkey;
        } catch (err) {
            return "Ctrl-Shift-L";
        }
    }

    function getDefaultSearchHotKey() {
        try {
            let manifest = browser.runtime.getManifest();
            let hotkey = manifest.commands.search.suggested_key.default;
            return hotkey;
        } catch (err) {
            return "Ctrl-Shift-F";
        }
    }

    function keydownHandler(e) {
        currentSeq.fromEvent(e);
        if (ttSettings.enableCustomHotKey) {
            if (currentSeq.equals(activateSettingSeq)) {
                handleAppCommand("activate", true, true);   // keydown handling is on the Tip Tab page.  Its window has to be in focused and it's active.
                return;
            }
            if (currentSeq.equals(searchSettingSeq)) {
                handleAppCommand("search", true, true);     // keydown handling is on the Tip Tab page.  Its window has to be in focused and it's active.
                return;
            }
        }
        if (currentSeq.equals(activateDefaultSeq)) {
            handleAppCommand("activate", true, true);       // keydown handling is on the Tip Tab page.  Its window has to be in focused and it's active.
            return;
        }
        if (currentSeq.equals(searchDefaultSeq)) {
            handleAppCommand("search", true, true);         // keydown handling is on the Tip Tab page.  Its window has to be in focused and it's active.
            return;
        }
        for (let i = 0; i < savedSearchSeqs.length; i++) {
            if (currentSeq.equals(savedSearchSeqs[i])) {
                let $btn = $("#saved-search .btn-saved-search").eq(i);
                $btn.addClass("flash-yellow").delay(300).queue(() => $btn.removeClass("flash-yellow").dequeue() );
                let txt = uiState.savedSearch[i] || "";
                $(".cmd-search").val(txt).select();
                searchTabs(txt);
                return;
            }
        }
    }

    function hotKeyupHandler(e) {
        currentSeq.clear();
    }

    function focusNextTabbox() {
        // log.info("focusNextTabbox");
        if (document.activeElement) {
            let $tabbingItems = $("[tabindex]:not([disabled]):not([tabindex='-1'])");
            let activeIndex = $tabbingItems.index($(document.activeElement));
            if (activeIndex >= 0) {
                $tabbingItems[ (activeIndex + 1) % $tabbingItems.length ].focus();
            } else {
                // log.info("No activeIndex");
                focusSearch(true);
            }
        } else {
            // log.info("No document.activeElement");
            focusSearch(true);
        }
    }    

    function setupMessageHandlers() {
        // log.info("setupMessageHandlers");
        return browser.runtime.onMessage.addListener(function(msg, sender, sendResponse) {
            // log.info("onMessage() ", msg);
            switch (msg.cmd) {
            case "appCommand":
                // log.info("from tiptab_daemon, appCommand, arg: " + msg.arg);
                handleAppCommand(msg.arg, msg.ttWinHasFocus, msg.ttTabIsActive);
                return;
            default:
                log.info("onMessage() unknown cmd: " + msg.cmd);
                break;
            }
        });
    }


    function refreshStaticUI() {
        // log.info("refreshStaticUI");

        setImgDimension(imgWidth[uiState.thumbnailSize], imgHeight[uiState.thumbnailSize]);

        // Restore search text from saved state.
        $(".cmd-search").val(uiState.searchTerms.join(" "));
    }
    
    function redrawRefreshControls() {
        // VBar buttons are always visible and no need to redraw.

        refreshGlobalCmds();
        refreshVBtnBarControls();
        refreshHeaderControls();
        redrawFooterControls();     // footer controls are dynamic and need redrawing based on current state of the data.
        refreshFooterControls();
        redrawSavedSearches();
    }

    function refreshControls() {
        refreshVBtnBarControls();
        refreshHeaderControls();
        refreshFooterControls();
    }

    function refreshGlobalCmds() {
        // Only replaces the text but preserves other child elements.
        $(".cmd-toggle-theme").contents().filter(function(){ return this.nodeType == 3 }).first().replaceWith("  Theme - " + uiState.theme);
        $(".cmd-toggle-theme").attr("title", ui.themeDesc(uiState.theme) + " [system color mode: " + ui.systemColorScheme() + "]" );
    }

    function refreshVBtnBarControls() {
        let isTextStyle = uiState.showTabStyle == uistate.TS_TEXT;

        $(".cmd-all-tabs"    ).toggleClass("active", is_all_tabs());
        $(".cmd-by-window"   ).toggleClass("active", is_by_window());
        $(".cmd-by-container").toggleClass("active", is_by_container());

        $(".cmd-tab-style").toggleClass("active", isTextStyle);

        if (is_by_window()) {
            $(".cmd-show-empty").toggleClass("active", uiState.showEmptyWindows);
        }
        if (is_by_container()) {
            $(".cmd-show-empty").toggleClass("active", uiState.showEmptyContainers);
        }
        $(".cmd-show-empty").toggleClass("disabled", isTextStyle);

        $(".cmd-small-size" ).toggleClass("active", (uiState.thumbnailSize == 0)).toggleClass("disabled", isTextStyle);
        $(".cmd-medium-size").toggleClass("active", (uiState.thumbnailSize == 1)).toggleClass("disabled", isTextStyle);
        $(".cmd-large-size" ).toggleClass("active", (uiState.thumbnailSize == 2)).toggleClass("disabled", isTextStyle);
    }

    function redrawFooterControls() {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            break;
        case DT_WINDOW:
            break;
        case DT_CONTAINER:
            break;
        }
    }

    function refreshHeaderControls() {
        $(".cmd-filter-by-audible img").attr("src", ICON_AUDIBLE[uiState.filterByAudible]);
        $(".cmd-filter-by-muted   img").attr("src", ICON_MUTED[uiState.filterByMuted]);
        $(".cmd-filter-by-pinned  img").attr("src", ICON_PINNED[uiState.filterByPinned]);
        $(".cmd-filter-by-hidden  img").attr("src", ICON_HIDDEN[uiState.filterByHidden]);

        $(".cmd-drag-mode").removeClass("btn-link").addClass(dragSelectionMode ? "" : "btn-link");
        $(".cmd-drag-mode").attr("data-badge", dragSelectionMode ? "+" : "");
    }

    function refreshFooterControls() {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            break;
        case DT_WINDOW:
            break;
        case DT_CONTAINER:
            break;
        }
    }

    function redrawSavedSearches() {
        $("#saved-search").html(renderSavedSearches());
        fillSavedSearchText();
        $(".cmd-search-save").attr("title", "Save search");
    }

    // Rendered html has no unsafe text.
    function renderSavedSearches() {
        let lastIndex = -1;
        for (let i = uiState.savedSearch.length - 1; i >=0; i--) {
            if (uiState.savedSearch[i]) {
                lastIndex = i;
                break;
            }
        }

        return `<div class="btn-group btn-group-block">
                  ${ uiState.savedSearch.map( (txt, i) => renderSavedSearchButton(i > lastIndex) ).join(" ") }
                </div>`;
    }

    function renderSavedSearchButton(asHidden) {
        return `<button class="btn btn-sm btn-saved-search ${asHidden ? 'hidden' : ''}" tabindex='-1'></button>`;
    }

    // Use html-escaped API to fill in unsafe text.
    function fillSavedSearchText() {
        uiState.savedSearch.forEach( (txt, i) => $("#saved-search .btn-saved-search").eq(i)
                                     .text(txt)
                                     .attr("title", (i+1) + " - search by: " + txt) );
    }

    function showSavedSearchButtonsForSaving() {
        uiState.savedSearch.forEach( (txt, i) => $("#saved-search .btn-saved-search").eq(i)
                                     .attr("title", (txt ? "click to save over existing search text" : "click to save here"))
                                     .addClass("btn-saved-search-saving")
                                     .show() );
    }


    function pReloadRedrawRefreshContent() {
        return pReloadTabsWindowsAndContainers()
            .then( () => redrawRefreshUIContent(true, true) );
    }

    function pReloadTabsWindowsAndContainers() {
        let tabs;
        return browser.tabs.query({})
            .then( resultTabs => {
                tabs = resultTabs;
                //tabs          = tabs.filter( tab => !is_tiptaburl(tab.url) );     // get rid of the TipTab tab.
                tabById         = tabs.reduce( (map, tab) => { map[tab.id] = tab; return map }, {} );
            }).then( () => {
                let             urls = tabs.map( tab => tab.url );
                let             uniqUrls = [...new Set(urls)];
                return db.pGetTabFavicons(uniqUrls);            // load existing cached favIcons.
            }).then( favIconRecords => {
                favIconRecords.filter( rec => rec ).forEach( rec => cachedFavIconMap[rec.key] = rec.image );
            }).then( () => {
                let notCachedFavIconTabs = tabs.filter( tab => !cachedFavIconMap[db.urlToKey(tab.url)] );
                return db.pSaveTabFavicons(notCachedFavIconTabs);
            }).then( () => {
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

    // tabs_onCreated() can come before windows_onCreated.  This needs to handle the out of order of creation events on window and tab.
    function createWindowDataAsNeeded(wid, win, tab) {
        let windowExists = windowById.hasOwnProperty(wid);
        if (!windowExists) {
            windowIds.push(wid);
            tabIdsByWid[wid] = [];
        }
        if (!win) {
            // Use the existing window object or create a new one as much as possible based on the tab object.
            win = windowById[wid] || {
                id:             tab.windowId,
                focused:        false,
                top:            0,
                left:           0,
                width:          tab.width,
                height:         tab.height,
                incognito:      tab.incognito,
                type:           "normal",
                state:          "normal",
                alwaysOnTop:    false,
                title:          tab.title
            };
        }
        windowById[wid] = win;
        if (!windowExists) {
            addWindowLane(win);
        }
    }

    function createTabDataAsNeeded(newTab) {
        if (tabById.hasOwnProperty(newTab.id))
            return true;
        tabById[newTab.id] = newTab;
        createWindowDataAsNeeded(newTab.windowId, null, newTab);    // tabs_onCreated() can come before windows_onCreated; set up the window data structure.
        app.addAt(tabIdsByWid[newTab.windowId], newTab.id, newTab.index);
        app.addAt(tabIdsByCid[newTab.cookieStoreId], newTab.id, newTab.index);
        thumbnailsMap[newTab.id] = null;
        thumbnailsCapturing[newTab.id] = null;
        updateEffectiveTabIds();
        return false;
    }

    function cloneTabData(tabId) {
        return app.cloneObj(tabById[tabId]) || {};
    }

    function renderNewTab(tab) {
        // TODO: render individual tab inserting the DOM by index position of the tab.
        renderLanePaneUI(tab.windowId, tab.cookieStoreId);
        refreshTabThumbnail(tab);
        refreshTabAttributes(tab);
    }
    
    function refreshTabThumbnail(tab) {
        if (ttSettings.realtimeUpdateThumbnail || !thumbnailsMap[tab.id]) {
            refreshThumbnail(tab.id, true);     // force recapturing image
        } else {
            refreshThumbnail(tab.id, false);
        }
    }
 
    function renderLanePaneUI(windowId, cookieStoreId) {
        //resetDragAndDrop();
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            refreshAllTabsContentWithImages(false, false);
            effectiveTabIds.forEach( tid => refreshThumbnail(tid, false) );     // not force recapturing image
            break;
        case DT_WINDOW:
            refreshWindowTabs(windowId);
            effectiveWindowTids(windowId).forEach( tid => refreshThumbnail(tid, false) );
            break;
        case DT_CONTAINER:
            refreshContainerTabs(cookieStoreId, false);
            effectiveContainerTids(cookieStoreId).forEach( tid => refreshThumbnail(tid, false) );
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

    function isTabActive(tab) {
        return tab.active || wasTabActive(tab);
    }

    function wasTabActive(tab) {
        return tab.hasOwnProperty("windowId") && tab.windowId == tiptapWid && tab.id == currentLastActiveTabId;
    }

    function isDraggable(tab) {
        return !tab.pinned & (uiState.displayType == DT_WINDOW || uiState.displayType == DT_CONTAINER);
    }

    function countTabs() {
        return Object.keys(tabById).length;
    }

    function getTabIds() {
        return [].concat.apply([], Object.values(tabIdsByWid));     // join all the tabId arrays from tabIdsByWid.
    }

    function toTabs(tids) {
        return tids ? tids.map( tid => tabById[tid] ) : [];
    }

    function toTabIds(tabs) {
        return tabs ? tabs.map( tab => tab.id ) : [];
    }

    function orderTabIndex(wid) {
        tabIdsByWid[wid].forEach( (tid, index) => tabById[tid].index = index );
    }

    function matchTabByWindowOrContainer(tab) {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
        case DT_WINDOW:
        case DT_CONTAINER:
            break;
        }
        return true;
    }

    function matchTabByFilteringStatus(tab) {
        let filteringEnabled = (uiState.filterByAudible == 1 || uiState.filterByMuted == 1 || uiState.filterByPinned == 1 || uiState.filterByHidden == 1);
        if (!filteringEnabled)
            return true;
        return  (uiState.filterByAudible == 1 && tab.audible) ||
                (uiState.filterByMuted  == 1 && isMuted(tab)) ||
                (uiState.filterByPinned == 1 && tab.pinned) ||
                (uiState.filterByHidden == 1 && tab.hidden)
    }

    function filterTab(tab, filterTokens) {
        let titleMatched = app.hasAll(tab.title, filterTokens, true);
        let urlMatched = app.hasAll(tab.url, filterTokens, true);
        return (titleMatched || urlMatched) &&
            matchTabByWindowOrContainer(tab) &&
            matchTabByFilteringStatus(tab) &&
            !is_tiptaburl(tab.url);
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
                $("#empty-title").text("");
                $("#empty-msg1").text("Tabs are hidden due to filtering by search or by tab's audible/muted/pinned/hidden status.");
                $("#empty-msg2").text("");
            } else {
                $("#empty-title").text("No tab.");
                $("#empty-msg1").text("Reload the page to get the latest tab data.");
                $("#empty-msg2").text("");
            }
        }
        setupDragAndDrop();
    }

    function zoomOutAnimation(tids) {
        // if (tids.length == 0)
        //     return;
        // let total = 500;
        // let inc = total / tids.length;
        // let delayMS = 0;
        // tids.forEach( tid => {
        //     let $tabBox = $tabbox(tid);
        //     $tabBox.removeClass("d-invisible").css("opacity", "0").stop().delay(delayMS).animate( {  opacity: 1 }, 100 );
        //     delayMS += inc;
        // });
    }

    // Re-draw/re-generate the UI content layout based on the current displayType.
    function redrawContentLayout() {
        let $mainContent = $("#main-content");

        if (uiState.showTabStyle == uistate.TS_IMAGE) {
            switch (uiState.displayType) {
            case DT_ALL_TABS:
                $mainContent.html(renderAllTabLane());
                break;
            case DT_WINDOW:
                $mainContent.html(renderWindowLanes());         // unsafe text are left out.
                fillWindowsText(windowIds);                     // fill in the unsafe text of the objects using html-escaped API.
                refreshWindowControlsOnLanes();
                break;
            case DT_CONTAINER:
                $mainContent.html(renderContainerLanes());      // unsafe text are left out.
                fillContainerText(containerIds);                // fill in the unsafe text of the objects using html-escaped API.
                refreshContainerControlsOnLanes();
                break;
            }
        } else {
            switch (uiState.displayType) {
            case DT_ALL_TABS:   $mainContent.html(renderTextLane("all tabs in text"));          break;
            case DT_WINDOW:     $mainContent.html(renderTextLane("window tabs in text"));       break;
            case DT_CONTAINER:  $mainContent.html(renderTextLane("container tabs in text"));    break;
            }
        }
    }
    
    function refreshContent(forceRefreshImg, zoomOut) {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            if (uiState.showTabStyle == uistate.TS_IMAGE) {
                refreshAllTabsContentWithImages(forceRefreshImg, zoomOut);
            } else {
                refreshAllTabsContentWithText();
            }
            break;
        case DT_WINDOW:
            if (uiState.showTabStyle == uistate.TS_IMAGE) {
                refreshWindowsContentWithImages(forceRefreshImg, zoomOut);
            } else {
                refreshWindowsContentWithText();
            }
            break;
        case DT_CONTAINER:
            if (uiState.showTabStyle == uistate.TS_IMAGE) {
                refreshContainersContentWithImages(forceRefreshImg, zoomOut);
            } else {
                refreshContainersContentWithText();
            }
            break;
        }
    }


    function renderTextLane(title) {
        return `
            <div class="content-title-bar">
              <span class="content-title">${title}</span>
              <span class="error-display">
                <i class="icon icon-cross" style="margin-top:-0.15rem;"></i>
                <span class="error-msg"></span>
              </span>
            </div>
            <div class="tabtext-tree"></div>
        `;
    }

    function refreshAllTabsContentWithText() {
        $(".tabtext-tree").html(renderTabTextForAllTabs());     // unsafe text are left out.
        refreshTabTextTabAttributes();                          // fill in the unsafe text using escaped API.
    }
    
    function refreshWindowsContentWithText() {
        $(".tabtext-tree").html(renderTabTextForWindows());     // unsafe text are left out.
        refreshTabTextWindowAttributes();                       // fill in the unsafe text using escaped API.
        refreshTabTextTabAttributes();                          // fill in the unsafe text using escaped API.
    }

    function renderTabTextForAllTabs() {
        return `
            <div class="tabtext-alltabs"> Tabs of all windows </div>
            <div class="ml-6">
                ${ renderTabTextTabs(effectiveTabIds, false) }
            </div>
        `;
    }

    function renderTabTextForWindows() {
        return `${ windowIds.map( wid => 
                    {
                        let effectiveTids = effectiveWindowTids(wid);
                        return effectiveTids.length == 0 ? "" : renderTabTextOfWindow(wid, effectiveTids);
                    }).join("\n") 
                }`;
    }

    function renderTabTextOfWindow(wid, effectiveTids) {
        let w = windowById[wid];
        return `
            <div class="tabtext-window" data-wid="${wid}">Window: <span class="tabtext-window-title">PLACEHOLDER:w.title</span> </div>
            <div class="ml-6">
                ${ renderTabTextTabs(effectiveTids, true) }
            </div>
        `;
    }

    function renderTabTextTabs(effectiveTids, indentEnabled) {
        let indentStack = [];
        return `
            <div class="tabtext-tabs">
                ${ effectiveTids.map( tid => renderTabTextTab(tid, indentStack, indentEnabled) ).join("\n") }
            </div>
        `;
    }

    function renderTabTextTab(tid, indentStack, indentEnabled) {
        let tab = tabById[tid];
        indentStack.popUntil(tab.openerTabId).push(tab.id);
        let indent = indentStack.length - 1;
        let margin = indentEnabled ? (indent * 1.4) + "rem" : "0rem";
        return `
            <div class="tabtext-tab" data-tid="${tid}">
                <img  class="tabtext-tab-favicon" src="PLACEHOLDER:tab.favIconUrl" style="margin-left: ${margin}">
                <a class="tabtext-tab-title" href="javascript:void(0)" >PLACEHOLDER:tab.title</a>
            </div>
        `;
    }

    function refreshTabTextWindowAttributes() {
        $(".tabtext-window").each(function(){
            let wid = $(this).data("wid");
            $(this).find(".tabtext-window-title").text(windowById[wid].title);
        });
    }
    
    function refreshTabTextTabAttributes() {
        $(".tabtext-tab").each(function(){
            let tid = $(this).data("tid");
            let tab = tabById[tid];
            let favIconUrl = tab.favIconUrl ? tab.favIconUrl : cachedFavIconMap[db.urlToKey(tab.url)];
            $(this).find(".tabtext-tab-favicon").attr("src", favIconUrl);
            $(this).find(".tabtext-tab-title"  ).text(tab.title).addClass(tab.active ? "bold" : "");
        });
    }
    
    function renderAllTabLane() {
        return `
            <div class="content-title-bar">
              <span class="content-title">all tabs in image</span>
              <span class="error-display">
                <i class="icon icon-cross" style="margin-top:-0.15rem;"></i>
                <span class="error-msg"></span>
              </span>
            </div>
            <div class="all-tab-lane">
              <div class="tab-grid"></div>
            </div>
        `;
    }

    function refreshAllTabsContentWithImages(forceRefreshImg, zoomOut) {
        let tabs = toTabs(effectiveTabIds);
        let html = renderTabGrid(tabs);                                     // unsafe text are left out.
        $(".all-tab-lane .tab-grid").html(html);
        refreshTabsAttributes(tabs);                                        // fill in the unsafe text using escaped API.
        effectiveTabIds.forEach( tid => refreshThumbnail(tid, forceRefreshImg) );
        if (zoomOut) {
            zoomOutAnimation(effectiveTabIds);
        }
    }

    // unsafe text are left out.
    function renderWindowLanes() {
        return `
            <div class="content-title-bar">
              <span class="content-title">window tabs in image</span>
              <span class="error-display">
                <i class="icon icon-cross" style="margin-top:-0.15rem;"></i>
                <span class="error-msg"></span>
              </span>
            </div>
            ${ windowIds.map( wid => windowById[wid] ).map( w => renderWindowLane(w) ).join("\n") }
        `;
    }

    // unsafe text are left out.
    function renderWindowLane(w) {
        return `
              <div class="window-lane d-none" data-wid="${w.id}" style="${border_color_private(w.incognito)} ${box_shadow_private(w.incognito)}">
                <div class="window-topbar">
                  <div class="window-title" title="Click to active the window">WINDOW-TITLE</div>

                  <div class="lane-topbar-cmds">
                    <button class="cmd-create-tab   btn btn-link lane-topbar-cmd mr-4" title="Create tab in the window" tabindex="-1"> <i class="icon icon-plus"></i> </button>
                    <button class="cmd-minimize-win btn btn-link lane-topbar-cmd mr-4" title="Minimize this panel" tabindex="-1"> <i class="icon icon-arrow-up"></i> </button>
                    <button class="cmd-restore-win  btn btn-link lane-topbar-cmd mr-4" title="Restore this panel"  tabindex="-1"> <i class="icon icon-arrow-down"></i> </button>
                    <div class="dropdown dropdown-right window-topbar-menu">
                      <div class="btn-group" >
                        <a href="#" class="btn btn-link dropdown-toggle lane-menu-dropdown" tabindex="-1"><i class="icon icon-menu"></i></a>
                        <ul class="menu" style="min-width: 6rem; margin-top: -2px;">
                          <li class="menu-item" title="Reload tabs in window"><a href="#" class="cmd-reload-w-tabs nowrap">Reload Tabs</a> </li>
                          <li class="menu-item" title="Create tab in window"> <a href="#" class="cmd-create-tab nowrap">Create Tab</a> </li>
                          <li class="divider"></li>
                          <li class="menu-item" title="Copy titles and Urls of tabs in window"> <a href="#" class="cmd-copy-w-title-url nowrap">Copy Titles & Urls</a> </li>
                          <li class="divider"></li>
                          <li class="menu-item" title="Mute tabs in window">  <a href="#" class="cmd-mute-w-all nowrap">Mute Tabs</a> </li>
                          <li class="menu-item" title="Unmute tabs in window"><a href="#" class="cmd-unmute-w-all nowrap">Unmute Tabs</a> </li>
                          <li class="menu-item" title="Pin tabs in window">   <a href="#" class="cmd-pin-w-all nowrap">Pin Tabs</a> </li>
                          <li class="menu-item" title="Unpin tabs in window"> <a href="#" class="cmd-unpin-w-all nowrap">Unpin Tabs</a> </li>
                          <li class="menu-item" title="Show tabs in window">  <a href="#" class="cmd-show-w-all nowrap">Show Tabs</a> </li>
                          <li class="menu-item" title="Hide tabs in window">  <a href="#" class="cmd-hide-w-all nowrap">Hide Tabs</a> </li>
                          <li class="divider"></li>
                          <li class="menu-item" title="Close tabs in window"> <a href="#" class="cmd-close-w-tabs nowrap">Close All Tabs</a> </li>
                        </ul>
                      </div>
                    </div>

                  </div>

                </div>
                <div class="tab-grid"></div>
              </div>
            `;
    }

    // Use html-escaped API to fill in unsafe text.
    function fillWindowsText(windowIds) {
        windowIds.map( wid => windowById[wid] ).forEach(fillWindowText);
    }

    function fillWindowText(w) {
        $(".window-lane[data-wid='" + w.id + "'] .window-title")
            .text(w.title)
            .removeClass("bold")
            .addClass(w.focused ? "bold" : "");
    }

    function refreshWindowControlsOnLanes() {
        windowIds.forEach( wid => refreshWindowControlsOnLane(wid) );
    }

    function refreshWindowControlsOnLane(wid) {
        // show or hide lane.
        let windowTids = effectiveWindowTids(wid);
        let isVisible = (uiState.showEmptyWindows || windowTids.length > 0);
        let $window_lane = $(".window-lane[data-wid='" + wid + "']");
        if (isVisible)
            $window_lane.removeClass("d-none");
        else
            $window_lane.removeClass("d-none").addClass("d-none");

        // minimize or restore lane.
        let isMinimized = uiState.windowsMinimized[wid] != undefined;
        $window_lane.find(".cmd-minimize-win").toggleClass("d-hide", isMinimized);
        $window_lane.find(".cmd-restore-win" ).toggleClass("d-hide", !isMinimized);
        $window_lane.find(".tab-grid").toggleClass("d-hide", isMinimized);
    }


    function addWindowLane(win) {
        if (uiState.displayType == DT_WINDOW) {
            let $mainContent = $("#main-content");
            $mainContent.append(renderWindowLane(win));     // render without the unsafe text.
            fillWindowsText([win.id]);                      // fill in the unsafe text of the objects using html-escaped API.
            let $window_lane = $(".window-lane[data-wid='" + win.id + "']");
            $window_lane.removeClass("d-none");
            redrawFooterControls();
            refreshFooterControls();
        }
    }

    function removeWindowLane(wid) {
        $(".window-lane[data-wid='" + wid + "']").animate({ height: 0 }, 600, function(){ $(this).remove() });
    }

    function titleLetter(title, defaultLetter) {
        return title.length ? title.substring(0, 1) : defaultLetter;
    }


    function refreshWindowsContentWithImages(forceRefreshImg, zoomOut) {
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
            refreshTabsAttributes(windowTabs);                              // fill in the unsafe text using escaped API.
        }
    }

    // unsafe text are left out.
    function renderContainerLanes() {
        return `
            <div class="content-title-bar">
              <span class="content-title">tabs by container</span>
              <span class="error-display">
                <i class="icon icon-cross error-close" style="margin-top:-0.15rem;"></i>
                <span class="error-msg"></span>
              </span>
            </div>

            ${ containerIds.map( cid => containerById[cid] ).map( c => renderContainerLane(c) ).join("\n") }
        `;
    }

    function renderContainerLane(c) {
        return `
            <div class="container-lane d-none" data-cid="${c.cookieStoreId}" 
                 style="border: 0.1rem solid ${c.colorCode}; ${box_shadow_private(is_firefox_private(c.cookieStoreId))}">
              <div class="container-topbar">
                <div class="container-title" title="${is_firefox_default(c.cookieStoreId) ? '' : 'Container'}">
                  <div style="background: ${c.colorCode}; width:12px; height:12px; margin-right: 0.4rem;"></div>
                  <img src="${c.iconUrl}" style="width:12px; height:12px; margin-right: 0.4rem; display: ${is_real_container(c.cookieStoreId) ? 'block' : 'none'};">
                  <span class="container-name">CONTAINER-NAME</span>
                </div>

                <div class="lane-topbar-cmds">
                  <button class="cmd-create-c-tab btn btn-link lane-topbar-cmd mr-4" title="Create tab in the container." tabindex="-1"> <i class="icon icon-plus"></i> </button>
                  <button class="cmd-minimize-c btn btn-link lane-topbar-cmd mr-4" title="Minimize this panel" tabindex="-1"> <i class="icon icon-arrow-up"></i> </button>
                  <button class="cmd-restore-c  btn btn-link lane-topbar-cmd mr-4 d-hide" title="Restore this panel"  tabindex="-1"> <i class="icon icon-arrow-down"></i> </button>
                  <div class="dropdown dropdown-right container-topbar-menu">
                    <div class="btn-group" >
                      <a href="#" class="btn btn-link dropdown-toggle lane-menu-dropdown" tabindex="-1"><i class="icon icon-menu"></i></a>
                      <ul class="menu" style="min-width: 6rem; margin-top: -2px;">
                        <li class="menu-item" title="Reload tabs in container"> <a href="#" class="cmd-reload-c-tabs nowrap">Reload Tabs</a> </li>
                        <li class="menu-item" title="Create tab in container"> <a href="#" class="cmd-create-c-tab nowrap">Create Tab</a> </li>
                        <li class="divider"></li>
                        <li class="menu-item" title="Move all container tabs to its own window"> <a href="#" class="cmd-group-c-tabs nowrap">Group Tabs</a> </li>
                        <li class="divider"></li>
                        <li class="menu-item" title="Close all tabs in container"> <a href="#" class="cmd-close-c-tabs nowrap">Close Tabs</a> </li>
                      </ul>
                    </div>
                  </div>
                </div>

              </div>
              <div class="tab-grid"></div>
            </div>
        `;
    }

    // Use html-escaped API to fill in unsafe text.
    function fillContainerText(containerIds) {
        containerIds.map( cid => containerById[cid] ).forEach( c => $(".container-lane[data-cid='" + c.cookieStoreId + "'] .container-name").text(c.name) );
    }

    function refreshContainerControlsOnLanes() {
        containerIds.forEach( cid => refreshContainerControlsOnLane(cid) );
    }

    function refreshContainerControlsOnLane(cid) {
        // show or hide container lane
        let containerTids = effectiveContainerTids(cid);
        let isVisible = (uiState.showEmptyContainers || containerTids.length > 0);
        let $container_lane = $(".container-lane[data-cid='" + cid + "']");
        if (isVisible)
            $container_lane.removeClass("d-none");
        else
            $container_lane.removeClass("d-none").addClass("d-none");

        // minimize or restore lane.
        let isMinimized = uiState.containersMinimized[cid] != undefined;
        $container_lane.find(".cmd-minimize-c").toggleClass("d-hide", isMinimized);
        $container_lane.find(".cmd-restore-c" ).toggleClass("d-hide", !isMinimized);
        $container_lane.find(".tab-grid").toggleClass("d-hide", isMinimized);
    }

    function refreshContainersContentWithImages(forceRefreshImg, zoomOut) {
        containerIds.forEach( cid => refreshContainerTabs(cid) );

        effectiveTabIds.forEach( tid => refreshThumbnail(tid, forceRefreshImg) );
        if (zoomOut) {
            zoomOutAnimation(effectiveTabIds);
        }
    }

    function refreshContainersContentWithText() {
        $(".tabtext-tree").html(renderTabTextForContainers());  // unsafe text are left out.
        refreshTabTextContainerAttributes();                    // fill in the unsafe text using escaped API.
        refreshTabTextTabAttributes();                          // fill in the unsafe text using escaped API.
    }
    
    function refreshContainerTabs(cid) {
        let containerTabs = effectiveContainerTabs(cid);
        let $container_lane = $(".container-lane[data-cid='" + cid + "']");
        if (containerTabs.length > 0) {
            let html = renderTabGrid(containerTabs);                            // unsafe text are left out.
            $container_lane.find(".tab-grid").html(html);
            refreshTabsAttributes(containerTabs);                               // fill in the unsafe text using escaped API.
        }
    }

    function renderTabTextForContainers() {
        return `${ containerIds.map( cid => 
                    {
                        let effectiveTids = effectiveContainerTids(cid);
                        return effectiveTids.length == 0 ? "" : renderTabTextOfContainer(cid, effectiveTids);
                    }).join("\n") 
                }`;
    }

    function renderTabTextOfContainer(cid, effectiveTids) {
        return `
            <div class="tabtext-container" data-cid="${cid}">Container: <span class="tabtext-container-title">PLACEHOLDER:container.name</span> </div>
            <div class="ml-6">
                ${ renderTabTextTabs(effectiveTids, true) }
            </div>
        `;
    }

    function refreshTabTextContainerAttributes() {
        $(".tabtext-container").each(function(){
            let cid = $(this).data("cid");
            $(this).find(".tabtext-container-title").text(containerById[cid].name);
        });
    }


    // Redraw/regenerate the tab boxes, fill in the tab's text, and refresh their thumbnails.
    function redrawTabBoxes(tids, forceRefreshImg) {
        //resetDragAndDrop();
        let tabs = toTabs(tids);
        tabs.forEach( tab => $tabbox(tab.id).replaceWith(renderTabBox(tab, false)) );   // 1. Generate html, without the unsafe text rendered.
        refreshTabsAttributes(tabs);                                                    // 2. Fill in the unsafe text.
        tids.forEach( tid => refreshThumbnail(tid, forceRefreshImg) );                  // 3. Render the thumbnail.
        setupDragAndDrop();                                                             // 4. Set up drag and drop.
    }


    function renderTabGrid(tabs) {
        return ` ${ tabs.map( tab => renderTabBox(tab) ).join("\n") } `;
    }

    // Unsafe text of the tab are not rendered.  Caller needs to call refreshTabsAttributes() later to fill in the unsafe text.
    function renderTabBox(tab) {
        let c = containerById[tab.cookieStoreId];
        let isPrivate = is_firefox_private(tab.cookieStoreId);
        let isContainer = is_real_container(tab.cookieStoreId);

        // Note that the unsafe text of a tab's url are left out, and will be filled in later, in below.
        // The outer div has its tabindex set to 2 to receive the tab focus event.  The search box has tabindex=1.
        return `
            <div class="tab-box ${css_tabbox(isPrivate)}" id="tid-${tab.id}" data-tid="${tab.id}" tabindex="2">

              <div class="tab-topbar ${isDraggable(tab) ? 'draggable-item' : ''}" title="Drag the top bar to start drag and drop on the thumbnail.">
                <div class="tab-title" title="TAB-TITLE">TAB-TITLE</div>
              </div>

              <div class="tab-topbar-cmds">
                <a href="#" class="btn cmd-close-tab" title="Close the tab" tabindex="-1"><i class="icon icon-cross"></i></a>
              </div>

              <div class="tab-topbar-selection">
                <a href="#" class="btn cmd-select-tab" title="select the tab" tabindex="-1"><i class="icon icon-check"></i></a>
              </div>

              <div class="dropdown dropdown-right tab-topbar-menu" >
                <div class="btn-group">
                  <a href="#" class="btn dropdown-toggle tab-menu-dropdown" tabindex="-1"><i class="icon icon-caret"></i></a>
                  <ul class="menu" style="min-width: 6rem; margin-top: -2px;">
                    <li class="menu-item"> <a href="#" class="cmd-reload-tab    nowrap">Reload Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-toggle-muted  nowrap">Mute/Unmute Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-toggle-pinned nowrap">Pin/Unpin Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-toggle-hidden nowrap">Show/Hide Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-discard-tab   nowrap">Discard Tab</a> </li>
                    <li class="divider"></li>
                    <li class="menu-item"> <a href="#" class="cmd-duplicate-tab nowrap">Duplicate Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-move-tab-new  nowrap">To New Window</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-copy-tab-url  nowrap">Copy URL</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-save-tab-img  nowrap">Save Image</a> </li>
                    <li class="divider   ${is_by_window() ? 'd-block' : 'd-none'}"></li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-others nowrap">Close Other Tabs</a> </li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-left nowrap">Close Left Tabs</a> </li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-right nowrap">Close Right Tabs</a> </li>
                  </ul>
                </div>
              </div>

              <div class="tab-thumbnail" style="border-color: ${c.colorCode}; ${box_shadow_private(tab.incognito)}; ">
                <img class="tab-img">
              </div>

              <div class="tab-status-bar">
                <a href="#" class="btn status-private"      tabindex="-1" title="Tab is in a private window"><img src="icons/eyepatch.png" ></a>
                <a href="#" class="btn status-container"    tabindex="-1" title="CONTAINER-NAME" style="background: ${c.colorCode}"><img src="${c.iconUrl}"></a>
                <a href="#" class="btn status-muted"        tabindex="-1" title="Tab is muted" ><img src="icons/mute-muted.png"     ></a>
                <a href="#" class="btn status-audible"      tabindex="-1" title="Tab is playing sound"><img src="icons/audible.png" ></a>
                <a href="#" class="btn status-pinned"       tabindex="-1" title="Tab is pinned"><img src="icons/pin-unpinned.png"   ></a>
                <a href="#" class="btn status-hidden"       tabindex="-1" title="Tab is hidden"><img src="icons/hide-hidden.png"    ></a>
              </div>

              <div class="tabbox-arc ${ttSettings.thumbnailPopup ? '' : 'hidden'}"></div>
            </div>   
        `;
    }

    // Refresh the UI on all tab's attributes, except thumbnail.  Use html-escaped API to fill in unsafe text of the tab.
    function refreshTabsAttributes(tabs) {
        tabs.forEach(refreshTabAttributes);
    }

    function refreshTabAttributes(tab) {
        refreshTabText(tab);                    // url, title, container name
        refreshTabActiveState(tab);
        refreshTabMenu(tab);
        refreshTabStatusBar(tab);
    }
    
    // Use html-escaped API to fill in unsafe text of the tab.
    function refreshTabText(tab) {
        let $tab = $tabbox(tab.id);
        $tab.find(".tab-title").attr("title", tab.title).text(tab.title);
        $tab.find(".status-container").attr("title", "Container: " + containerById[tab.cookieStoreId].name);
        //$tab.find(".tab-url").attr("href", tab.url).attr("title", tab.title).text(tab.title);
    }

    function refreshTabActiveState(tab) {
        let $tab = $tabbox(tab.id);
        $tab.find(".tab-title").removeClass("bold").addClass(isTabActive(tab) ? "bold" : "");
    }

    function refreshTabMenu(tab) {
        let $tab = $tabbox(tab.id);
        $tab.find(".cmd-toggle-pinned"  ).text((tab.pinned   ? "Unpin" : "Pin") + " Tab");
        $tab.find(".cmd-toggle-muted"   ).text((isMuted(tab) ? "Unmute" : "Mute") + " Tab");
        $tab.find(".cmd-toggle-hidden"  ).text((tab.hidden   ? "Show" : "Hide") + " Tab").removeClass("disabled").addClass(tab.active ? "disabled" : "");
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
            $statusbar.find(".status-pinned").removeClass("d-none").addClass("d-block");
        } else {
            $statusbar.find(".status-pinned").removeClass("d-block").addClass("d-none");
        }

        if (isMuted(tab)) {
            $statusbar.find(".status-muted").removeClass("d-none").addClass("d-block");
        } else {
            $statusbar.find(".status-muted").removeClass("d-block").addClass("d-none");
        }

        if (tab.audible) {
            $statusbar.find(".status-audible").removeClass("d-none").addClass("d-block blink-yellow");
        } else {
            $statusbar.find(".status-audible").removeClass("d-block blink-yellow").addClass("d-none");
        }

        if (tab.hidden) {
            $statusbar.find(".status-hidden").removeClass("d-none").addClass("d-block");
        } else {
            $statusbar.find(".status-hidden").removeClass("d-block").addClass("d-none");
        }
    }

    const CAPTURE_OPTS = { format: "jpeg", quality: 50 };

    function refreshThumbnail(tid, forceRefreshImg) {
        if (thumbnailsCapturing[tid])
            return;

        if (thumbnailsMap[tid] && !forceRefreshImg) {
            // For other redrawing cases, use the image cached in memory.
            renderThumbnail(tid);
        } else {
            let tab = tabById[tid];
            if (tab.discarded) {
                db.pGetTabImage(tab.url).then( record => {
                    if (record) {
                        thumbnailsMap[tid] = record.image;
                        renderThumbnail(tid);
                    } else {
                        pCaptureTab(tid).then( () => renderThumbnail(tid) );
                    }
                });
            } else {
                pCaptureTab(tid).then( () => renderThumbnail(tid) );
            }
        }
    }

    function pCaptureTab(tid) {
        thumbnailsCapturing[tid] = true;
        return browser.tabs.captureTab(tid, CAPTURE_OPTS).then( thumbnail => {
            thumbnailsMap[tid] = thumbnail;
            thumbnailsCapturing[tid] = false;
            db.pSaveTabImage(tabById[tid].url, thumbnail).catch( e => {
                log.error("db.pSaveTabImage error: ", e);
            });
        }).catch( e => {
            log.error("captureTab error: ", e);
            thumbnailsCapturing[tid] = false;
        });
    }

    function $tabimg(tid) {
        return $tabbox(tid).find("img.tab-img");
    }

    function renderThumbnail(tid) {
        let thumbnail = thumbnailsMap[tid];
        $tabimg(tid).attr("src", thumbnail);
    }


    function stopEvent(e)                       { e.preventDefault(); return false }
    function box_shadow_private(isPrivate)      { return isPrivate ? "box-shadow: 0 0 .4rem -.02rem rgba(0, 0, 0, 0.75);" : "" }
    function box_shadow_active(isActive)        { return isActive  ? "box-shadow: 0 0 .4rem -.02rem rgba(239, 196, 40, 1.00);" : "" }
    function border_color_private(isPrivate)    { return isPrivate ? "border-color: " + COLOR_PRIVATE + ";" : "" }
    function css_tabbox(isPrivate)              { return (isPrivate ? " droppable-private " : " droppable-normal ") + (dragSelectionMode ? " selecting " : "") }

    function showErrorMsg(msg) {
        $(".error-display").show();
        $(".error-msg").text(msg);
    }

    function hideErrorMsg() {
        $(".error-display").hide();
        $(".error-msg").text("");
    }
    
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

    function toggleDragMode() {
        dragSelectionMode = !dragSelectionMode;
        refreshHeaderControls();
        if (dragSelectionMode) {
            $(".tab-box").addClass("selecting");
        } else {
            $(".tab-box").removeClass("selecting").removeClass("selected");
        }
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
        }
    }

    function setupDragAndDropForDT_Window() {
        effectiveTabIds.forEach( tid => {
            let tab = tabById[tid];
            let $tb = $tabbox(tid);

            if (tab.pinned || $tb.hasClass("draggabled-item"))
                return;

            $tb.draggable({
                revert:         "invalid",          // revert only if dropped at outside of target dropzone
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
                    $(".tab-box.droppabled-zone").droppable("destroy").removeClass("droppabled-zone");
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
                        create:     function(event, ui){ $(this).addClass("droppabled-zone") },
                        drop:       function(event, ui){ pDropInTheContainer($(this), event, ui) },
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
                create:     function(event, ui){ $(this).addClass("droppabled-zone") },
                drop:       function(event, ui){ pDropInFrontOfTabInWindow($(this), event, ui) },
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
                create:     function(event, ui){ $(this).addClass("droppabled-zone") },
                drop:       function(event, ui){ pDropInFrontOfTabInWindow($(this), event, ui) },
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
                create:     function(event, ui){ $(this).addClass("droppabled-zone") },
                drop:       function(event, ui){ pDropAtTheEndInWindow($(this), event, ui) },
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

    async function pDropInFrontOfTabInWindow($dest, event, ui) {
        let srcTid      = ui.draggable.data("tid");
        let destTid     = $dest.data("tid");

        if (dragSelectionMode) {
            let srcTids = $(".tab-box.selected").map( (i, elm) => $(elm).data("tid") ).get();
            if (srcTids.indexOf(srcTid) < 0)
                srcTids.unshift(srcTid);
            toggleDragMode();
            return Promise.all(srcTids.map( srcTid => pDropSrcTabInFrontOfTabInWindow(srcTid, destTid) ));
        } else {
            return pDropSrcTabInFrontOfTabInWindow(srcTid, destTid);
        }
    }
    
    function pDropSrcTabInFrontOfTabInWindow(srcTid, destTid) {
        let srcTab      = tabById[srcTid];
        let destTab     = tabById[destTid];
        let srcIdx      = tabIdsByWid[srcTab.windowId].findIndex( tid => tid == srcTab.id );
        let destIdx     = tabIdsByWid[destTab.windowId].findIndex( tid => tid == destTab.id );
        let $srcTabBox  = $tabbox(srcTab.id);
        let $destTabBox = $tabbox(destTab.id);
        let srcPrivate  = is_firefox_private(tabById[srcTab.id].cookieStoreId);
        let destPrivate = is_firefox_private(tabById[destTab.id].cookieStoreId);
        let sameDomain  = srcPrivate == destPrivate;
        if (sameDomain) {
            // Move the tab in front of the destination tab.
            let sameWin = srcTab.windowId == destTab.windowId;
            if (sameWin && srcIdx < destIdx) {
                destIdx--;      // Src and dest tabs on the same window, and src tab is before dest, decrement index by 1 since the src tab will be removed.
            }
            return browser.tabs.move(srcTab.id, { windowId: destTab.windowId, index: destIdx}).then( movedTabs => {
                if (movedTabs && movedTabs.length > 0 && (!sameWin || srcIdx != movedTabs[0].index)) {
                    moveTabDataToWindow(srcTab, destTab.windowId, destIdx);

                    $srcTabBox.detach();
                    $srcTabBox.css({"top":"", "left":""});      // reset dragging position.
                    $srcTabBox.insertBefore($destTabBox);
                    let toWidth = $srcTabBox.width();
                    $srcTabBox.width(0).animate({ width: toWidth }, 500).effect( "bounce", {times:2, distance:5}, 200 );
                } else {
                    $srcTabBox.removeAttr("style");
                }
                return Promise.resolve();
            });
        } else {
            // Copy the tab in front of the destination tab.
            return pOpenInWindow(srcTab, destTab.windowId, destIdx).then( () => $srcTabBox.removeAttr("style") );
        }
    }                                   

    async function pDropAtTheEndInWindow($dest, event, ui) {
        let srcTid      = ui.draggable.data("tid");     // the directly dragged src tab
        let destWid     = $dest.data("wid");            // data-wid on .drop-end-zone.

        if (dragSelectionMode) {
            let srcTids = $(".tab-box.selected").map( (i, elm) => $(elm).data("tid") ).get();
            if (srcTids.indexOf(srcTid) < 0)
                srcTids.unshift(srcTid);
            toggleDragMode();
            return Promise.all(srcTids.map( srcTid => pDropSrcTabAtTheEndInWindow(srcTid, destWid, event) ));
        } else {
            return pDropSrcTabAtTheEndInWindow(srcTid, destWid, event);
        }
    }
    
    function pDropSrcTabAtTheEndInWindow(srcTid, destWid, event) {
        let srcTab      = tabById[srcTid];
        let $srcTabBox  = $tabbox(srcTab.id);
        let sameWin     = srcTab.windowId == destWid;
        let srcPrivate  = is_firefox_private(tabById[srcTab.id].cookieStoreId);
        let destPrivate = windowById[destWid].incognito;
        let sameDomain  = srcPrivate == destPrivate;
        
        if (sameDomain) {
            // Move the tab to the end of th window
            return browser.tabs.move(srcTab.id, { windowId: destWid, index: -1}).then( movedTabs => {
                if (movedTabs && movedTabs.length > 0 && (!sameWin || srcTab.index != movedTabs[0].index)) {
                    moveTabDataToWindow(srcTab, destWid);
                    $srcTabBox.detach();
                    $srcTabBox.css({ top:"", left:"" });                    // reset the dragging position
                    $(".window-lane[data-wid='" + destWid + "'] .tab-grid").append($srcTabBox);
                    $srcTabBox.offset({left: event.pageX})                  // move tabox to drop's X location
                        .animate({ left: 0 }, 400)                          // slide back to its final location
                        .effect( "bounce", {times:2, distance:5}, 200 );    // bounce a bit at the end
                } else {
                    $srcTabBox.removeAttr("style");
                }
                return Promise.resolve();
            });
        } else {
            // Copy the tab to the end of th window
            return pOpenInWindow(srcTab, destWid, null).then( () => $srcTabBox.removeAttr("style") );
        }
    }

    function moveTabDataToWindow(srcTab, destWid, destIdx) {
        let srcIdx = tabIdsByWid[srcTab.windowId].findIndex( tid => tid == srcTab.id );
        tabIdsByWid[srcTab.windowId].splice(srcIdx, 1);             // remove the moved tabId from source array
        if (destIdx) {
            // Move srcTab to just in front of position destIdx in destWid window lane.
            tabIdsByWid[destWid].splice(destIdx, 0, srcTab.id);
        } else {
            // Move srcTab to the end of the window lane.
            tabIdsByWid[destWid].push(srcTab.id);
        }

        orderTabIndex(srcTab.windowId);
        if (destWid != srcTab.windowId)
            orderTabIndex(destWid);
        srcTab.windowId = destWid;
    }            
    

    // Need to do blocking wait until tabs.create() finish before finishing up the drop operation.
    async function pDropInTheContainer($dest, event, ui) {
        let srcTid      = ui.draggable.data("tid");     // the directly dragged src tab
        let destCid     = $dest.data("cid");            // data-cid on .drop-end-zone.
        let srcTids;

        if (dragSelectionMode) {
            // tabbox in container is cloned when dragged; use .ui-draggable-dragging to filter out the clone and get the original.
            srcTids = $(".tab-box.selected:not(.ui-draggable-dragging)").map( (i, elm) => $(elm).data("tid") ).get();
            if (srcTids.indexOf(srcTid) < 0)
                srcTids.unshift(srcTid);
            toggleDragMode();
        } else {
            srcTids = [ srcTid ];
        }

        let destWids    = getDestContainerWindowIds(srcTids, destCid);
        let needNewDest = destWids.some( wid => wid == null );
        let newWidInfo  = { windowId: null, isNew: false };

        if (needNewDest) {
            newWidInfo  = await pFindOrCreateContainerWindowId(destCid);    // pick the first window with the container or create one.
        }

        for (let i = 0; i < srcTids.length; i++) {
            await pDropSrcTabInTheContainer(srcTids[i], destCid, destWids[i] == null ? newWidInfo.windowId : destWids[i]);
        }

        if (newWidInfo.isNew) {
            await pCloseFirstBlankPrivateTab(newWidInfo.windowId);
        }
    }

    function getDestContainerWindowIds(srcTids, destCid) {
        return toTabs(srcTids).map( srcTab => {
            let srcPrivate  = is_firefox_private(srcTab.cookieStoreId);
            let destPrivate = is_firefox_private(destCid);
            if (srcPrivate) {
                if (destPrivate) {
                    return null;            // src and dest are private; dest window needs to be private.
                } else {
                    return null;            // src is private and dest is not; dest window is unknown.
                }
            } else {
                if (destPrivate) {
                    return null;            // src is not private and dest is private; dest window should be private.
                } else {
                    return srcTab.windowId; // both src and dest containers are not private; use the src's window.
                }
            }
        });
    }

    function pDropSrcTabInTheContainer(srcTid, destCid, destWid) {
        let srcTab      = tabById[srcTid];
        let srcPrivate  = is_firefox_private(srcTab.cookieStoreId);
        let destPrivate = is_firefox_private(destCid);

        if (srcPrivate) {
            if (destPrivate) {
                return pOpenInPrivateWindow(srcTab, destWid);       // the drop target is a container; the target window is unknown.
            } else {
                return pOpenInContainer(srcTab, destCid, destWid);  // src is private and dest is not private; the target window is unknown.
            }
        } else {
            if (destPrivate) {
                return pOpenInPrivateWindow(srcTab, destWid);       // the drop target is a container; the target window is unknown.
            } else {
                return pOpenInContainer(srcTab, destCid, destWid);
            }
        }
    }

    async function pOpenInPrivateWindow(srcTab, destWid) {
        if (!destWid) {
            let wndInfo = await pFindOrCreatePrivateWindow(false);
            destWid = wndInfo.window.id;
        }
        return browser.tabs.create({
            active:         true,
            windowId:       destWid,
            pinned:         srcTab.pinned,
            url:            srcTab.url,
        });
        // Rely on tabs.onUpdated to add the newly created tab when the tab.url and tab.title are completely filled in.
    }

    function pOpenInWindow(srcTab, destWid, destIndex) {
        return browser.tabs.create({
            active:         true,
            windowId:       destWid,
            index:          destIndex,
            pinned:         srcTab.pinned,
            url:            srcTab.url,
        }).then( newTab => {
            createTabDataAsNeeded(newTab);
            renderNewTab(newTab);

            let $newTabBox = $tabbox(newTab.id);
            let toWidth = $newTabBox.width();
            $tabbox(newTab.id).width(0).animate({ width: toWidth }, 500).effect( "bounce", {times:2, distance:5}, 200 );
        }).then( () => pRefocusTiptap() );
        // Rely on tabs.onUpdated to add the newly created tab when the tab.url and tab.title are completely filled in.
    }

    async function pOpenInContainer(srcTab, destCid, destWid) {
        if (!destWid) {
            let widInfo = await pFindOrCreateContainerWindowId(destCid);    // pick the first window with the container or create one.
            destWid = widInfo.windowId;
        }
        return browser.tabs.create({
            active:         true,
            windowId:       destWid,
            cookieStoreId:  destCid,
            pinned:         srcTab.pinned,
            url:            srcTab.url,
        }).then(() => pRefocusTiptap());
        // Rely on tabs.onUpdated to add the newly created tab when the tab.url and tab.title are completely filled in.
    }

    async function pFindOrCreateContainerWindowId(cid) {
        let containerIsPrivate = is_firefox_private(cid);
        if (containerIsPrivate) {
            let wndInfo = await pFindOrCreatePrivateWindow(false);
            return { windowId: wndInfo.window.id, isNew: wndInfo.isNew };
        } else {
            return browser.tabs.query({}).then( tabs => {
                let tabInTheContainer = tabs.find( tab => tab.cookieStoreId == cid );
                if (tabInTheContainer) {
                    return { windowId: tabInTheContainer.windowId, isNew: false };
                } else {
                    // no window has a tab with the container Id; create a new window.                        
                    return browser.windows.create({}).then( newWindow => {
                        return { windowId: newWindow.id, isNew: true };
                    });
                }
            });
        }
    }

    function pFindOrCreatePrivateWindow(focused) {
        return browser.windows.getAll()
            .then( windows => windows.find( w => w.incognito ) )
            .then( existingPrivateWindow => {
                if (existingPrivateWindow) {
                    return { window: existingPrivateWindow, isNew: false };
                } else {
                    // TODO: Firefox doesn't support 'focused' on window creation.
                    return browser.windows.create({ incognito: true }).then( newWindow => {
                        return { window: newWindow, isNew: true };
                    });
                }
            });
    }

    function pRefocusTiptap() {
        return browser.tabs.update(tiptapTid, { active: true })
            .then( () => browser.windows.update(tiptapWid, {focused: true}) );
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

    function toggleTabStyle() {
        uiState.showTabStyle = ((uiState.showTabStyle || 0) + 1) % 2;       // 0 or 1
        redrawRefreshControls();
        redrawRefreshUIContent(false, false);
        asyncSaveUiStateNow();
    }

    function selectDisplayType(displayType) {
        uiState.displayType = displayType;
        redrawRefreshControls();
        redrawRefreshUIContent(false, false);
        asyncSaveUiStateNow();
        focusSearch();
    }

    // size: 0-2
    function setThumbnailSize(size) {
        uiState.thumbnailSize = size;
        resizeThumbnails();
        asyncSaveUiStateNow();
        focusSearch();
    }

    function resizeThumbnails() {
        setImgDimension(imgWidth[uiState.thumbnailSize], imgHeight[uiState.thumbnailSize]);
        refreshVBtnBarControls();
        redrawRefreshUIContent(false, false);
    }

    function toggleShowEmpty() {
        switch (uiState.displayType) {
        case DT_WINDOW:
            uiState.showEmptyWindows = !uiState.showEmptyWindows;
            redrawRefreshControls();
            redrawRefreshUIContent(false, false);
            asyncSaveUiStateNow();
            break;
        case DT_CONTAINER:
            uiState.showEmptyContainers = !uiState.showEmptyContainers;
            redrawRefreshControls();
            redrawRefreshUIContent(false, false);
            asyncSaveUiStateNow();
            break;
        }
        
    }

    function duplicateTab(tid) {
        browser.tabs.duplicate(tid)
            .then( newTab => {
            }).catch( e => log.warn(e) );
    }

    function reloadTab(tid) {
        browser.tabs.reload(tid);
    }

    function minimizeWindowLane(wid) {
        uiState.windowsMinimized[wid] = Date.now();
        refreshWindowControlsOnLane(wid);
        asyncSaveUiStateNow();
    }

    function restoreWindowLane(wid) {
        delete uiState.windowsMinimized[wid];
        refreshWindowControlsOnLane(wid);
        asyncSaveUiStateNow();
    }

    function minimizeContainerLane(cid) {
        uiState.containersMinimized[cid] = Date.now();
        refreshContainerControlsOnLane(cid);
        asyncSaveUiStateNow();
    }

    function restoreContainerLane(cid) {
        delete uiState.containersMinimized[cid];
        refreshContainerControlsOnLane(cid);
        asyncSaveUiStateNow();
    }

    function toggleMinimize() {
        if (uiState.displayType == DT_WINDOW) {
            let minimizedWids = windowIds.filter( wid => uiState.windowsMinimized[wid] != undefined );
            if (minimizedWids.length > 0) {
                uiState.windowsMinimized = {};
            } else {
                windowIds.forEach( wid => uiState.windowsMinimized[wid] = Date.now() );
            }
            refreshWindowControlsOnLanes();
            asyncSaveUiStateNow();
        } else if (uiState.displayType == DT_CONTAINER) {
            let minimizedCids = containerIds.filter( cid => uiState.containersMinimized[cid] != undefined );
            if (minimizedCids.length > 0) {
                uiState.containersMinimized = {};
            } else {
                containerIds.forEach( cid => uiState.containersMinimized[cid] = Date.now() );
            }
            refreshContainerControlsOnLanes();
            asyncSaveUiStateNow();
        }
    }

    function reloadWindowTabs(wid) {
        let tabs = effectiveWindowTabs(wid);
        tabs.forEach( tab => browser.tabs.reload(tab.id) );
    }

    function reloadContainerTabs(cid) {
        let tabs = effectiveContainerTabs(cid);
        tabs.forEach( tab => browser.tabs.reload(tab.id) );
    }

    function pCreateWindow(incognito, url) {
        return browser.windows.create({ 
            type:       "normal",
            incognito:  incognito,
            url:        url,
        });
    }

    function pCreateWindowTab(wid) {
        return browser.tabs.create({
            active:     true,
            windowId:   wid,
        }).then( tab => activateTab(tab) );
    }

    function createContainerTab(cid) {
        // Find a window of a tab with the existing cid.
        let tabs = toTabs(tabIdsByCid[cid]);
        let existingWid = tabs.length > 0 ? tabs[0].windowId : null;
        if (existingWid) {
            browser.tabs.create({
                active:         true,
                windowId:       existingWid,
                cookieStoreId:  cid,
            }).then( tab => activateTab(tab) );
        } else {
            pCreateWindow(is_firefox_private(cid)).then( w => browser.tabs.create({
                active:         true,
                windowId:       w.id,
                cookieStoreId:  cid,
            }) ).then( tab => activateTab(tab) );
        }
    }

    function groupContainerTab(cid) {
        let tids = app.ensureVal(tabIdsByCid[cid], []);
        if (tids.length > 0) {
            let newWin;
            pCreateWindow(is_firefox_private(cid))
                .then( win  => newWin = win )
                .then( ()   => tabIdsByWid[newWin.id] = tids )
                .then( ()   => tids.forEach( tid => moveTabDataToWindow(tabById[tid], newWin.id) ))
                .then( ()   => Promise.all(tids.map( tid => browser.tabs.move(tid, { windowId: newWin.id, index: -1}) )) )
                .then( ()   => pCloseWindowBlankTabs(newWin.id) )
        }
    }

    function copyWindowTabTitleUrls(wid) {
        let tabs = effectiveWindowTabs(wid)
        let titleUrls = tabs.map( tab => [tab.title, tab.url, ""] );
        let text = [].concat.apply([], titleUrls).join("\n");
        $("#copy-to-clipboard").val(text).select();             // note that .val() can sandbox unsafe text from tab.url and tab.title
        document.execCommand("copy");
    }

    function muteTabs(tids, isMuting) {
        tids.forEach( tid => browser.tabs.update(tid, { muted: isMuting }) );
    }

    function muteWindowTabs(wid, isMuting) {
        muteTabs(effectiveWindowTids(wid), isMuting);
    }

    function showWindowTabs(wid, isShowing) {
        let tids = effectiveWindowTids(wid);
        if (isShowing)
            browser.tabs.show(tids);
        else
            browser.tabs.hide( toTabs(tids).filter( t => !t.active ).map( t => t.id ) );    // active tab cannot be hidden; skip.
    }

    function pinWindowTabs(wid, isPinning) {
        effectiveWindowTids(wid).forEach( tid => browser.tabs.update(tid, { pinned: isPinning }) );
    }

    function pMoveToNewWindow(tid) {
        return browser.windows.create({
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
 
    function pCloseTabs(tabIdsToClose) {
        if (tabIdsToClose && tabIdsToClose.length > 0) {
            removeTabBoxes(tabIdsToClose);
            return browser.tabs.remove(tabIdsToClose);
        } else {
            return Promise.resolve();
        }
    }

    function closeOtherTabs(tid, whichSide) {
        let tab = tabById[tid];
        browser.windows.get(tab.windowId, {
            populate:   true
        }).then( win => {
            let index = win.tabs.findIndex(tab => tab.id == tid);
            let tabs = whichSide == "all" ? win.tabs : whichSide == "left" ? win.tabs.slice(0, index) : win.tabs.slice(index + 1);
            pCloseTabs( tabs.filter( tab => tab.id != tid && !is_tiptaburl(tab.url) ).map( tab => tab.id ) );
        });
    }

    function pCloseWindowTabs(wid) {
        return pCloseTabs(tabIdsByWid[wid]);
    }

    function pCloseWindowBlankTabs(wid) {
        return browser.tabs.query({windowId: wid})
            .then( tabs => tabs.filter( tab => tab.url == "about:newtab" || tab.url == "about:blank" || tab.url == "about:privatebrowsing" ) )
            .then( tabs => pCloseTabs(toTabIds(tabs) ) );
    }

    function pCloseFirstBlankPrivateTab(wid) {
        return browser.windows.get(wid, { populate: true }).then( wndInfo => {
            if (wndInfo.tabs.length < 2)
                return;
            // Note: browser.windows.get is not reliable in getting the tab's url and title, which can come in much later.
            let firstTab = wndInfo.tabs[0];
            if (firstTab.url == "about:privatebrowsing")
                return;
            return pCloseTabs([firstTab.id]);
        });
    }

    function closeContainerTab(cid) {
        pCloseTabs(tabIdsByCid[cid]);
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

    // All the tab attribute toggling let tabs_onUpdated() to update the in-memory data structure and refresh tab UI.
    
    function toggleTabProperty(tid, property) {
        browser.tabs.get(tid).then( tab => {
            let updateProp = {};
            updateProp[property] = !tab[property];
            browser.tabs.update(tab.id, updateProp);
        });
    }

    function toggleTabMuted(tid) {
        browser.tabs.get(tid).then( tab => browser.tabs.update(tab.id, { muted: !isMuted(tab) }) );
    }

    function toggleTabHidden(tid) {
        browser.tabs.get(tid).then( tab => {
            if (tab.hidden) {
                browser.tabs.show(tab.id);
            } else {
                if (!tab.active)
                    browser.tabs.hide(tab.id);  // active tab cannot be hidden; skip.
            }
        });
    }

    function discardTab(tid) {
        browser.tabs.discard(tid);
    }

    function toggleTabPinned(tid) {
        browser.tabs.get(tid).then( tab => browser.tabs.update(tab.id, { pinned: !tab.pinned }) );
    }


    function toggleFilterByStatus(fieldNameOfFilterBy) {
        uiState[fieldNameOfFilterBy] = ((uiState[fieldNameOfFilterBy] || 0) + 1) % 2;       // 0 or 1
        asyncSaveUiStateNow();
        refreshHeaderControls();
        refreshFooterControls();
        redrawRefreshContentOnFiltering();
    }

    function pEnsureTipTabPageInFront(ttWinHasFocus, ttTabIsActive) {
        if (ttWinHasFocus) {
            if (ttTabIsActive) {
                return Promise.resolve();
            } else {
                return browser.tabs.update(tiptapTid, {active: true});
            }
        } else {
            if (ttTabIsActive) {
                return browser.windows.update(tiptapWid, {focused: true});
            } else {
                return pRefocusTiptap();
            }
        }
    }

    function restoreFocus(bSelectSearchText) {
        // log.info("restoreFocus previousFocusedTid: " + previousFocusedTid);
        if (previousFocusedTid) {
            $tabbox(previousFocusedTid).focus();
        } else {
            focusSearch(bSelectSearchText);     // no previous focused tab-box, focus the search field instead.
        }
    }

    function focusSearch(bSelect) {
        // log.info("focusSearch");
        // Put the focus in the search field so that the custom hotkey can work.
        if (bSelect)
            $(".cmd-search").focus().select();
        else
            $(".cmd-search").focus();
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

    function onThumbnailClicked(e) {
        let $tbox = $(this).closest(".tab-box");
        if (dragSelectionMode) {
            $tbox.toggleClass("selected");
        } else {
            activateTid($tbox.data("tid"));
        }
        return stopEvent(e);
    }
    
    function activateTid(tid) {
        let tab = tabById[tid];
        tiptabWindowActive = false;
        closeOverlay();
        activateTab(tab);
    }

    function activateTab(tab) {
        if (!tab)
            return;                     // tab could have been closed.
        previousFocusedTid = tab.id;
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
            asyncSaveUiStateNow();   // cleared search text needs to be saved now to have a better user experience.
        } else {
            dSaveUiState();
        }
        redrawRefreshContentOnFiltering();
    }

    function toggleSearchSaving() {
        if (searchSavingMode) {
            // stop searchSaving
            endSearchSaving();
        } else {
            // start searchSaving
            searchSavingMode = true;
            oldSavedSearch = uiState.savedSearch.slice();       // clone existing savedSearch for undo.
            showSavedSearchButtonsForSaving();
            $(".cmd-search-save").attr("title", "Done saving search");
            $(".cmd-search-save i").removeClass("icon-link").addClass("icon-check");
            $(".cmd-search-save-undo").removeClass("invisible");
        }
    }

    function undoSearchSaving() {
        if (oldSavedSearch) {
            uiState.savedSearch = oldSavedSearch;
            asyncSaveUiStateNow();
        }
        endSearchSaving();
    }

    function endSearchSaving() {
        searchSavingMode = false;
        oldSavedSearch = null;
        redrawSavedSearches();
        $(".cmd-search-save i").removeClass("icon-check").addClass("icon-link");
        $(".cmd-search-save-undo").addClass("invisible");
    }
 
    function handleSavedSearch($btn) {
        let index = $btn.index();
        if (searchSavingMode) {
            uiState.savedSearch[index] = $(".cmd-search").val();    // save the search right the way.
            dSaveUiState();
            $btn.text(uiState.savedSearch[index]);
        } else {
            let txt = uiState.savedSearch[index] || "";
            $(".cmd-search").val(txt).select();
            searchTabs(txt);
        }        
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
        let hotkeys  = (ttSettings.appHotKey || "Ctrl+Shift+L") +  ", " + (ttSettings.searchHotKey || "Ctrl+Shift+F");
        let tooltip  = manifest.name + " (" + hotkeys + ")";
        browser.browserAction.setTitle({ title: tooltip });
    }

    function toggleTheme() {
        uiState.theme = ui.nextTheme(uiState.theme);
        dSaveUiState();
        applyTheme();
        refreshGlobalCmds();
    }

    function applyTheme() {
        // document.documentElement.setAttribute("theme", uiState.theme);
        ui.applyThemeCssVars(uiState.theme);
    }


    log.info("module loaded");
    return module;

}());

export default the_module;


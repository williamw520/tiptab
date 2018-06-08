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

    const tiptabUrl = browser.extension.getURL("tiptab.html");
    function is_tiptaburl(url) { return url.startsWith(tiptabUrl) };    // sometimes # is added to the end of the url; just check prefix.

    // Display types
    const DT_ALL_TABS = "all-tabs";
    const DT_BY_WINDOW = "by-window";
    const DT_BY_CONTAINER = "by-container";
    const DT_ALL_WINDOWS = "all-windows"
    const displayTypes = [DT_ALL_TABS, DT_BY_WINDOW, DT_BY_CONTAINER, DT_ALL_WINDOWS];
    function is_all_tabs()      { return uiState.displayType == DT_ALL_TABS }
    function is_by_window()     { return uiState.displayType == DT_BY_WINDOW }
    function is_by_container()  { return uiState.displayType == DT_BY_CONTAINER }
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

    // Colors
    const COLOR_DEFAULT = "#c7c9cd";
    const COLOR_PRIVATE = "#8D20AE";    // purple

    // Dimensions for thumbnailSize
    const imgWidth  = ["8.0rem", "11.5rem", "15rem"];
    const imgHeight = ["4.5rem", "6.46875rem",  "8.4375rem"];

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
    let containersById = {};
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
            .then(() => reloadAndRefreshTabs())
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
        uiState.thumbnailSize = state.thumbnailSize || 0;

        return uiState;
    }

    function setupDOMListeners() {
        log.info("setupDOMListeners");

        // Dialog setup
        dlg.setupDlg("#about-dlg", true);

        // Global menu at the top navbar
        $("#global-cmds").on("click", ".cmd-refresh",   reloadAndRefreshTabs);
        $("#global-cmds").on("click", ".cmd-close-ui",  function(){ pSendCmd({ cmd: "close-ui" }) });
        $(".logo").on("click", function() {
            let manifest = browser.runtime.getManifest();
            dlg.openDlg("#about-dlg",
                        {
                            ".app-name":    manifest.name,
                            ".app-version": manifest.version,
                            ".app-author":  manifest.author,
                        },
                        {},
                        ".modal-submit");
        });

        // Commands on v-btn-bar
        $(".v-btn-bar").on("click", ".cmd-all-tabs",            function(){ selectDisplayType(DT_ALL_TABS)      });
        $(".v-btn-bar").on("click", ".cmd-by-window",           function(){ selectDisplayType(DT_BY_WINDOW)     });
        $(".v-btn-bar").on("click", ".cmd-by-container",        function(){ selectDisplayType(DT_BY_CONTAINER)  });
        $(".v-btn-bar").on("click", ".cmd-all-windows",         function(){ selectDisplayType(DT_ALL_WINDOWS)   });
        $(".v-btn-bar").on("click", ".cmd-small-size",          function(){ setThumbnailSize(0)                 });
        $(".v-btn-bar").on("click", ".cmd-medium-size",         function(){ setThumbnailSize(1)                 });
        $(".v-btn-bar").on("click", ".cmd-large-size",          function(){ setThumbnailSize(2)                 });

        // Window command handlers
        $("#main-content").on("click", ".cmd-reload-tabs",      function(){ reloadWindowTabs($(this).closest(".window-lane").data("wid"))           });
        $("#main-content").on("click", ".cmd-copy-titles-urls", function(){ copyWindowTabTitleUrls($(this).closest(".window-lane").data("wid"))     });
        $("#main-content").on("click", ".cmd-undo-close",       function(){ undoCloseTab()                                                          });
        $("#main-content").on("click", ".cmd-mute-all",         function(){ muteWindowTabs($(this).closest(".window-lane").data("wid"), true)       });
        $("#main-content").on("click", ".cmd-unmute-all",       function(){ muteWindowTabs($(this).closest(".window-lane").data("wid"), false)      });
        $("#main-content").on("click", ".cmd-pin-all",          function(){ pinWindowTabs($(this).closest(".window-lane").data("wid"), true)        });
        $("#main-content").on("click", ".cmd-unpin-all",        function(){ pinWindowTabs($(this).closest(".window-lane").data("wid"), false)       });

        // Tab command handlers
        $("#main-content").on("click", ".cmd-close-tab",        function(){ closeTab($(this).closest(".tab-box").data("tid"))                       });
        $("#main-content").on("click", ".cmd-reload-tab",       function(){ reloadTab($(this).closest(".tab-box").data("tid"))                      });
        $("#main-content").on("click", ".cmd-duplicate-tab",    function(){ duplicateTab($(this).closest(".tab-box").data("tid"))                   });
        $("#main-content").on("click", ".cmd-move-tab-new",     function(){ moveTabToNewWindow($(this).closest(".tab-box").data("tid"), false)      });
        $("#main-content").on("click", ".cmd-copy-tab-url",     function(){ copyTabUrl($(this).closest(".tab-box").data("tid"))                     });
        $("#main-content").on("click", ".cmd-close-others",     function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "all")          });
        $("#main-content").on("click", ".cmd-close-left",       function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "left")         });
        $("#main-content").on("click", ".cmd-close-right",      function(){ closeOtherTabs($(this).closest(".tab-box").data("tid"), "right")        });
        $("#main-content").on("click", ".cmd-toggle-pinned",    function(){ toggleTabProperty($(this).closest(".tab-box").data("tid"), "pinned")    });
        $("#main-content").on("click", ".cmd-toggle-muted",     function(){ toggleTabMuted($(this).closest(".tab-box").data("tid"))                 });

        $("#main-content").on("click", ".cmd-private-window",   function(e){ return stopEvent(e) });
        $("#main-content").on("click", ".cmd-pin-tab",          function(e){ return stopEvent(e) });
        $("#main-content").on("click", ".cmd-mute-tab",         function(e){ return stopEvent(e) });

        // Events on tab thumbnails
        $("#main-content").on("click", ".tab-thumbnail", function(e){
            let tid = $(this).closest(".tab-box").data("tid");
            activateTab(tabsById[tid].windowId, tid);
            return stopEvent(e);
        });

        // Events on the window lane
        $("#main-content").on("click", ".window-lane", function(){
            activateWindow($(this).data("wid"));
        });

        // Search handler
        $(".cmd-search").on("click", function(){
            $(this).select();
        });
        $(".cmd-search").on("keyup paste", function(){
            uiState.searchTerms = $(this).val().split(" ");
            dSaveUiState();
            refreshUIContent(false, false);
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

    function generateUILayout() {
    }

    function refreshStaticUI() {
        log.info("refreshStaticUI");

        setImgDimension(imgWidth[uiState.thumbnailSize], imgHeight[uiState.thumbnailSize]);

        $(".cmd-search").val(uiState.searchTerms.join(" ")).focus().select();
    }
    
    function refreshControls() {
        log.info("refreshControls");
        refreshVBtnBarControls();
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

    function reloadAndRefreshTabs() {
        browser.tabs.query({})
            .then( tabs => {
                allTabs = tabs.filter( tab => !is_tiptaburl(tab.url) );     // get rid of the TipTab tab.
                tabsById = allTabs.reduce( (map, tab) => { map[tab.id] = tab; return map }, {} );
            }).then( () => {
                let uniqueWinIds = new Set(allTabs.map( tab => tab.windowId ));
                let winIds = [...uniqueWinIds];
                tabsByWindow = winIds.reduce( (map, wid) => { map[wid] = []; return map }, {} );
                allTabs.forEach( tab => tabsByWindow[tab.windowId].push(tab) );
                return Promise.all( winIds.map( wid => browser.windows.get(wid) ));
            }).then( windowArray => {
                windows = windowArray;
                windowsById = windows.reduce((map, win) => { map[win.id] = win; return map }, {});
            }).then( () => {
                let uniqueContainerId = new Set(allTabs.map( tab => tab.cookieStoreId ));
                let containerIds = [...uniqueContainerId];
                tabsByContainer = containerIds.reduce( (map, wid) => { map[wid] = []; return map }, {} );
                allTabs.filter( tab => tab.cookieStoreId ).forEach( tab => tabsByContainer[tab.cookieStoreId].push(tab) );
                return Promise.all( containerIds.map( cid => pGetContainerInfo(cid) ));
            }).then( contextualIdentities => {
                containers = contextualIdentities;
                containersById = containers.reduce((map, c) => { map[c.cookieStoreId] = c; return map }, {});
            }).then( () => refreshUIContent(true, true) )
    }

    function pGetContainerInfo(cid) {
        // Get the container info.  Return a fake one in case not found.
        return browser.contextualIdentities.get(cid)
            .catch( e => {
                //log.error("cid not found " + cid, e);
                switch (cid) {
                case CT_FIREFOX_DEFAULT:
                    return {
                        cookieStoreId:  cid,
                        name:           "(default container)",
                        colorCode:      COLOR_DEFAULT,
                        iconUrl:        "",
                    };
                case CT_FIREFOX_PRIVATE:
                    return {
                        cookieStoreId:  cid,
                        name:           "Private Browsing",
                        colorCode:      COLOR_PRIVATE,
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

    function filterTab(tab, filterTokens) {
        let titleMatched = app.hasAll(tab.title, filterTokens, true);
        let urlMatched = app.hasAll(tab.url, filterTokens, true);
        return titleMatched || urlMatched;
    }

    function filterTabs() {
        let filterTokens = app.toLower(uiState.searchTerms);
        return allTabs.filter( tab => filterTab(tab, filterTokens) );
    }

    function refreshUIContent(forceRefresh, zoomOut) {
        let effectiveTabs = filterTabs();
        let effectiveTids = new Set(effectiveTabs.map( tab => tab.id ));

        if (effectiveTids.size > 0) {
            drawContentLayout();
            $("#empty-content").addClass("hidden");
            $("#main-content" ).removeClass("hidden");  // show the content to force layout calculation; animations in the next step use width and height.
            refreshContent(forceRefresh, zoomOut);
        } else {
            $("#main-content").html("");
            $("#main-content").addClass("hidden");
            $("#empty-content").removeClass("hidden");
        }

    }

    function zoomOutAnimation(effectiveTids) {
        effectiveTids.forEach( tid => {
            let $tabBox = $tabbox(tid);
            let w = $tabBox.width();
            $tabBox.removeClass("d-invisible").width(0).animate( {  width: w }, 500 );
        });
    }

    function drawContentLayout() {
        let $mainContent = $("#main-content");

        switch (uiState.displayType) {
        case DT_ALL_TABS:
            $mainContent.html(renderAllTabLane());
            break;
        case DT_BY_WINDOW:
            $mainContent.html(renderWindowLanes());
            fillWindowText(windows);                        // fill in the unsafe text of the objects using html-escaped API.
            break;
        case DT_BY_CONTAINER:
            $mainContent.html(renderContainerLanes());
            fillContainerText(containers);                  // fill in the unsafe text of the objects using html-escaped API.
            break;
        case DT_ALL_WINDOWS:
            renderAllWindows();
            break;
        default:
            $mainContent.html("Unknown displayType " + uiState.displayType);
            break;
        }
    }
    
    function refreshContent(forceRefresh, zoomOut) {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            refreshAllTabs(forceRefresh, zoomOut);
            break;
        case DT_BY_WINDOW:
            refreshWindows(forceRefresh, zoomOut);
            break;
        case DT_BY_CONTAINER:
            refreshContainers(forceRefresh, zoomOut);
            break;
        case DT_ALL_WINDOWS:
            refreshAllWindows(forceRefresh, zoomOut);
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

    function refreshAllTabs(forceRefresh, zoomOut) {
        let tabsRenderedAsHidden = zoomOut == true;                         // the animation later will show the tab boxes
        let effectiveTabs = filterTabs();
        let html = renderTabGrid(effectiveTabs, tabsRenderedAsHidden);      // unsafe text are left out.
        $(".all-tab-lane .tab-grid").html(html);
        fillTabText(effectiveTabs);                                         // fill in the unsafe text using escaped API.

        let effectiveTids = new Set(effectiveTabs.map( tab => tab.id ));
        effectiveTids.forEach( tid => refreshThumbnail(tid, forceRefresh) );
        if (zoomOut) {
            zoomOutAnimation(effectiveTids);
        }
    }

    function renderWindowLanes() {
        return `
            <div class="content-title">tabs by window</div>
            ${ windows.map( w => `
                <div class="window-lane" data-wid="${w.id}" style="${border_color_private(w.incognito)} ${box_shadow_private(w.incognito)}">
                  <div class="window-topbar" title="Window">
                    <div class="window-title" title="Window">WINDOW-TITLE</div>
                    <div class="dropdown dropdown-right window-topbar-menu" >
                      <div class="btn-group" style="margin:0">
                        <a href="#" class="btn dropdown-toggle window-menu-dropdown" tabindex="0"><i class="icon icon-caret"></i></a>
                        <ul class="menu" style="min-width: 6rem; margin-top: -2px;">
                          <li class="menu-item"> <a href="#" class="cmd-reload-tabs nowrap">Reload All Tabs</a> </li>
                          <li class="menu-item"> <a href="#" class="cmd-undo-close nowrap">Undo Close Tab</a> </li>
                          <li class="menu-item"> <a href="#" class="cmd-copy-titles-urls nowrap">Copy All Titles & Urls</a> </li>
                          <li class="divider"></li>
                          <li class="menu-item"> <a href="#" class="cmd-mute-all nowrap">Mute All Tabs</a> </li>
                          <li class="menu-item"> <a href="#" class="cmd-unmute-all nowrap">Unmute All Tabs</a> </li>
                          <li class="menu-item"> <a href="#" class="cmd-pin-all nowrap">Pin All Tabs</a> </li>
                          <li class="menu-item"> <a href="#" class="cmd-unpin-all nowrap">Unpin All Tabs</a> </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                  <div class="tab-grid"></div>
                </div>
            ` ).join("\n") }
        `;
    }

    // Use html-escaped API to fill in unsafe text.
    function fillWindowText(windows) {
        windows.forEach( w => $(".window-lane[data-wid='" + w.id + "'] .window-title").text(w.title) );
    }

    function refreshWindows(forceRefresh, zoomOut) {
        let tabsRenderedAsHidden = zoomOut == true;                         // the animation later will show the tab boxes
        let effectiveTabs = filterTabs();
        windows.forEach( w => refreshWindowTabs(w, effectiveTabs, tabsRenderedAsHidden) )
        let effectiveTids = new Set(effectiveTabs.map( tab => tab.id ));
        effectiveTids.forEach( tid => refreshThumbnail(tid, forceRefresh) );
        setupDragAndDrop(effectiveTids);
        if (zoomOut) {
            zoomOutAnimation(effectiveTids);
        }
    }

    function refreshWindowTabs(w, effectiveTabs, tabsRenderedAsHidden) {
        let windowTabs = effectiveTabs.filter( tab => tab.windowId == w.id );
        let html = renderTabGrid(windowTabs, tabsRenderedAsHidden);         // unsafe text are left out.
        $(".window-lane[data-wid='" + w.id + "'] .tab-grid").html(html);
        fillTabText(windowTabs);                                            // fill in the unsafe text using escaped API.
    }

    function renderContainerLanes() {
        return `
            <div class="content-title">tabs by container</div>
            ${ containers.map( c => `
                <div class="container-tab-lane" data-cid="${c.cookieStoreId}" style="border: 0.1rem solid ${c.colorCode}; ${box_shadow_private(is_firefox_private(c.cookieStoreId))}">
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
    function fillContainerText(containers) {
        containers.forEach( c => $(".container-tab-lane[data-cid='" + c.cookieStoreId + "'] .container-name").text(c.name) );
    }

    function refreshContainers(forceRefresh, zoomOut) {
        let tabsRenderedAsHidden = zoomOut == true;                         // the animation later will show the tab boxes
        let effectiveTabs = filterTabs();
        containers.forEach( c => refreshContainerTabs(c, effectiveTabs, tabsRenderedAsHidden) )
        let effectiveTids = new Set(effectiveTabs.map( tab => tab.id ));
        effectiveTids.forEach( tid => refreshThumbnail(tid, forceRefresh) );
        if (zoomOut) {
            zoomOutAnimation(effectiveTids);
        }
    }

    function refreshContainerTabs(c, effectiveTabs, tabsRenderedAsHidden) {
        let containerTabs = effectiveTabs.filter( tab => tab.cookieStoreId == c.cookieStoreId );
        let html = renderTabGrid(containerTabs, tabsRenderedAsHidden);      // unsafe text are left out.
        $(".container-tab-lane[data-cid='" + c.cookieStoreId + "'] .tab-grid").html(html);
        fillTabText(containerTabs);                                         // fill in the unsafe text using escaped API.
    }


    function renderAllWindows() {
        return "all windows";
    }

    function refreshAllWindows(forceRefresh, zoomOut) {
    }


    function renderTabGrid(tabs, tabsRenderedAsHidden) {
        return ` ${ tabs.map( tab => renderTabBox(tab, tabsRenderedAsHidden) ).join("\n") } `;
    }

    function renderTabBox(tab, tabsRenderedAsHidden) {
        let borderColorByContainer = containersById[tab.cookieStoreId].colorCode;
        let isPrivate = is_firefox_private(tab.cookieStoreId);

        // Note that the unsafe text of a tab's url are left out, and will be filled in later, in below.
        return `
            <div class="tab-box ${css_droppable_private(isPrivate)} ${tabsRenderedAsHidden ? 'd-invisible' : ''}" id="tid-${tab.id}" data-tid="${tab.id}" >

              <div class="tab-topbar ${css_draggable()}" title="Drag the top bar to start drag and drop on the thumbnail.">
                <div class="tab-title" title="TAB-TITLE">TAB-TITLE</div>
              </div>

              <div class="tab-topbar-cmds">
                <a href="#" class="btn cmd-close-tab" title="Close the tab" tabindex="-1"><i class="icon icon-cross"></i></a>
              </div>

              <div class="dropdown dropdown-right tab-topbar-menu" >
                <div class="btn-group" style="margin:0">
                  <a href="#" class="btn dropdown-toggle tab-menu-dropdown" tabindex="0"><i class="icon icon-caret"></i></a>
                  <ul class="menu" style="min-width: 6rem; margin-top: -2px;">
                    <li class="menu-item"> <a href="#" class="cmd-reload-tab nowrap">Reload Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-toggle-muted nowrap">${isMuted(tab) ? "Unmute" : "Mute"} Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-toggle-pinned nowrap">${tab.pinned ? "Unpin" : "Pin"} Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-duplicate-tab nowrap">Duplicate Tab</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-move-tab-new nowrap">To New Window</a> </li>
                    <li class="menu-item"> <a href="#" class="cmd-copy-tab-url nowrap">Copy URL</a> </li>
                    <li class="divider   ${is_by_window() ? 'd-block' : 'd-none'}"></li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-others nowrap">Close Other Tabs</a> </li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-left nowrap">Close Left Tabs</a> </li>
                    <li class="menu-item ${is_by_window() ? 'd-block' : 'd-none'}"> <a href="#" class="cmd-close-right nowrap">Close Right Tabs</a> </li>
                  </ul>
                </div>
              </div>

              <div class="tab-thumbnail" style="border-color: ${borderColorByContainer}; ${box_shadow_private(tab.incognito)}; ${box_shadow_active(tab.active)}; ">
                <img class="tab-img">
              </div>

              <div class="tab-status-bar">
                <a href="#" class="btn cmd-private-window   ${isPrivate    ? 'd-block' : 'd-none'}" title="Tab is in a private window"><img src="icons/eyepatch.png" ></a>
                <a href="#" class="btn cmd-pin-tab          ${tab.pinned   ? 'd-block' : 'd-none'}" title="Tab is pinned"><img src="icons/pin.png" ></a>
                <a href="#" class="btn cmd-mute-tab         ${isMuted(tab) ? 'd-block' : 'd-none'}" title="Tab is muted"><img src="icons/mute.png" ></a>
              </div>
            </div>   
        `;
    }

    // Use html-escaped API to fill in unsafe text of the tabs.
    function fillTabText(effectiveTabs) {
        effectiveTabs.forEach( tab => $tabbox(tab.id).find(".tab-url").attr("href", tab.url).attr("title", tab.title).text(tab.title) );
        effectiveTabs.forEach( tab => $tabbox(tab.id).find(".tab-title").attr("title", tab.title).text(tab.title) );
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

    function $tabimg(tid) {
        return $tabbox(tid).find("img.tab-img");
    }

    function renderThumbnail(tid, thumbnail) {
        $tabimg(tid).attr("src", thumbnail);
    }

    function stopEvent(e)                       { e.preventDefault(); return false }
    function box_shadow_private(isPrivate)      { return isPrivate ? "box-shadow: 0 0 .4rem -.02rem rgba(0, 0, 0, 0.75);" : "" }
    function box_shadow_active(isActive)        { return isActive  ? "box-shadow: 0 0 .3rem -.02rem rgba(239, 196, 40, 1.00);" : "" }
    function border_color_private(isPrivate)    { return isPrivate ? "border-color: " + COLOR_PRIVATE + ";" : "" }
    function css_draggable()                    { return uiState.displayType == DT_BY_WINDOW ? "tab-draggable" : "" }
    function css_droppable_private(isPrivate)   { return isPrivate ? "droppable-private" : "droppable-normal" }

    function setupDragAndDrop(effectiveTids) {
        switch (uiState.displayType) {
        case DT_ALL_TABS:
            break;
        case DT_BY_WINDOW:
            effectiveTids.forEach( tid => {
                let $elem = $tabbox(tid).draggable({
                    revert:         "invalid",
                    revertDuration: 200,
                    zIndex:         100,
                    handle:         ".tab-draggable",
                    containment:    "#main-content",
                    start:          function(event, ui){
                        enableOverlay = false;
                        addDropTabZones(tid, effectiveTids);
                        addDropEndZones(tid);
                        $(".drop-tab-zone").droppable({
                            accept:     function(draggableUI){
                                let draggableTid = $(draggableUI).data("tid");
                                if (draggableTid) {
                                    let droppableTid = $(this).data("tid");
                                    let isDraggablePrivate = is_firefox_private(tabsById[draggableTid].cookieStoreId);
                                    let isDroppablePrivate = is_firefox_private(tabsById[droppableTid].cookieStoreId);
                                    return isDraggablePrivate == isDroppablePrivate;
                                }
                                return false;
                            },
                            classes:    { "ui-droppable-hover": "drop-hover-gap" },
                            drop:       function(event, ui){ dropInFrontOfTab($(this), ui) },
                        });
                        $(".drop-end-zone").droppable({
                            accept:     function(draggableUI){
                                let draggableTid = $(draggableUI).data("tid");
                                if (draggableTid) {
                                    let droppableWid = $(this).data("wid");
                                    let isDraggablePrivate = is_firefox_private(tabsById[draggableTid].cookieStoreId);
                                    let isDroppablePrivate = windowsById[droppableWid].incognito;
                                    return isDraggablePrivate == isDroppablePrivate;
                                }
                                return false;
                            },
                            classes:    { "ui-droppable-hover": "drop-hover-endzone" },
                            drop:       function(event, ui){ dropAtTheEnd($(this), ui) },
                        });
                    },
                    stop:           function(event, ui){
                        delayEnableOverlay(4000);
                        removeDropTabZones();
                        removeDropEndZones();
                    },
                });
            });

            
            effectiveTids.forEach( tid => {
                let isPrivate = is_firefox_private(tabsById[tid].cookieStoreId);
                $tabbox(tid).droppable({
                    accept:     ".tab-box." + css_droppable_private(isPrivate),
                    classes:    { "ui-droppable-hover": "drop-hover-border" },
                    greedy:     true,
                    drop:       function(event, ui){ dropInFrontOfTab($(this), ui) },
                });
            });

            break;
        case DT_BY_CONTAINER:
            break;
        case DT_ALL_WINDOWS:
            break;
        }
    }

    function addDropTabZones(draggedTid, effectiveTids) {
        let isDraggedPrivate = is_firefox_private(tabsById[draggedTid].cookieStoreId);
        let tabBoxMargin = remToPixels(0.6);        // see .tab-box style

        effectiveTids.forEach( tid => {
            if (draggedTid == tid)
                return;
            let isPrivate   = is_firefox_private(tabsById[tid].cookieStoreId);
            if (isDraggedPrivate != isPrivate)      // prevent dragging across private and normal windows.
                return;
            let $thumbnail  = $tabbox(tid).find(".tab-thumbnail");
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

    function addDropEndZones(draggedTid) {
        let isDraggedPrivate = is_firefox_private(tabsById[draggedTid].cookieStoreId);

        windows.forEach( w => {
            let $winLane    = $(".window-lane[data-wid='" + w.id + "']");
            let $lastTab    = $winLane.find(".tab-thumbnail").last();
            if ($lastTab.length == 0)
                return;
            if (w.incognito != isDraggedPrivate)    // prevent dragging across private and normal windows.
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

                let $srcTabBox  = $tabbox(srcTab.id);
                let $destTabBox = $tabbox(destTab.id);
                $srcTabBox.detach();
                $srcTabBox.css({"top":"", "left":""});      // reset dragging position.
                $srcTabBox.insertBefore($destTabBox);
                let toWidth = $srcTabBox.width();
                $srcTabBox.width(0).animate({ width: toWidth }, 400);
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
            let $tabBox = $tabbox(srcTab.id);
            $tabBox.css({ top:"", left:"" });   // reset the dragging position
            if (!$tabBox.is(":last-child")) {
                let tabWidth = $tabBox.width();
                $tabBox.css({ visibility: "hidden" }).animate({ width: 0 }, 400, function(){
                    $tabBox.detach();
                    $(".window-lane[data-wid='" + destWid + "'] .tab-grid").append($tabBox);
                    $tabBox.width(tabWidth).css({ visibility: "visible" });
                });
            } else {
                $tabBox.detach();
                $(".window-lane[data-wid='" + destWid + "'] .tab-grid").append($tabBox);
            }
        });
    }

    function selectDisplayType(displayType) {
        uiState.displayType = displayType;
        refreshVBtnBarControls();
        refreshUIContent(false, false);
        saveUiStateNow();
    }

    // size: 0-2
    function setThumbnailSize(size) {
        uiState.thumbnailSize = size;
        resizeThumbnails();
        saveUiStateNow();
    }

    function resizeThumbnails() {
        setImgDimension(imgWidth[uiState.thumbnailSize], imgHeight[uiState.thumbnailSize]);
        refreshVBtnBarControls();
        refreshUIContent(false, false);
    }

    function duplicateTab(tid) {
        browser.tabs.duplicate(tid).catch( e => log.warn(e) );
    }

    function reloadTab(tid) {
        browser.tabs.reload(tid);
    }

    function reloadWindowTabs(wid) {
        tabsByWindow[wid].forEach( tab => browser.tabs.reload(tab.id) );
    }

    function copyWindowTabTitleUrls(wid) {
        let urls = [].concat.apply([], tabsByWindow[wid].map( tab => [tab.title, tab.url, ""] )).join("\n");
        $("#copy-to-clipboard").val(urls).select();     // note that .val() can sandbox unsafe text from tab.url to avoid XSS attack.
        document.execCommand("copy");
    }

    function muteWindowTabs(wid, isMuting) {
        Promise.all( tabsByWindow[wid].map( tab => browser.tabs.update(tab.id, { muted: isMuting }) ) )
            .then( updatedTabs => updatedTabs.map( tab => tabsById[tab.id].mutedInfo = tab.mutedInfo ) )
            .then( () => {} )
    }

    function pinWindowTabs(wid, isPinning) {
        Promise.all( tabsByWindow[wid].map( tab => browser.tabs.update(tab.id, { pinned: isPinning }) ) )
            .then( updatedTabs => updatedTabs.map( tab => tabsById[tab.id].pinned = tab.pinned ) )
            .then( () => {} )
    }

    function moveTabToNewWindow(tid, isPrivateWindow) {
        browser.windows.create({
            tabId:  tid
        });
    }

    function copyTabUrl(tid) {
        let tab = tabsById[tid];
        $("#copy-to-clipboard").val(tab.url).select();  // note that .val() can sandbox unsafe text from tab.url to avoid XSS attack.
        document.execCommand("copy");
    }

    function closeTab(tid) {
        _cleanupTab(tid);
        $tabbox(tid).css({ visibility: "hidden" }).animate({ width: 0 }, 500, function(){ $(this).detach() });
        browser.tabs.remove(tid);
    }

    function closeOtherTabs(tid, whichSide) {
        let tab = tabsById[tid];
        browser.windows.get(tab.windowId, {
            populate:   true
        }).then( win => {
            let index = win.tabs.findIndex(tab => tab.id == tid);
            let tabs = whichSide == "all" ? win.tabs : whichSide == "left" ? win.tabs.slice(0, index) : win.tabs.slice(index + 1);
            let tabIdsToClose = tabs.filter( tab => tab.id != tid && !is_tiptaburl(tab.url) ).map( tab => tab.id );
            tabIdsToClose.forEach( tid => {
                _cleanupTab(tid);
                $tabbox(tid).animate({ width: 0 }, 500, function(){ $(this).detach() });
            });
            browser.tabs.remove(tabIdsToClose);
        });
    }

    function _cleanupTab(tid) {
        allTabs = allTabs.filter( tab => tab.id != tid );
        delete tabsById[tid];
        for (var wid in tabsByWindow) {
            tabsByWindow[wid] = tabsByWindow[wid].filter( tab => tab.id != tid );
        }
        for (var cid in tabsByContainer) {
            tabsByContainer[cid] = tabsByContainer[cid].filter( tab => tab.id != tid );
        }
        delete thumbnailsMap[tid];
        delete thumbnailsPending[tid];
        if (thumbnailFocusTid == tid)
            thumbnailFocusTid = null;
        if (overlayShownTid == tid)
            overlayShownTid = null;
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
                tabsById[tid][property] = tab[property];
                // TODO: refresh tab.
            });
        });
    }

    function toggleTabMuted(tid) {
        browser.tabs.get(tid).then( tab => {
            browser.tabs.update(tab.id, {
                muted: !isMuted(tab)
            }).then( tab => {
                tabsById[tid].mutedInfo = tab.mutedInfo;
                // TODO: refresh tab.
            });
        });
    }

    function pSendCmd(msg) {
        lastCmd = msg.cmd;
        return browser.runtime.sendMessage(msg);    // response is returned in .then( response => ... ).
    }

    function $tabbox(tid) { return $("#tid-" + tid) }
    
    function getFontSizeRem() {
        return parseFloat(getComputedStyle(document.documentElement).fontSize);
    }

    function remToPixels(rem) {
        return rem * PIXELS_PER_REM;
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

    function isMuted(tab) {
        return tab ? (tab.mutedInfo ? tab.mutedInfo.muted : false) : false;
    }


    log.info("module loaded");
    return module;

}(this, "tiptab_ui"));    // Pass in the global scope as 'this' scope.


